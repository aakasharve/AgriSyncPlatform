// spec: plr-d10 lane PRV fix pass 3 — the third review's findings, against a real Postgres as agrisync_app:
//   M-A   a narrowing of a record narrows its money, whatever the money's history, never adding anyone; a widening
//         brings it back only up to the holder's own last choice;
//   M-B   the owner is SHOWN a day that needs his ruling (DaysToRule on the labour read); nobody else is; it clears;
//   N1-b  the sender's own audit rows (his personal data export) name no record kept from him;
//   5     the हजेरी cell's money words, the revise words rule, the projected create replay;
//   7     a photo whose row he made before its record was kept from him still uploads;
//   8     D-69 on every read that had no test of its own.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.AI.GetAiJobStatus;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.GetLogOriginalVoice;
using ShramSafal.Application.UseCases.Logs.MoveDailyLog;
using ShramSafal.Application.UseCases.Logs.ReviseLogContent;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

public sealed partial class RecordAudienceRealPostgresTests
{
    private static Guid FixThreeId(int n) => Guid.Parse($"3d0a0000-0000-4000-8000-0000000004{n:x2}");

    // ── M-A ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MA_money_set_back_to_the_team_by_hand_narrows_with_its_record_and_widens_back_with_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = FixThreeId(1);
        var money = await RecordWithLineMoneyAsync(log, "fix3-ma1", 1111.17m);
        await SetAudienceAsync(Owner, "CostEntry", money, "OnlyMe");
        await SetAudienceAsync(Owner, "CostEntry", money, "Team"); // his own choice, back to the team

        await SetAudienceAsync(Owner, "DailyLog", log, "OnlyMe");
        var (_, owner) = await PullAsync(Owner);
        AudienceOf(owner, "costEntries", money).Should().Be("OnlyMe", "after a record narrows, nobody it left out sees its money");
        (await PullAsync(Mukadam)).Body.Should().NotContain(money.ToString());

