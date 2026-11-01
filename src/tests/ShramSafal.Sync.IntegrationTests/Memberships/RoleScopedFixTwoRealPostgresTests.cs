// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 fix pass 2 — the re-review's N1-N5, each proved on a real
// Postgres as agrisync_app (E3 first) through the real host and the real routes, cursors sent as a phone sends them:
//   N1  an installed 1.0.17 phone (or any caller that does not say it is newer) is never sent a null pay it would
//       draw as "INR 0" / "0k": it is refused, as edee6667 refused it; the new phone gets the null (W3);
//   N2  an edit made on a copy trimmed of its amounts is never refused and never erases them;
//   N3  a job card's payout id goes with its pay (it would join a named worker to his payout's amount);
//   N4  D-67 — the words and voice of a record that mentions money need SEE WAGES, not only see money;
//   N5  a farm the phone holds no data for comes back whole from the beginning, once.
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
public sealed class RoleScopedFixTwoRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly Guid WagesInWordsLog = Guid.Parse("3d030000-0000-4000-8000-000000000081");

    // ── N1 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task N1_a_phone_that_would_draw_a_withheld_pay_as_0_is_refused_and_the_new_phone_gets_it_withheld()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("UPDATE ssf.job_cards SET assigned_worker_user_id = @w WHERE id = @jc", ("w", Worker2), ("jc", JobCard));
        var farmCards = $"/shramsafal/farms/{FarmA}/job-cards";
        var workerCards = $"/shramsafal/workers/{Worker2}/job-cards?farmId={FarmA}";
        var ownCards = $"/shramsafal/workers/{Worker2}/job-cards";
        var profile = $"/shramsafal/workers/{Worker2}/profile?farmId={FarmA}";

        // 1.0.17's job-card and worker-page calls send no version at all; an explicit 1.0.17, an older or a garbled one
        // is answered the same way.
        foreach (var version in new string?[] { null, "1.0.17", "1.0.9", "unknown" })
        {
            (await GetAsync(farmCards, Mukadam, version)).Status.Should().Be(HttpStatusCode.Forbidden, $"{version ?? "no version"}: never a null pay");
            (await GetAsync(workerCards, CoOwner, version)).Status.Should().Be(HttpStatusCode.Forbidden, $"{version ?? "no version"}");
            (await GetAsync(profile, CoOwner, version)).Status.Should().Be(HttpStatusCode.Forbidden, $"{version ?? "no version"}: never '0k'");
        }

        // Nothing is withheld from the owner: 1.0.17 reads his cards as before.
        var (ownerStatus, ownerBody) = await GetAsync(farmCards, Owner, null);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        ownerBody.Should().Contain("6129.37");

        // The new phone gets the work with the pay withheld (null, shown by rule), never refused.
        var (newStatus, newBody) = await GetAsync(farmCards, Mukadam, "1.0.18");
        newStatus.Should().Be(HttpStatusCode.OK, newBody);
        JsonDocument.Parse(newBody).RootElement[0].GetProperty("estimatedTotalAmount").ValueKind.Should().Be(JsonValueKind.Null);
        // The worker page's list, read for the farm the page names (fix 2: the route reads that farm's scope).
        var (workerStatus, workerBody) = await GetAsync(workerCards, CoOwner, "1.0.18");
        workerStatus.Should().Be(HttpStatusCode.OK, workerBody);
        JsonDocument.Parse(workerBody).RootElement.EnumerateArray().Select(j => j.GetProperty("id").GetGuid()).Should().Equal([JobCard]);
        workerBody.Should().NotContain("6129.37", "his pay is withheld by rule");

        // His own list: nothing is withheld from him, so even a phone that says no version reads it whole.
        var (ownStatus, ownBody) = await GetAsync(ownCards, Worker2, null);
        ownStatus.Should().Be(HttpStatusCode.OK, ownBody);
        ownBody.Should().Contain("6129.37", "his own pay is his");
        var (pageStatus, pageBody) = await GetAsync(profile, CoOwner, "1.0.18");
        pageStatus.Should().Be(HttpStatusCode.OK, pageBody);
        JsonDocument.Parse(pageBody).RootElement.GetProperty("earnedLast30d").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // ── N2 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The मुकादम (take हजेरी, no see money) holds the owner's priced record as his phone held it before MU-3, then trimmed
    /// of its amounts by a purge that did not say so. His edit therefore says <c>amountsWithheld: false</c>. It must not be
    /// refused as "changes a price", and the ₹777.73 he was never left holding must stay.
    /// </summary>
    [Fact]
    public async Task N2_an_edit_on_an_older_copy_trimmed_without_saying_so_is_not_refused_and_keeps_its_amounts()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (version, held) = await TrimmedCopyAsync();

        var result = await PushAsync(Mukadam, "revise_log_content", "fix2-n2-false", Revise(version, held, amountsWithheld: false));
        result.Status.Should().Be("applied", "{0}: {1}", result.ErrorCode, result.ErrorMessage);
        await AssertKeptAsync(quantity: 7);
    }

    /// <summary>
    /// The same copy, now said to be trimmed (the purge sets it); the owner grants see money AND review money while the edit
    /// waits. The amounts are still kept: the carry follows what the phone was sent.
    /// </summary>
    [Fact]
    public async Task N2_see_money_and_review_money_granted_while_the_edit_waits_still_keep_the_amounts()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (version, held) = await TrimmedCopyAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);

        var result = await PushAsync(Mukadam, "revise_log_content", "fix2-n2-granted", Revise(version, held, amountsWithheld: true));
        result.Status.Should().Be("applied", "{0}: {1}", result.ErrorCode, result.ErrorMessage);
        await AssertKeptAsync(quantity: 7);
    }

    // ── N3 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task N3_a_job_cards_payout_id_goes_with_its_pay()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("UPDATE ssf.job_cards SET payout_cost_entry_id = @cost WHERE id = @jc", ("cost", Cost), ("jc", JobCard));
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney);

        // He sees the farm's money (the payout entry and its amount) but not wages: no id may join the two.
        var (_, pulled) = await PullAsync(Mukadam);
        IdsOf(pulled, "costEntries").Should().Contain(Cost);
        var card = ArrayOf(pulled, "jobCards").Single();
        card.GetProperty("payoutCostEntryId").ValueKind.Should().Be(JsonValueKind.Null, "the join key goes with the pay");

        var (status, body) = await GetAsync($"/shramsafal/farms/{FarmA}/job-cards", Mukadam, "1.0.18");
        status.Should().Be(HttpStatusCode.OK, body);
        JsonDocument.Parse(body).RootElement[0].GetProperty("payoutCostEntryId").ValueKind.Should().Be(JsonValueKind.Null);

        var (_, owner) = await GetAsync($"/shramsafal/farms/{FarmA}/job-cards", Owner, "1.0.18");
        JsonDocument.Parse(owner).RootElement[0].GetProperty("payoutCostEntryId").GetGuid().Should().Be(Cost, "the owner sees wages");
    }

    // ── N4 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// D-67: a confirmer who sees the farm's money but NOT wages, on the owner's record whose words state a named worker's
    /// pay ("रवीला ५०० रु. दिले"). He gets the work, none of the words, and not the voice; with see wages he hears them.
    /// </summary>
    [Fact]
    public async Task N4_a_seat_with_see_money_but_not_see_wages_gets_no_words_of_a_record_that_states_a_workers_pay()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.ConfirmRecords, FarmAuthority.SeeMoney);
        await PushAppliedAsync(Owner, "create_daily_log", "fix2-n4-words", new Dictionary<string, object?>
        {
            ["dailyLogId"] = WagesInWordsLog,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = Owner,
            ["logDate"] = WorkDay,
            ["content"] = new
            {
                schema = 1,
                fullTranscript = "आज छाटणी केली, रवीला ५०० रु. दिले",
                cropActivities = new object[] { new { id = "ca-1", title = "छाटणी", sourceText = "छाटणी केली" } },
            },
        });

        var (body, root) = await PullAsync(Mukadam);
        var log = ArrayOf(root, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == WagesInWordsLog);
        log.GetProperty("wordsWithheldForMoney").GetBoolean().Should().BeTrue();
        var document = log.GetProperty("content").GetProperty("document");
        document.TryGetProperty("fullTranscript", out _).Should().BeFalse("his words state a worker's pay");
        document.GetProperty("cropActivities")[0].GetProperty("title").GetString().Should().Be("छाटणी", "the work stays");
        body.Should().NotContain("रवीला ५०० रु.");
        (await VoiceReasonAsync(WagesInWordsLog, Mukadam)).Should().Be("money_withheld");

        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.ConfirmRecords, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        var (withWages, _) = await PullAsync(Mukadam);
        withWages.Should().Contain("रवीला ५०० रु. दिले", "with see wages he hears them");
    }

    // ── N5 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The मुकादम's phone lost farm A (a wrong "Removed", or it never received it) and names the farms it holds: none.
    /// With its cursor already past everything and no access change, farm A comes back whole — once. A phone that names
    /// no farms at all (1.0.17) is not changed.
    /// </summary>
    [Fact]
    public async Task N5_a_farm_the_phone_holds_no_data_for_comes_back_whole_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // His older record: only a read from the beginning can bring it (whole-second cursors re-send the newest second).
        await ExecOnSuperuserAsync(
            "UPDATE ssf.daily_logs SET modified_at_utc = modified_at_utc - INTERVAL '1 hour' WHERE \"Id\" = @log", ("log", OwnerLog));
        var (_, first) = await PullAsync(Mukadam, farms: [FarmA]);
        var cursor = first.GetProperty("nextCursorUtc").GetDateTime();

        var (_, silent) = await PullAsync(Mukadam, cursor);
        IdsOf(silent, "dailyLogs").Should().NotContain(OwnerLog, "a phone that names no farms (1.0.17) is unchanged");

        var (_, back) = await PullAsync(Mukadam, cursor, farms: []);
        IdsOf(back, "farms").Should().Contain(FarmA, "the farm's own row comes back, so the phone names it next time");
        IdsOf(back, "dailyLogs").Should().Contain(OwnerLog, "the farm comes back whole");

        var (_, after) = await PullAsync(Mukadam, back.GetProperty("nextCursorUtc").GetDateTime(), farms: [FarmA]);
        IdsOf(after, "dailyLogs").Should().NotContain(OwnerLog, "once: the phone holds it now");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    /// <summary>The owner's record as a pre-MU-3 phone held it (whole), then trimmed of its amounts.</summary>
    private async Task<(int Version, System.Text.Json.Nodes.JsonNode Held)> TrimmedCopyAsync()
    {
        var (_, owner) = await PullAsync(Owner);
        var content = ArrayOf(owner, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == OwnerLog).GetProperty("content");
        var held = System.Text.Json.Nodes.JsonNode.Parse(content.GetProperty("document").GetRawText())!;
        var item = held["inputs"]![0]!.AsObject();
        item.Remove("cost");
        item["numbers"]?.AsObject().Remove("cost");
        item["quantity"] = 7;
        held.ToJsonString().Should().NotContain("777.73");
        return (content.GetProperty("version").GetInt32(), held);
    }

    private static Dictionary<string, object?> Revise(int version, System.Text.Json.Nodes.JsonNode held, bool amountsWithheld) => new()
    {
        ["dailyLogId"] = OwnerLog,
        ["baseVersion"] = version,
        ["content"] = JsonDocument.Parse(held.ToJsonString()).RootElement,
        ["reason"] = "दुरुस्ती",
        ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        ["amountsWithheld"] = amountsWithheld,
    };

    private async Task AssertKeptAsync(int quantity)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT document::text FROM ssf.daily_log_contents WHERE daily_log_id = @id ORDER BY content_version DESC LIMIT 1";
        cmd.Parameters.AddWithValue("id", OwnerLog);
        var stored = (string)(await cmd.ExecuteScalarAsync())!;
        Output.WriteLine($"[EVIDENCE] stored after the edit: {stored}");
        using var doc = JsonDocument.Parse(stored);
        var input = doc.RootElement.GetProperty("inputs")[0];
        input.GetProperty("quantity").GetInt32().Should().Be(quantity, "his edit stands");
        input.GetProperty("cost").GetDecimal().Should().Be(OwnerInputCost, "an amount his copy did not hold is never erased");
    }

    private Task<string?> VoiceReasonAsync(Guid logId, Guid user) => AsUserAsync(user, async sp =>
    {
        var handler = ActivatorUtilities.CreateInstance<GetLogOriginalVoiceHandler>(
            sp, RoleScopedFixOneRealPostgresTests.NeverReached.Of<IRetainedBlobStore>(),
            RoleScopedFixOneRealPostgresTests.NeverReached.Of<IAccountErasureCheck>());
        var result = await handler.HandleAsync(new GetLogOriginalVoiceQuery(logId, user));
        result.IsSuccess.Should().BeTrue("{0}", result.IsSuccess ? "" : result.Error.Code);
        Output.WriteLine($"[DOOR] {user} original voice of {logId} -> {result.Value!.UnavailableReason}");
        return result.Value!.UnavailableReason;
    });

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(string url, Guid user, string? appVersion)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user, appVersion: appVersion);
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} GET {url} (version {appVersion ?? "none"}) -> {(int)response.StatusCode}");
        return (response.StatusCode, body);
    }
}
