// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 fix pass 1 — the read rules the review asked for,
// enumerated without a database:
//   F1  the per-farm cursor reset at WHOLE-SECOND grain (a phone's cursor): once, never skipped, at every edge;
//   F3  "mentions money" (founder D-66 = option 1) and what a record without money keeps;
//   F3/F4/F10  the one record projection: words withheld whole, a crew total is money, a wage is a wage, said so;
//   item 12  /ai/jobs/{id}: membership, then the words and money rule.
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.AI.GetAiJobStatus;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class FixOneReadRulesTests
{
    private static readonly Guid FarmA = Guid.Parse("a1000000-0000-0000-0000-00000000000a");
    private static readonly Guid FarmB = Guid.Parse("b1000000-0000-0000-0000-00000000000b");
    private static readonly Guid Reader = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid Maker = Guid.Parse("30000000-0000-0000-0000-000000000003");

    private static FarmAccess Seat(AppRole role, FarmPermission? bits = null, DateTime? changed = null, bool labour = false) =>
        new(role, MembershipStatus.Active, IsRegistrant: false, bits, LabourGrant: labour, AccessChangedAtUtc: changed);

    private static DateTime At(string iso) => DateTime.Parse(iso, null, System.Globalization.DateTimeStyles.AdjustToUniversal);

    private static Dictionary<Guid, FarmReadScope> Scopes(DateTime now, params (Guid Farm, DateTime Changed)[] seats) =>
        seats.ToDictionary(
            s => s.Farm,
            s => FarmReadScope.Of(s.Farm, Seat(AppRole.Mukadam, FarmPermission.SeeMoney, s.Changed), now)!);

    /// <summary>The phone's rounding (transport.ts; 1.0.17 the same): DOWN to the whole second.</summary>
    private static DateTime PhoneSends(DateTime cursor) =>
        new(cursor.Ticks - (cursor.Ticks % TimeSpan.TicksPerSecond), DateTimeKind.Utc);

    // ── F1 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void F1_change_and_cursor_in_the_same_second_the_farm_is_re_sent_once()
    {
        var changed = At("2026-11-01T10:00:00.300Z");
        var now = At("2026-11-01T10:00:15.000Z");
        var scopes = Scopes(now, (FarmA, changed));

        // The phone's last answer was cut in that same second, after the change was made but before it was delivered.
        var window = new PullReadWindow(scopes, PhoneSends(At("2026-11-01T10:00:00.900Z")), now);
        Assert.Equal(DateTime.UnixEpoch, window.SinceFor(FarmA));
        Assert.Equal(At("2026-11-01T10:00:01Z"), window.ResetThroughUtc);

        // Whatever cursor that answer carries is at least the second after the change; rounded down, still that.
        var after = new PullReadWindow(scopes, PhoneSends(window.ResetThroughUtc!.Value), now.AddSeconds(15));
        Assert.Null(after.ResetThroughUtc);
        Assert.Empty(after.ResetFarmIds);
    }

    [Fact]
    public void F1_a_pull_just_before_the_change_in_the_same_second_never_skips_it()
    {
        var changed = At("2026-11-01T10:00:00.700Z");

        // The pull at .500 reads the seat after the change is visible (worst case): too young, not sent, and the
        // cursor this answer may hand out stays below the change's second.
        var scopes = Scopes(At("2026-11-01T10:00:00.500Z"), (FarmA, changed));
        var young = new PullReadWindow(scopes, At("2026-11-01T09:59:00Z"), At("2026-11-01T10:00:00.500Z"));
        Assert.Empty(young.ResetFarmIds);
        Assert.Equal(At("2026-11-01T10:00:00Z"), young.PendingCapUtc);

        // Whether that pull saw the change or not, its cursor is at most 10:00:00 (its own start, or the cap);
        // the next pull, a second later, sends the farm.
        var next = new PullReadWindow(scopes, PhoneSends(At("2026-11-01T10:00:00.400Z")), At("2026-11-01T10:00:15Z"));
        Assert.Contains(FarmA, next.ResetFarmIds);
        Assert.Equal(At("2026-11-01T10:00:01Z"), next.ResetThroughUtc);
    }

    [Fact]
    public void F1_several_farms_each_re_sent_once_and_a_too_young_one_waits_for_the_next_pull()
    {
        var now = At("2026-11-01T10:00:10.500Z");
        var scopes = Scopes(now,
            (FarmA, At("2026-11-01T10:00:00.300Z")),
            (FarmB, At("2026-11-01T10:00:10.200Z")));
        var cursor = At("2026-11-01T09:00:00Z");

        var first = new PullReadWindow(scopes, cursor, now);
        Assert.Equal([FarmA], first.ResetFarmIds);
        Assert.Equal(At("2026-11-01T10:00:01Z"), first.ResetThroughUtc);
        Assert.Equal(At("2026-11-01T10:00:10Z"), first.PendingCapUtc);
        Assert.True(first.ResetThroughUtc <= first.PendingCapUtc, "the cap never undoes a delivery");

        // The next phone cursor is somewhere in [10:00:01, 10:00:10]: A is never re-sent again, B now is.
        foreach (var phoneCursor in new[] { At("2026-11-01T10:00:01Z"), At("2026-11-01T10:00:10Z") })
        {
            var second = new PullReadWindow(scopes, phoneCursor, At("2026-11-01T10:00:25Z"));
            Assert.DoesNotContain(FarmA, second.ResetFarmIds);
            Assert.Contains(FarmB, second.ResetFarmIds);
            Assert.Equal(At("2026-11-01T10:00:11Z"), second.ResetThroughUtc);

            var third = new PullReadWindow(scopes, second.ResetThroughUtc!.Value, At("2026-11-01T10:00:40Z"));
            Assert.Empty(third.ResetFarmIds);
        }
    }

    [Fact]
    public void F1_a_change_stamped_on_a_whole_second_is_delivered_by_the_next_second()
    {
        var changed = At("2026-11-01T10:00:00Z");
        var scopes = Scopes(At("2026-11-01T10:00:05Z"), (FarmA, changed));
        Assert.Contains(FarmA, new PullReadWindow(scopes, At("2026-11-01T10:00:00Z"), At("2026-11-01T10:00:05Z")).ResetFarmIds);
        Assert.Empty(new PullReadWindow(scopes, At("2026-11-01T10:00:01Z"), At("2026-11-01T10:00:05Z")).ResetFarmIds);
    }

    // ── F3: mentions money ───────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("प्रत्येकी ४०० रुपये दिले")]
    [InlineData("रुपया दिला")]
    [InlineData("खत रु. १२००")]
    [InlineData("खत रु ५००")]
    [InlineData("₹400 each")]
    [InlineData("paid Rs 500")]
    [InlineData("paid rs.500")]
    [InlineData("500rs")]
    [InlineData("INR 300")]
    [InlineData("400 rupees")]
    public void F3_a_money_word_is_found(string text) => Assert.True(MoneyMention.InText(text));

    [Theory]
    [InlineData("आज बागेत छाटणी केली")]
    [InlineData("2 hrs of spraying")]
    [InlineData("Mrs Patil came")]
    [InlineData("रुंद सरी काढली")]
    [InlineData("")]
    [InlineData(null)]
    public void F3_ordinary_words_are_not_money(string? text) => Assert.False(MoneyMention.InText(text));

    [Fact]
    public void F3_a_stated_amount_anywhere_in_the_document_is_money_and_a_null_one_is_not()
    {
        using var priced = JsonDocument.Parse("""{"schema":1,"inputs":[{"id":"i1","productName":"युरिया","cost":250}]}""");
        using var silent = JsonDocument.Parse("""{"schema":1,"inputs":[{"id":"i1","productName":"युरिया","cost":null}]}""");
        Assert.True(MoneyMention.InDocument(priced.RootElement));
        Assert.False(MoneyMention.InDocument(silent.RootElement));
    }

    // ── F3 / F4 / F10: the one projection ───────────────────────────────────────────────

    [Fact]
    public void F3_a_confirmer_without_money_gets_the_work_of_a_money_record_and_none_of_its_words()
    {
        var scope = FarmReadScope.Of(FarmA, Seat(AppRole.Mukadam, FarmPermission.ConfirmRecords), DateTime.UtcNow)!;
        var dto = Record(
            """{"schema":1,"fullTranscript":"आज ५ मजूर, प्रत्येकी ४०० रुपये","cropActivities":[{"id":"c1","title":"छाटणी","sourceText":"छाटणी केली","systemInterpretation":"छाटणी","notes":"चांगली"}]}""",
            taskNotes: "Pruning • 400 रुपये दिले",
            deviation: "पैसे कमी पडले ₹200",
            reason: "₹ जास्त लिहिले");

        var sent = ReadScopeProjection.Record(dto, scope, Reader);

        Assert.True(sent.WordsWithheldForMoney);
        var doc = sent.Content!.Document;
        Assert.False(doc.TryGetProperty("fullTranscript", out _));
        var item = doc.GetProperty("cropActivities")[0];
        Assert.Equal("छाटणी", item.GetProperty("title").GetString());
        foreach (var words in new[] { "sourceText", "systemInterpretation", "notes" })
        {
            Assert.False(item.TryGetProperty(words, out _), words);
        }

        Assert.Null(sent.Tasks[0].Notes);
        Assert.Null(sent.Tasks[0].DeviationNote);
        Assert.Null(sent.VerificationEvents[0].Reason);
        Assert.Equal("Pruning", sent.Tasks[0].ActivityType);
    }

    [Fact]
    public void F3_a_task_note_loses_only_the_apps_amount_labels_and_goes_whole_when_his_own_words_name_money()
    {
        var scope = FarmReadScope.Of(FarmA, Seat(AppRole.Mukadam, FarmPermission.ConfirmRecords), DateTime.UtcNow)!;
        var labelled = ReadScopeProjection.Record(Record("""{"schema":1}""", taskNotes: "Workers: 6 • Cost: ₹3000"), scope, Reader);
        Assert.Equal("Workers: 6", labelled.Tasks[0].Notes);

        var his = ReadScopeProjection.Record(Record("""{"schema":1}""", taskNotes: "Method: Drip • ₹500 जास्त दिले"), scope, Reader);
        Assert.Null(his.Tasks[0].Notes);
    }

    [Fact]
    public void F3_unchanged_for_his_own_record_a_record_without_money_and_a_seat_that_sees_money()
    {
        var noMoney = FarmReadScope.Of(FarmA, Seat(AppRole.Mukadam, FarmPermission.ConfirmRecords), DateTime.UtcNow)!;
        var seesMoney = FarmReadScope.Of(FarmA, Seat(AppRole.Mukadam, FarmPermission.ConfirmRecords | FarmPermission.SeeMoney), DateTime.UtcNow)!;
        const string money = """{"schema":1,"fullTranscript":"४०० रुपये"}""";
        const string plain = """{"schema":1,"fullTranscript":"छाटणी केली"}""";

        Assert.True(ReadScopeProjection.Record(Record(money), noMoney, Maker).Content!.Document.TryGetProperty("fullTranscript", out _));
        Assert.True(ReadScopeProjection.Record(Record(plain), noMoney, Reader).Content!.Document.TryGetProperty("fullTranscript", out _));
        Assert.Null(ReadScopeProjection.Record(Record(plain), noMoney, Reader).WordsWithheldForMoney);
        Assert.True(ReadScopeProjection.Record(Record(money), seesMoney, Reader).Content!.Document.TryGetProperty("fullTranscript", out _));
    }

    [Fact]
    public void F4_F10_a_crew_total_is_money_a_wage_is_a_wage_and_a_withheld_one_says_so()
    {
        var moneyOnly = FarmReadScope.Of(FarmA, Seat(AppRole.Mukadam, FarmPermission.SeeMoney), DateTime.UtcNow)!;
        var nothing = FarmReadScope.Of(FarmA, Seat(AppRole.Mukadam), DateTime.UtcNow)!;
        var dto = Record("""{"schema":1}""", crew: (Wage: 400m, Total: 3200m));
        var silent = Record("""{"schema":1}""", crew: (Wage: null, Total: null));

        var m = ReadScopeProjection.Record(dto, moneyOnly, Reader).Labour![0];
        Assert.Equal(3200m, m.TotalCost);
        Assert.Null(m.TotalCostWithheld);
        Assert.Null(m.WagePerPerson);
        Assert.True(m.WageWithheld);

        var n = ReadScopeProjection.Record(dto, nothing, Reader).Labour![0];
        Assert.Null(n.TotalCost);
        Assert.True(n.TotalCostWithheld);
        Assert.True(n.WageWithheld);

        var s = ReadScopeProjection.Record(silent, nothing, Reader).Labour![0];
        Assert.Null(s.WageWithheld);
        Assert.Null(s.TotalCostWithheld);
    }

    // ── Item 12: /ai/jobs/{id} ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Item12_an_ai_job_is_read_by_the_farms_seats_by_the_words_and_money_rule()
    {
        var job = AiJob.Create(Guid.NewGuid(), "key-1", AiOperationType.VoiceToStructuredLog, Maker, FarmA, null, null);
        typeof(AiJob).GetProperty(nameof(AiJob.NormalizedResultJson))!
            .SetValue(job, """{"fullTranscript":"आज ५ मजूर, प्रत्येकी ४०० रुपये"}""");
        var jobs = new OneJob(job);

        async Task<(bool Ok, object? Result, string? Withheld)> Read(Guid caller, FarmAccess? access)
        {
            var handler = new GetAiJobStatusHandler(new Seats(access), jobs, new Clock());
            var result = await handler.HandleAsync(new GetAiJobStatusQuery(job.Id, caller, IsAdmin: false));
            return result.IsSuccess ? (true, result.Value!.Result, result.Value.ResultWithheld) : (false, null, null);
        }

        Assert.False((await Read(Reader, null)).Ok, "not a member: refused");
        Assert.False((await Read(Reader, Seat(AppRole.Worker))).Ok, "a कामगार: another person's parse is not his");

        var listener = await Read(Reader, Seat(AppRole.Mukadam));
        Assert.True(listener.Ok);
        Assert.Null(listener.Result);
        Assert.Equal(GetAiJobStatusHandler.ResultWithheldWords, listener.Withheld);

        var confirmer = await Read(Reader, Seat(AppRole.Mukadam, FarmPermission.ConfirmRecords));
        Assert.Null(confirmer.Result);
        Assert.Equal(GetAiJobStatusHandler.ResultWithheldMoney, confirmer.Withheld);

        var withMoney = await Read(Reader, Seat(AppRole.Mukadam, FarmPermission.ConfirmRecords | FarmPermission.SeeMoney));
        Assert.NotNull(withMoney.Result);
        Assert.Null(withMoney.Withheld);

        var own = await Read(Maker, Seat(AppRole.Worker));
        Assert.True(own.Ok, "his own parse");
        Assert.NotNull(own.Result);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    private static DailyLogDto Record(
        string content,
        string? taskNotes = null,
        string? deviation = null,
        string? reason = null,
        (decimal? Wage, decimal? Total)? crew = null)
    {
        using var doc = JsonDocument.Parse(content);
        var labour = crew is { } c
            ? new List<LabourEngagementDto>
            {
                new(Guid.NewGuid(), Guid.NewGuid(), "Hired", 8, null, null, c.Wage, null, null, c.Total, 8m, "Assumed",
                    null, null, null, [], DateTime.UtcNow, null, []),
            }
            : null;
        return new DailyLogDto(
            Guid.NewGuid(), FarmA, null, null, Maker, new DateOnly(2026, 10, 30), null, DateTime.UtcNow, DateTime.UtcNow, null, null,
            [new LogTaskDto(Guid.NewGuid(), "Pruning", taskNotes, DateTime.UtcNow, "Completed", null, deviation)],
            [new VerificationEventDto(Guid.NewGuid(), "Disputed", reason, Maker, DateTime.UtcNow)],
            "Farm", [],
            Labour: labour,
            Content: new LogContentDto(1, 1, doc.RootElement.Clone()));
    }

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    private sealed class OneJob(AiJob job) : NullAiJobRepository
    {
        public override Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) =>
            Task.FromResult<AiJob?>(jobId == job.Id ? job : null);
    }

    private sealed class Seats(FarmAccess? access) : Work.Handlers.StubShramSafalRepository
    {
        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(farmId == FarmA ? access : null);
    }
}
