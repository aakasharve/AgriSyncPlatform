// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 fix pass 1 — the review's findings, each proved on a real
// Postgres as agrisync_app (E3 first) through the real host and the real routes, with every cursor sent the way a
// phone sends it (whole seconds):
//   F1  a widened seat's older rows arrive exactly once over a run of pulls fed each answer's cursor;
//   F2  a bill photo is money (pull and /attachments);
//   F3  the words and voice of a record that mentions money (founder D-66 = option 1);
//   F4  a crew total is money, a named worker's pay a wage; F10 a withheld amount says so;
//   F5  a command answer strips what the pull would;
//   F7  job cards and the worker page keep the work, withhold the pay;
//   F8  an edit's carry-forward follows what the phone was sent;
//   F9  a held farm the person may no longer read is answered by name;
//   F11 a multi-farm summary that leaves a farm out says so;
//   item 12  test records, the plan, compliance and the attention board follow the farm scope.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.Logs.GetLogOriginalVoice;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class RoleScopedFixOneRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly Guid MoneyWordsLog = Guid.Parse("3d030000-0000-4000-8000-000000000071");
    private static readonly Guid PlainWordsLog = Guid.Parse("3d030000-0000-4000-8000-000000000072");
    private static readonly Guid BillPhoto = Guid.Parse("3d030000-0000-4000-8000-000000000073");

    // ── F1 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The owner switches see money on for the मुकादम. His phone then pulls again and again, each time sending back
    /// the previous answer's cursor ROUNDED DOWN TO THE WHOLE SECOND (as every phone, 1.0.17 included, does). The
    /// farm's older money must arrive in exactly ONE of those answers: never zero (skipped), never twice (looping).
    /// On edee6667 the reset compared the microsecond stamp to the whole-second cursor and re-sent every time.
    /// </summary>
    [Fact]
    public async Task F1_a_widened_seats_older_money_arrives_exactly_once_over_whole_second_pulls()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The cost is OLDER money (an hour old): only the reset can bring it to his cursor. (Rows written in the same
        // whole second as a cursor are re-sent by any whole-second cursor; that is not what this fact measures.)
        await ExecOnSuperuserAsync(
            "UPDATE ssf.cost_entries SET modified_at_utc = modified_at_utc - INTERVAL '1 hour' WHERE \"Id\" = @cost",
            ("cost", Cost));
        var (_, first) = await PullAsync(Mukadam);
        ArrayOf(first, "costEntries").Should().BeEmpty("before the switch he sees no money");
        var cursor = first.GetProperty("nextCursorUtc").GetDateTime();

        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney);

        var deliveries = 0;
        for (var i = 0; i < 8; i++)
        {
            var (_, answer) = await PullAsync(Mukadam, cursor);
            var sent = IdsOf(answer, "costEntries").Contains(Cost);
            deliveries += sent ? 1 : 0;
            var next = answer.GetProperty("nextCursorUtc").GetDateTime();
            Output.WriteLine($"[EVIDENCE] pull {i + 1}: sent cursor {PhoneCursor(cursor)} -> cost re-sent={sent}, next {next:O}");
            cursor = next;
            await Task.Delay(400);
        }

        deliveries.Should().Be(1, "re-sent exactly once: never skipped, never again");
    }

    // ── F2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F2_a_bill_photo_is_money_on_the_pull_and_on_every_attachment_read()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Owner, "create_attachment", "fix1-bill", new Dictionary<string, object?>
        {
            ["attachmentId"] = BillPhoto,
            ["farmId"] = FarmA,
            ["linkedEntityId"] = FarmA,
            ["linkedEntityType"] = "Bill",
            ["fileName"] = "bill-1.jpg",
            ["mimeType"] = "image/jpeg",
        });

        IdsOf((await PullAsync(Owner)).Root, "attachments").Should().Contain([BillPhoto, FarmPhoto], "his own bills");
        foreach (var seat in new[] { CoOwner, Mukadam, Worker })
        {
            var attachments = IdsOf((await PullAsync(seat)).Root, "attachments");
            attachments.Should().NotContain(BillPhoto, $"{seat}: a bill is money");
            attachments.Should().NotContain(FarmPhoto, $"{seat}: a farm-linked photo is a bill of an earlier build");
        }

        (await GetAsync($"/shramsafal/attachments/{BillPhoto}", Owner)).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync($"/shramsafal/attachments/{BillPhoto}", Mukadam)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync($"/shramsafal/attachments/{FarmPhoto}", Mukadam)).Status.Should().Be(HttpStatusCode.Forbidden);
        var (listStatus, list) = await GetAsync($"/shramsafal/attachments?entityId={FarmA}&entityType=Bill", Mukadam);
        listStatus.Should().Be(HttpStatusCode.OK, list);
        list.Should().NotContain(BillPhoto.ToString());
    }

    // ── F3 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Founder D-66 = option 1. The owner says "आज ५ मजूर, प्रत्येकी ४०० रुपये" — no keyed amount at all, the money is
    /// only in his WORDS. The मुकादम holds confirm-records (so he may hear words) but not see money: he gets the work
    /// (the item, its title) and not one word of that record, nor its voice; a record without money keeps its words.
    /// </summary>
    [Fact]
    public async Task F3_the_words_and_voice_of_a_record_that_mentions_money_go_only_to_a_seat_that_sees_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.ConfirmRecords);
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-money-words", WordsLog(MoneyWordsLog,
            "आज ५ मजूर लावले, प्रत्येकी ४०० रुपये दिले", "छाटणी केली", "छाटणी ४०० रुपये"));
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-plain-words", WordsLog(PlainWordsLog,
            "आज बागेत छाटणी केली", "छाटणी केली", "छाटणी"));

        var (mukadamBody, mukadam) = await PullAsync(Mukadam);
        var withheld = LogOf(mukadam, MoneyWordsLog);
        withheld.GetProperty("wordsWithheldForMoney").GetBoolean().Should().BeTrue();
        var document = withheld.GetProperty("content").GetProperty("document");
        document.TryGetProperty("fullTranscript", out _).Should().BeFalse("his words state money");
        var item = document.GetProperty("cropActivities")[0];
        item.GetProperty("title").GetString().Should().Be("छाटणी", "the work itself travels: he can still confirm it");
        item.TryGetProperty("sourceText", out _).Should().BeFalse();
        item.TryGetProperty("systemInterpretation", out _).Should().BeFalse();
        mukadamBody.Should().NotContain("४०० रुपये", "not one word of a record that mentions money");

        var plain = LogOf(mukadam, PlainWordsLog);
        plain.GetProperty("content").GetProperty("document").GetProperty("fullTranscript").GetString()
            .Should().Be("आज बागेत छाटणी केली", "a record without money keeps its words for a confirmer");
        (plain.TryGetProperty("wordsWithheldForMoney", out var flag) && flag.ValueKind == JsonValueKind.True)
            .Should().BeFalse("nothing was withheld from a record without money");

        var (ownerBody, _) = await PullAsync(Owner);
        ownerBody.Should().Contain("प्रत्येकी ४०० रुपये दिले", "his own words, and the primary owner sees money");

        (await VoiceReasonAsync(MoneyWordsLog, Mukadam)).Should().Be("money_withheld", "nor its voice");
        (await VoiceReasonAsync(PlainWordsLog, Mukadam)).Should().Be("no_recording", "a record without money: as before");
        (await VoiceReasonAsync(MoneyWordsLog, Owner)).Should().Be("no_recording", "the speaker and the owner: as before");

        // The same rule on a command answer: the सहमालक's (money off) confirmation comes back without the words.
        var confirm = await PushAppliedAsync(CoOwner, "verify_log_v2", "fix1-confirm-money-words", Confirm(MoneyWordsLog, CoOwner));
        JsonSerializer.Serialize(confirm.Data, Web).Should().NotContain("४०० रुपये");
    }

    // ── F4 / F10 ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F4_a_seat_that_sees_money_but_not_wages_gets_the_crew_total_and_never_a_named_workers_pay()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney);
        var (body, root) = await PullAsync(Mukadam);

        var crew = LabourOf(root, OwnerLog);
        crew.GetProperty("totalCost").GetDecimal().Should().Be(OwnerCrewTotal, "a crew's total is MONEY");
        crew.GetProperty("wagePerPerson").ValueKind.Should().Be(JsonValueKind.Null, "a named worker's pay is a WAGE");
        crew.GetProperty("wageWithheld").GetBoolean().Should().BeTrue("F10: withheld by rule, never 'not stated'");
        IdsOf(root, "costEntries").Should().Contain(Cost, "the farm's money is his");
        IdsOf(root, "jobCards").Should().Equal([JobCard]);
        body.Should().NotContain("6129.37", "a job card's rate is a worker's pay");
        body.Should().NotContain("432.17");
    }

    // ── F5 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F5_a_confirm_answer_strips_what_the_pull_would()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (pulled, _) = await PullAsync(CoOwner);
        pulled.Should().NotContain("777.73", "the pull withholds the owner's input cost from the सहमालक (money off)");

        var answer = await PushAppliedAsync(CoOwner, "verify_log_v2", "fix1-confirm-owner", Confirm(OwnerLog, CoOwner));
        var body = JsonSerializer.Serialize(answer.Data, Web);
        Output.WriteLine($"[EVIDENCE] confirm answer: {body}");
        foreach (var amount in new[] { "777.73", "432.17", "3457.36" })
        {
            body.Should().NotContain(amount, "the answer strips what the pull would");
        }
    }

    // ── F7 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F7_the_worker_page_keeps_the_work_and_withholds_the_earnings_by_rule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/workers/{Worker2}/profile?farmId={FarmA}";
        var (status, body) = await GetAsync(url, CoOwner);
        status.Should().Be(HttpStatusCode.OK, $"the page is sent, never refused whole: {body}");
        JsonDocument.Parse(body).RootElement.GetProperty("earnedLast30d").ValueKind.Should().Be(JsonValueKind.Null, "withheld, never ₹0");

        var (ownerStatus, ownerBody) = await GetAsync(url, Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        JsonDocument.Parse(ownerBody).RootElement.GetProperty("earnedLast30d").ValueKind.Should().Be(JsonValueKind.Number);
    }

    // ── F8 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The मुकादम's phone holds the owner's record as it was sent to him: without its amounts. Before his edit
    /// arrives, the owner switches see money AND review money on for him. The edit says its copy came without
    /// amounts (amountsWithheld: true), so the amounts are carried — on edee6667 his authority at arrival decided,
    /// and the amount he was never shown was read as "no longer spent".
    /// </summary>
    [Fact]
    public async Task F8_an_edit_carries_the_amounts_by_what_the_phone_was_sent_not_the_switches_when_it_arrives()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, root) = await PullAsync(Mukadam);
        var log = LogOf(root, OwnerLog);
        var content = log.GetProperty("content");
        content.GetProperty("amountsWithheld").GetBoolean().Should().BeTrue("his copy says it came without amounts");
        var held = System.Text.Json.Nodes.JsonNode.Parse(content.GetProperty("document").GetRawText())!;
        held["inputs"]![0]!.AsObject()["quantity"] = 5;

        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        var result = await PushAppliedAsync(Mukadam, "revise_log_content", "fix1-revise-withheld", new Dictionary<string, object?>
        {
            ["dailyLogId"] = OwnerLog,
            ["baseVersion"] = content.GetProperty("version").GetInt32(),
            ["content"] = JsonDocument.Parse(held.ToJsonString()).RootElement,
            ["reason"] = "दुरुस्ती",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
            ["amountsWithheld"] = true,
        });
        Output.WriteLine($"[EVIDENCE] revise answer: {JsonSerializer.Serialize(result.Data, Web)}");

        using var stored = JsonDocument.Parse(await StoredDocumentAsync(OwnerLog));
        var input = stored.RootElement.GetProperty("inputs")[0];
        input.GetProperty("quantity").GetInt32().Should().Be(5, "his edit stands");
        input.GetProperty("cost").GetDecimal().Should().Be(OwnerInputCost, "the amount his copy never had is kept");
    }

    // ── F9 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F9_a_farm_the_phone_holds_and_may_no_longer_read_is_answered_by_name_never_by_absence()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var stranger = Guid.Parse("3d030000-0000-4000-8000-0000000000f9");

        var (_, paused) = await PullAsync(Paused, farms: [FarmA]);
        var pausedEntry = Scope(paused, FarmA);
        pausedEntry.GetProperty("status").GetString().Should().Be("Paused");
        pausedEntry.GetProperty("seeMoney").GetBoolean().Should().BeFalse();
        IdsOf(paused, "dailyLogs").Should().BeEmpty();

        var (_, other) = await PullAsync(OwnerB, farms: [FarmB, FarmA, stranger]);
        Scope(other, FarmB).GetProperty("status").GetString().Should().Be("Active");
        Scope(other, FarmA).GetProperty("status").GetString().Should().Be("Removed", "a removed seat's phone is told so by name");
        Scope(other, stranger).GetProperty("status").GetString().Should().Be("Removed");

        var (_, owner) = await PullAsync(Owner, farms: [FarmA]);
        ArrayOf(owner, "accessScopes").Should().ContainSingle("his own farm is listed once")
            .Which.GetProperty("status").GetString().Should().Be("Active", "the registrant is never told to remove his farm");

        var (_, silent) = await PullAsync(Paused);
        ArrayOf(silent, "accessScopes").Should().BeEmpty("a phone that names no farm is told nothing to remove");
    }

    // ── F11 ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F11_a_multi_farm_summary_that_leaves_a_farm_out_says_so()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                              permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farmA, @ownerB, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @accountA, 3, NULL, FALSE);
            """, ("farmA", FarmA), ("ownerB", OwnerB), ("accountA", AccountA));

        var (status, body) = await GetAsync("/shramsafal/finance/summary?groupBy=day", OwnerB);
        status.Should().Be(HttpStatusCode.OK, body);
        body.Should().Contain("5555.67", "his own farm's money");
        body.Should().NotContain("9876.54", "not the farm whose money is not his");
        JsonDocument.Parse(body).RootElement.GetProperty("farmsNotCounted").GetInt32().Should().Be(1, "and it says one farm is left out");
    }

    // ── Item 12 ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Item12_test_records_the_plan_compliance_and_the_attention_board_follow_the_farm_scope()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var list = $"/shramsafal/test-instances?cropCycleId={CycleA}";
        var (ownerList, ownerTests) = await GetAsync(list, Owner);
        ownerList.Should().Be(HttpStatusCode.OK, ownerTests);
        ownerTests.Should().Contain(TestRecord.ToString());
        foreach (var seat in new[] { Worker, OwnerB, Paused })
        {
            var (status, body) = await GetAsync(list, seat);
            status.Should().Be(HttpStatusCode.Forbidden, $"{seat}: not his to read: {body}");
        }

        (await GetAsync($"/shramsafal/test-instances/{TestRecord}", Owner)).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync($"/shramsafal/test-instances/{TestRecord}", Worker)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync($"/shramsafal/test-instances/{TestRecord}", OwnerB)).Status.Should()
            .BeOneOf([HttpStatusCode.NotFound, HttpStatusCode.Forbidden], "another farm's test record is not his");

        foreach (var url in new[] { $"/shramsafal/plan/today?cropCycleId={CycleA}", $"/shramsafal/plan/stage?cropCycleId={CycleA}" })
        {
            (await GetAsync(url, Owner)).Status.Should().Be(HttpStatusCode.OK);
            (await GetAsync(url, Worker)).Status.Should().Be(HttpStatusCode.Forbidden, "the farm's plan is its overview");
        }

        (await GetAsync($"/shramsafal/farms/{FarmA}/compliance", Mukadam)).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync($"/shramsafal/farms/{FarmA}/compliance", Worker)).Status.Should().Be(HttpStatusCode.Forbidden);

        var (ownerBoardStatus, ownerBoard) = await GetAsync("/shramsafal/attention", Owner);
        ownerBoardStatus.Should().Be(HttpStatusCode.OK, ownerBoard);
        ownerBoard.Should().Contain(PlotA.ToString(), "the owner's board names his plot");
        var (workerBoardStatus, workerBoard) = await GetAsync("/shramsafal/attention", Worker);
        workerBoardStatus.Should().Be(HttpStatusCode.OK, workerBoard);
        workerBoard.Should().NotContain(PlotA.ToString(), "the farm's board is its overview, not a कामगार's");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> WordsLog(Guid id, string transcript, string phrase, string notes) => new()
    {
        ["dailyLogId"] = id,
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["operatorUserId"] = Owner,
        ["logDate"] = WorkDay,
        ["content"] = new
        {
            schema = 1,
            fullTranscript = transcript,
            cropActivities = new object[]
            {
                new { id = "ca-1", title = "छाटणी", sourceText = phrase, systemInterpretation = phrase, notes },
            },
        },
    };

    private static Dictionary<string, object?> Confirm(Guid logId, Guid verifier) => new()
    {
        ["logId"] = logId,
        ["verifierUserId"] = verifier,
        ["decision"] = "verify",
        ["decidedAt"] = DateTime.UtcNow.ToString("O"),
    };

    /// <summary>
    /// The original-voice route's handler, asked exactly as the route asks it, user-scoped on the real host (the test
    /// host registers no voice archive; every answer here comes BEFORE any recording is read, so the archive and the
    /// erasure check are stand-ins that fail the test if they are ever reached).
    /// </summary>
    private Task<string?> VoiceReasonAsync(Guid logId, Guid user) => AsUserAsync(user, async sp =>
    {
        var handler = ActivatorUtilities.CreateInstance<GetLogOriginalVoiceHandler>(
            sp, NeverReached.Of<IRetainedBlobStore>(), NeverReached.Of<IAccountErasureCheck>());
        var result = await handler.HandleAsync(new GetLogOriginalVoiceQuery(logId, user));
        result.IsSuccess.Should().BeTrue("{0}", result.IsSuccess ? "" : result.Error.Code);
        result.Value!.Available.Should().BeFalse();
        Output.WriteLine($"[DOOR] {user} original voice of {logId} -> {result.Value.UnavailableReason}");
        return result.Value.UnavailableReason;
    });

    private async Task<string> StoredDocumentAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT document::text FROM ssf.daily_log_contents WHERE daily_log_id = @id ORDER BY content_version DESC LIMIT 1";
        cmd.Parameters.AddWithValue("id", logId);
        var stored = (string)(await cmd.ExecuteScalarAsync())!;
        Output.WriteLine($"[EVIDENCE] stored: {stored}");
        return stored;
    }

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(string url, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} GET {url} -> {(int)response.StatusCode}");
        return (response.StatusCode, body);
    }

    /// <summary>A stand-in whose every member fails the test: proof that the answer never reached it.</summary>
    public class NeverReached : System.Reflection.DispatchProxy
    {
        public static T Of<T>() where T : class => Create<T, NeverReached>();

        protected override object? Invoke(System.Reflection.MethodInfo? targetMethod, object?[]? args) =>
            throw new InvalidOperationException($"{targetMethod?.Name} was reached: the answer must come before any recording is read");
    }

    private static JsonElement LogOf(JsonElement root, Guid logId) =>
        ArrayOf(root, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == logId);

    private static JsonElement LabourOf(JsonElement root, Guid logId) =>
        LogOf(root, logId).GetProperty("labour").EnumerateArray().Single();

    private static JsonElement Scope(JsonElement root, Guid farmId) =>
        ArrayOf(root, "accessScopes").Single(s => s.GetProperty("farmId").GetGuid() == farmId);
}