        await SetAudienceAsync(Owner, "DailyLog", log, "Team");
        var (_, widened) = await PullAsync(Owner);
        AudienceOf(widened, "costEntries", money).Should().BeNull("moved by the record, it comes back with it — up to his own last choice (the team)");
    }

    [Fact]
    public async Task MA_a_narrowing_never_adds_a_person_to_money_already_inside_the_new_audience()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = FixThreeId(2);
        var money = await RecordWithLineMoneyAsync(log, "fix3-ma2", 2222.27m);
        await SetAudienceAsync(Owner, "CostEntry", money, "Selected", Mukadam);

        await SetAudienceAsync(Owner, "DailyLog", log, "Selected", Mukadam, CoOwner);
        var (_, owner) = await PullAsync(Owner);
        AudienceOf(owner, "costEntries", money).Should().Be("Selected");
        ChosenOf(owner, "costEntries", money).Should().Equal([Mukadam], "money already inside keeps its own choice");
    }

    [Fact]
    public async Task MA_selected_money_loses_whom_the_record_drops_gains_no_one_and_returns_to_his_choice_on_widening()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = FixThreeId(3);
        var money = await RecordWithLineMoneyAsync(log, "fix3-ma3", 3333.37m);
        await SetAudienceAsync(Owner, "CostEntry", money, "Selected", Mukadam, Worker);

        await SetAudienceAsync(Owner, "DailyLog", log, "Selected", Mukadam, CoOwner);
        var (_, narrowed) = await PullAsync(Owner);
        ChosenOf(narrowed, "costEntries", money).Should().Equal([Mukadam], "the कामगार loses it; the सहमालक is not added");
        (await PullAsync(Worker)).Body.Should().NotContain(money.ToString());

        await SetAudienceAsync(Owner, "DailyLog", log, "Team");
        var (_, widened) = await PullAsync(Owner);
        AudienceOf(widened, "costEntries", money).Should().Be("Selected");
        ChosenOf(widened, "costEntries", money).OrderBy(g => g).Should().Equal(new[] { Mukadam, Worker }.OrderBy(g => g),
            "a widening brings it back to his own last choice, never past it");
    }

    // ── M-B and N1-b ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MB_the_owner_is_shown_the_day_that_needs_his_ruling_nobody_else_is_and_it_clears_when_he_rules()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await EngageAsync(N1HiddenLog, N1HiddenCrew, "full", N1SecretTask, "fix3-mb-hidden");
        await EngageAsync(N1TeamLog, N1TeamCrew, "half", "खुरपणी", "fix3-mb-team");
        await SetAudienceAsync(Owner, "DailyLog", N1HiddenLog, "OnlyMe");
        await PushAppliedAsync(Mukadam, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{WorkDay}:Half:fix3",
            new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = Guid.NewGuid(),
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = FieldOperator,
                ["workDate"] = WorkDay,
                ["dayMark"] = "Half",
            });

        (await DaysToRuleAsync(Owner)).Should().Equal([$"{FieldOperator}:{WorkDay}"], "the holder sees every record of the day");
        (await DaysToRuleAsync(Mukadam)).Should().BeEmpty("the sender is told nothing");
        // MU-1 (PRV REVIEW-4 N-2): the co-owner is given take हजेरी, so "nothing for him" can only be the audience gate - without
        // the authority the empty answer passed for the wrong reason. The control opens the record to him: then he is shown the day.
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.TakeAttendance);
        (await DaysToRuleAsync(CoOwner)).Should().BeEmpty("nor anyone a named record is kept from, even one who may rule days");
        await SetAudienceAsync(Owner, "DailyLog", N1HiddenLog, "Selected", CoOwner);
        (await DaysToRuleAsync(CoOwner)).Should().Equal([$"{FieldOperator}:{WorkDay}"], "control: once the record is open to him, the same seat is shown the day");
        await SetAudienceAsync(Owner, "DailyLog", N1HiddenLog, "OnlyMe");
        (await DaysToRuleAsync(CoOwner)).Should().BeEmpty("and closed again, nothing");

        // N1-b — his own audit rows (what his personal data export carries) name no record kept from him.
        foreach (var hidden in new[] { N1HiddenLog, PrivateLog, PrivateCost })
        {
            (await CountAsync($"SELECT count(*) FROM ssf.audit_events WHERE actor_user_id = '{Mukadam}' AND payload::text LIKE '%' || @id::text || '%'",
                hidden)).Should().Be(0, $"his export must not carry {hidden}");
        }

        // He rules (the answer to the question: the chosen record's fact) — the flag clears.
        await PushAppliedAsync(Owner, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{WorkDay}:Full:ruled",
            new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = Guid.NewGuid(),
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = FieldOperator,
                ["workDate"] = WorkDay,
                ["dayMark"] = "Full",
                ["resolvedLabourAssignmentId"] = N1HiddenCrew,
            });
        (await DaysToRuleAsync(Owner)).Should().BeEmpty("his ruling clears it");
    }

    // ── Item 5 ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Item5_the_hajeri_cell_never_shows_money_words_to_a_seat_without_wages_or_from_a_record_whose_money_is_kept_from_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = FixThreeId(5);
        var crew = FixThreeId(6);
        const string Paid = "खुरपणी ₹४०० रोज";
        await EngageAsync(log, crew, "full", Paid, "fix3-i5-ledger");

        (await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", Mukadam)).Body
            .Should().NotContain("₹४००", "a seat that does not see wages never reads words that name money");
        (await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", CoOwner)).Body
            .Should().Contain("₹४००", "a seat that sees wages does (control)");

        var crewMoney = MoneyEntryIdentity.ForRecordLine(log, MoneyEntryIdentity.Labour, crew.ToString("D"));
        await PushAppliedAsync(Owner, "add_cost_entry", "fix3-i5-crew-money", CostPayload(crewMoney, FarmA, PlotA, CycleA, 400m));
        await SetAudienceAsync(Owner, "CostEntry", crewMoney, "OnlyMe");
        (await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", CoOwner)).Body
            .Should().NotContain("₹४००", "nor from a record whose own money is kept from him (D-69)");
    }

    [Fact]
    public async Task Item5_a_revise_never_deletes_the_words_the_server_kept_from_the_editor_whatever_his_phone_says()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = FixThreeId(7);
        const string Words = "औषध ₹५५५ ला";
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages, FarmAuthority.ConfirmRecords,
            FarmAuthority.TakeAttendance);
        await D69RecordAsync(log, "fix3-i5-revise", 555.57m, Words);

        // His copy came without the words (D-69), but his phone does not say so (no wordsWithheld).
        await CommitRevisionAsync(log, CoOwner, CopyWithoutWordsOrAmounts, wordsWithheld: null);

        (await PullAsync(Owner)).Body.Should().Contain(Words, "the record keeps its words: their absence from his copy is not a deletion");
    }

    [Fact]
    public async Task Item5_a_create_replay_to_someone_who_did_not_make_the_record_comes_back_as_the_pull_sends_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        // A मुकादम without "पैसे पाहणे": the stored record comes back as the pull sends it to him — without its amounts.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance);
        var replay = await ReplayOwnerLogAsync(Mukadam);
        replay.IsSuccess.Should().BeTrue(replay.IsSuccess ? "" : replay.Error.Code);
        JsonSerializer.Serialize(replay.Value).Should().NotContain("777.73", "the owner's stated price is not his to see (no see money)")
            .And.NotContain("3457.36").And.NotContain("432.17");

        // A कामगार reads only his own records: the replay of someone else's record hands him nothing.
        var worker = await ReplayOwnerLogAsync(Worker);
        worker.IsSuccess.Should().BeFalse("the pull would never send him the owner's record");
    }

    private Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> ReplayOwnerLogAsync(Guid user) =>
        AsFarmMemberAsync(FarmA, user, async sp => await sp
            .GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>()
            .HandleAsync(new CreateDailyLogCommand(
                FarmA, PlotA, CycleA, user, user, new DateOnly(2026, 10, 30), null, $"device-mu3-{Owner:N}", "mu3-owner-log")));

    // ── Item 7 ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Item7_a_photo_he_added_before_its_record_was_kept_from_him_still_uploads_and_the_record_leaves_his_phone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var photo = FixThreeId(8);
        await PushAppliedAsync(Mukadam, "create_attachment", "fix3-i7-photo", Photo(photo, OwnerLog, "DailyLog"));
        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "OnlyMe");

        (await UploadGateAsync(photo, Mukadam)).Should().BeNull("he took it: its bytes always reach the server");
        (await UploadGateAsync(OwnerLogPhoto, Mukadam)).Should().Be(Closed, "someone else's photo of that record stays closed to him");
        var (body, _) = await PullAsync(Mukadam);
        body.Should().NotContain(OwnerLog.ToString(), "the record leaves his phone").And.NotContain(photo.ToString());
    }

    // ── Item 8: D-69 on every read that had no test of its own ───────────────────────────

    [Theory]
    [InlineData("verify")]
    [InlineData("add-task")]
    [InlineData("move")]
    [InlineData("revise")]
    [InlineData("ai-job")]
    [InlineData("original-voice")]
    [InlineData("edit-price")]
    public async Task Item8_a_record_whose_own_money_is_kept_from_him_is_served_without_its_money(string door)
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages, FarmAuthority.ConfirmRecords,
            FarmAuthority.ReviewMoney, FarmAuthority.TakeAttendance);
        var log = FixThreeId(9);
        var job = FixThreeId(10);
        const string Words = "औषध ₹७७७ ला";
        const decimal Amount = 7171.71m;
        await using (var db = NewSuperuserContext())
        {
            db.AiJobs.Add(AiJob.Create(job, "fix3-d69-job", AiOperationType.VoiceToStructuredLog, Owner, FarmA, null, null));
            await db.SaveChangesAsync();
        }

        await ExecOnSuperuserAsync("UPDATE ssf.ai_jobs SET normalized_result_json = @json::jsonb WHERE id = @id",
            ("json", JsonSerializer.Serialize(new { inputs = new[] { new { productName = "औषध", cost = Amount } }, transcript = Words })), ("id", job));
        await D69RecordAsync(log, "fix3-i8", Amount, Words, job);
        static void NoMoney(string answer)
        {
            answer.Should().NotContain("7171.71").And.NotContain(Words);
        }

        switch (door)
        {
            case "verify":
                var verified = await AsFarmMemberAsync(FarmA, CoOwner, sp => sp.GetRequiredService<VerifyLogHandler>()
                    .HandleAsync(new VerifyLogCommand(log, VerificationStatus.Disputed, "शंका आहे", CoOwner)));
                verified.IsSuccess.Should().BeTrue(verified.IsSuccess ? "" : verified.Error.Code);
                NoMoney(JsonSerializer.Serialize(verified.Value));
                break;
            case "add-task":
                var tasked = await AsFarmMemberAsync(FarmA, CoOwner, sp => sp.GetRequiredService<AddLogTaskHandler>()
                    .HandleAsync(new AddLogTaskCommand(log, "Irrigation", null, ActorUserId: CoOwner)));
                tasked.IsSuccess.Should().BeTrue(tasked.IsSuccess ? "" : tasked.Error.Code);
                NoMoney(JsonSerializer.Serialize(tasked.Value));
                break;
            case "move":
                var moved = await AsFarmMemberAsync(FarmA, CoOwner, sp => sp.GetRequiredService<MoveDailyLogHandler>()
                    .HandleAsync(new MoveDailyLogCommand(log, 1, null, false, new DateOnly(2026, 10, 29), null, DateTime.UtcNow, CoOwner)));
                moved.IsSuccess.Should().BeTrue(moved.IsSuccess ? "" : moved.Error.Code);
                NoMoney(JsonSerializer.Serialize(moved.Value));
                break;
            case "revise":
                var revised = await AsFarmMemberAsync(FarmA, CoOwner, sp => sp.GetRequiredService<ReviseLogContentHandler>()
                    .HandleAsync(new ReviseLogContentCommand(log, 1, CopyWithoutWordsOrAmounts, "दुरुस्ती", CoOwner, AmountsWithheld: true, WordsWithheld: true)));
                revised.IsSuccess.Should().BeTrue(revised.IsSuccess ? "" : revised.Error.Code);
                NoMoney(JsonSerializer.Serialize(revised.Value));
                break;
            case "ai-job":
                var parse = await AsFarmMemberAsync(FarmA, CoOwner, sp => ActivatorUtilities.CreateInstance<GetAiJobStatusHandler>(sp)
                    .HandleAsync(new GetAiJobStatusQuery(job, CoOwner, false)));
                parse.IsSuccess.Should().BeTrue(parse.IsSuccess ? "" : parse.Error.Code);
                parse.Value!.ResultWithheld.Should().Be(GetAiJobStatusHandler.ResultWithheldMoney);
                break;
            case "original-voice":
                // The route's own handler; the clip store is never reached (the money rule answers first).
                var voice = await AsFarmMemberAsync(FarmA, CoOwner, sp => ActivatorUtilities
                    .CreateInstance<GetLogOriginalVoiceHandler>(sp, new NeverReadBlobStore())
                    .HandleAsync(new GetLogOriginalVoiceQuery(log, CoOwner)));
                voice.IsSuccess.Should().BeTrue(voice.IsSuccess ? "" : voice.Error.Code);
                voice.Value!.UnavailableReason.Should().Be(OriginalVoiceUnavailableReason.MoneyWithheld);
                break;
            case "edit-price":
                // He reviews money, but this money is kept from him: a change of its price is refused, nothing saved.
                const string Repriced = """{"schema":1,"inputs":[{"id":"in-1","productName":"औषध","quantity":1,"unit":"l","cost":9.99}]}""";
                var refused = await PushAsync(CoOwner, "revise_log_content", $"fix3-reprice-{log:N}", RevisionPayload(log, Repriced, wordsWithheld: true, amountsWithheld: false));
                refused.ErrorCode.Should().Be("ShramSafal.LogContentPrices.Conflict", "the price he cannot see is not his to change");
                var (ownerBody, _) = await PullAsync(Owner);
                ownerBody.Should().NotContain("9.99").And.Contain("7171.71");
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(door), door, null);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    /// <summary>A copy of a one-input record as a reader without its money holds it: no amount, no words.</summary>
    private const string CopyWithoutWordsOrAmounts = """{"schema":1,"inputs":[{"id":"in-1","productName":"औषध","quantity":1,"unit":"l"}]}""";

    /// <summary>A team record by the owner with one priced input line, spoken words naming money, and that line's money Only me.</summary>
    private async Task D69RecordAsync(Guid logId, string key, decimal amount, string words, Guid? aiJob = null)
    {
        var log = LogPayload(logId, Owner, Guid.NewGuid(), 2, null, null, [], amount);
        log["content"] = new
        {
            schema = 1,
            fullTranscript = words,
            inputs = new object[]
            {
                new
                {
                    id = "in-1", productName = "औषध", quantity = 1, unit = "l", cost = amount,
                    numbers = new { cost = new { certainty = "reported", spokenText = words } },
                },
            },
        };
        if (aiJob is { } job)
        {
            log["sourceAiJobId"] = job;
        }

        await PushAppliedAsync(Owner, "create_daily_log", $"{key}-log", log);
        var money = MoneyEntryIdentity.ForRecordLine(logId, MoneyEntryIdentity.Input, "in-1");
        await PushAppliedAsync(Owner, "add_cost_entry", $"{key}-money", CostPayload(money, FarmA, PlotA, CycleA, amount));
        await SetAudienceAsync(Owner, "CostEntry", money, "OnlyMe");
    }

    /// <summary>A revision through the real push path (committed), as his phone sends it.</summary>
    private async Task CommitRevisionAsync(Guid logId, Guid actor, string contentJson, bool? wordsWithheld, bool? amountsWithheld = true) =>
        await PushAppliedAsync(actor, "revise_log_content", $"fix3-revise-{logId:N}-{Guid.NewGuid():N}",
            RevisionPayload(logId, contentJson, wordsWithheld, amountsWithheld));

    private static Dictionary<string, object?> RevisionPayload(Guid logId, string contentJson, bool? wordsWithheld, bool? amountsWithheld)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["baseVersion"] = 1,
            ["content"] = JsonDocument.Parse(contentJson).RootElement,
            ["reason"] = "दुरुस्ती",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        };
        if (amountsWithheld is { } a)
        {
            payload["amountsWithheld"] = a;
        }

        if (wordsWithheld is { } w)
        {
            payload["wordsWithheld"] = w;
        }

        return payload;
    }

    /// <summary>The voice handler's clip store, never reached by these facts (the money rule answers before any clip read).</summary>
    private sealed class NeverReadBlobStore : ShramSafal.Application.Privacy.Ports.IRetainedBlobStore
    {
        public Task<ShramSafal.Application.Privacy.Ports.RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, System.Threading.CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<Guid> PersistAsync(ShramSafal.Domain.Privacy.VoiceClipRetained metadata, byte[] cipherBytes, System.Threading.CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<ShramSafal.Application.Privacy.Ports.RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, System.Threading.CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<ShramSafal.Application.Privacy.Ports.VoiceClipRetainedListItem>> GetByRangeAsync(
            Guid userId, DateOnly from, DateOnly to, System.Threading.CancellationToken ct) =>
            throw new NotSupportedException();
    }

    /// <summary>The days the labour read says need this reader's ruling ("operator:day").</summary>
    private async Task<IReadOnlyList<string>> DaysToRuleAsync(Guid user)
    {
        var (status, body) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", user);
        status.Should().Be(HttpStatusCode.OK, body);
        using var document = JsonDocument.Parse(body);
        return document.RootElement.TryGetProperty("daysToRule", out var days) && days.ValueKind == JsonValueKind.Array
            ? days.EnumerateArray().Select(d => $"{d.GetProperty("fieldOperatorId").GetGuid()}:{d.GetProperty("workDate").GetString()}").ToList()
            : [];
    }
}
