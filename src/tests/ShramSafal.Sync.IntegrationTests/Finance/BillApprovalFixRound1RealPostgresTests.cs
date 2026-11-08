// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 fix round 1 (independent review H1, M1–M4, L6; founder
// D-12, D-105 pending).
//
// On a real Postgres as agrisync_app (doctrine E3 first in every fact), through the real host:
//   H1  an own-records reviewer (स्वतःचं काम scope, or the कामगार label) holding see money + review money may approve and
//       correct ONLY what he may see: another person's bill is not found — on push and REST, with no figure and no version
//       in the answer;
//   L6  a bill kept from him by its audience (PRV) is not approvable either, and its figures never reach him;
//   M3  a bill changed after its approval is तपासायचे again (whatever its amount) until its new version is approved;
//   M2  a record edit's money change racing a money-book correction never loses a version step (both real handlers);
//   M4  the pull says it sends every bill with its version (`billVersions`), so a phone that pulled before can ask once.
// Every fact speaks only the WIRE and the database, so it compiles on 9849ad72 and fails there.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Finance;

[Trait("Category", "RequiresPostgres")]
public sealed class BillApprovalFixRound1RealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Approve = "approve_cost_entry";
    private const string NotFound = "ShramSafal.CostEntryNotFound";
    private const string CostText = "9876.54";

    private static readonly Guid OwnBill = Guid.Parse("b1120000-0000-4000-8000-000000000001");
    private static readonly Guid RaceLog = Guid.Parse("b1120000-0000-4000-8000-000000000002");
    private const decimal OwnBillAmount = 2468.97m;
    private const decimal RaceFirst = 30123.45m;

    private static string ApproveRoute(Guid id) => $"/shramsafal/finance/cost-entry/{id}/approve";

    private static string CorrectRoute(Guid id) => $"/shramsafal/finance/cost-entry/{id}/correct";

    // ── H1 ───────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("own-work")]
    [InlineData("worker-label")]
    public async Task H1_an_own_records_reviewer_may_approve_and_correct_only_his_own_bills(string seat)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var reviewer = seat == "own-work" ? Mukadam : Worker;
        await SetAuthoritiesAsync(FarmA, reviewer, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        if (seat == "own-work")
        {
            using var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                new { plotScope = "OwnWork", plotIds = (Guid[]?)null });
            scoped.StatusCode.Should().Be(HttpStatusCode.OK, await scoped.Content.ReadAsStringAsync());
        }

        await PushAppliedAsync(reviewer, "add_cost_entry", $"bill1-f1-own-{seat}", CostPayload(OwnBill, FarmA, PlotA, CycleA, OwnBillAmount));
        await Task.Delay(1150);

        // His pull carries his own bill and never the owner's (the read rule this door must match).
        var (pullBody, pulled) = await PullAsync(reviewer);
        IdsOf(pulled, "costEntries").Should().Contain(OwnBill).And.NotContain(Cost);
        pullBody.Should().NotContain(CostText);

        // Approve another person's bill: not found, exactly as a bill of another farm — and no figure, no version.
        foreach (var version in new[] { 1, 7 })
        {
            var pushed = await PushAsync(reviewer, Approve, $"bill1-f1-{seat}-approve-{version}", ApprovePayload(Cost, version));
            Output.WriteLine($"[EVIDENCE] {seat} approves the owner's bill v{version} -> {pushed.Status} {pushed.ErrorCode}");
            pushed.Status.Should().NotBe("applied");
            pushed.ErrorCode.Should().Be(NotFound);
            JsonSerializer.Serialize(pushed).Should().NotContain(CostText);

            var (rest, restBody) = await PostAsync(reviewer, ApproveRoute(Cost), new { billVersion = version });
            rest.Should().Be(HttpStatusCode.NotFound, restBody);
            restBody.Should().NotContain(CostText).And.NotContain("billVersion", "a wrong version is never a version oracle");
        }

        // Correct another person's bill: the same answer (the review's note: the money book's own door had the same gap).
        var correct = await PushAsync(reviewer, "correct_cost_entry", $"bill1-f1-{seat}-correct", CorrectPayload(Cost, 1111m));
        Output.WriteLine($"[EVIDENCE] {seat} corrects the owner's bill -> {correct.Status} {correct.ErrorCode}");
        correct.Status.Should().NotBe("applied");
        correct.ErrorCode.Should().Be(NotFound);
        JsonSerializer.Serialize(correct).Should().NotContain(CostText);
        var (restCorrect, restCorrectBody) = await PostAsync(reviewer, CorrectRoute(Cost),
            new { correctedAmount = 1111m, currencyCode = "INR", reason = "दुसऱ्याचं बिल" });
        restCorrect.Should().Be(HttpStatusCode.NotFound, restCorrectBody);
        restCorrectBody.Should().NotContain(CostText);

        (await CountAsync("SELECT count(*) FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", Cost)).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", Cost)).Should().Be(0);

        // His own bill stays his to approve (the self-approval rule waits for the founder, D-105; as built until then).
        var own = await PushAsync(reviewer, Approve, $"bill1-f1-{seat}-own", ApprovePayload(OwnBill, 1));
        own.Status.Should().Be("applied", "{0}: {1}", own.ErrorCode, own.ErrorMessage);
    }

    // ── L6 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task L6_a_bill_kept_from_the_reviewer_by_its_audience_is_not_approvable_and_its_figures_never_reach_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        await PushAppliedAsync(Owner, "set_record_audience", "bill1-f1-only-me", new Dictionary<string, object?>
        {
            ["recordKind"] = "CostEntry",
            ["recordId"] = Cost,
            ["audience"] = "OnlyMe",
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });

        var pushed = await PushAsync(Mukadam, Approve, "bill1-f1-prv", ApprovePayload(Cost, 1));
        Output.WriteLine($"[EVIDENCE] audience-closed bill -> {pushed.Status} {pushed.ErrorCode}");
        pushed.Status.Should().NotBe("applied");
        JsonSerializer.Serialize(pushed).Should().NotContain(CostText);
        var (rest, restBody) = await PostAsync(Mukadam, ApproveRoute(Cost), new { billVersion = 1 });
        rest.Should().NotBe(HttpStatusCode.OK, restBody);
        restBody.Should().NotContain(CostText);
        (await CountAsync("SELECT count(*) FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", Cost)).Should().Be(0);
    }

    // ── M3 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M3_a_price_change_by_the_owner_after_approval_is_approved_straight_away_not_taken_for_review()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // ₹9,876.54: never set aside by the amount rule.
        await PushAppliedAsync(Owner, Approve, "bill1-f1-m3-v1", ApprovePayload(Cost, 1));
        await Task.Delay(1150);
        var approved = Bill((await PullAsync(Owner)).Root, Cost);
        approved.GetProperty("needsReview").GetBoolean().Should().BeFalse();

        // Lane FIX-1 round 2 (founder, 2026-11-08): the main owner's change of an approved price counts as approved straight away
        // (it was "taken for review again" before). The review-again rule itself stays for every other new version (CostEntryReview).
        await PushAppliedAsync(Owner, "correct_cost_entry", "bill1-f1-m3-correct", CorrectPayload(Cost, 9999.99m));
        await Task.Delay(1150);
        var changed = Bill((await PullAsync(Owner)).Root, Cost);
        Output.WriteLine($"[EVIDENCE] after the owner's correction: {changed}");
        changed.GetProperty("billVersion").GetInt32().Should().Be(2);
        changed.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(2, "approved for the version the owner made");
        changed.GetProperty("needsReview").GetBoolean().Should().BeFalse("the main owner's change does not wait for review");
        changed.TryGetProperty("reviewReason", out _).Should().BeFalse();

        // Approving that version again is answered as it stands (one person, one version, one stamp).
        await PushAppliedAsync(Owner, Approve, "bill1-f1-m3-v2", ApprovePayload(Cost, 2));
        await Task.Delay(1150);
        Bill((await PullAsync(Owner)).Root, Cost).GetProperty("needsReview").GetBoolean().Should().BeFalse();
    }

    // ── M2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M2_a_record_edit_racing_a_money_book_correction_never_loses_a_version_step()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var money = MoneyEntryIdentity.ForRecordLine(RaceLog, MoneyEntryIdentity.Input, "in-1");
        // The मुकादम makes the record and its first money (he may restate his own prices); the owner reviews money. Two
        // people on two phones: each push is its own transaction, so neither waits for the other except on the bill itself.
        await PushAppliedAsync(Mukadam, "create_daily_log", "bill1-f1-race-log", RaceLogPayload(RaceFirst));
        await PushAppliedAsync(Mukadam, "add_cost_entry", "bill1-f1-race-money", CostPayload(money, FarmA, PlotA, CycleA, RaceFirst));

        // Writer 0: something else holds the bill (as any change in flight would).
        await using var holder = new NpgsqlConnection(SuperuserConn);
        await holder.OpenAsync();
        await using var tx = await holder.BeginTransactionAsync();
        await using (var hold = holder.CreateCommand())
        {
            hold.Transaction = tx;
            hold.CommandText = """SELECT 1 FROM ssf.cost_entries WHERE "Id" = @id FOR UPDATE""";
            hold.Parameters.AddWithValue("id", money);
            await hold.ExecuteNonQueryAsync();
        }

        // Writer 1: the owner corrects the bill in the money book. Writer 2: the maker's record edit restates its price.
        var book = Task.Run(() => PushAsync(Owner, "correct_cost_entry", "bill1-f1-race-book", CorrectPayload(money, 28000m)));
        (await WaitForLockWaitersAsync(1)).Should().BeTrue("arrange: the money-book correction waits on the held bill");
        var edit = Task.Run(() => PushAsync(Mukadam, "revise_log_content", "bill1-f1-race-edit", new Dictionary<string, object?>
        {
            ["dailyLogId"] = RaceLog,
            ["baseVersion"] = 1,
            ["content"] = RaceContent(35000m),
            ["reason"] = "दर बदलला",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        }));
        // On the base the edit read the bill (and its corrections) without waiting and now waits only to WRITE; with the
        // row hold it waits before it reads. Either way it is the second waiter, and only then is the bill let go.
        var bothWaiting = await WaitForLockWaitersAsync(2);
        Output.WriteLine($"[EVIDENCE] both writers waiting on the bill before it was let go: {bothWaiting}");
        await tx.CommitAsync();

        var bookResult = await book;
        var editResult = await edit;
        Output.WriteLine($"[EVIDENCE] money book -> {bookResult.Status} {bookResult.ErrorCode}; edit -> {editResult.Status} {editResult.ErrorCode}");
        Output.WriteLine($"[EVIDENCE] edit answer: {JsonSerializer.Serialize(editResult.Data)}");
        bookResult.Status.Should().Be("applied");
        editResult.Status.Should().Be("applied", "the edit itself always lands (P9)");

        var version = await ScalarIntAsync("""SELECT content_version FROM ssf.cost_entries WHERE "Id" = @id""", money);
        var corrections = await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", money);
        Output.WriteLine($"[EVIDENCE] content_version={version}; corrections={corrections}");
        version.Should().Be(1 + (int)corrections, "every change of the bill's money is one version step — none is lost to a race");
    }

    // ── M4 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M4_the_pull_says_it_sends_every_bill_with_its_version()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, root) = await PullAsync(Owner);
        root.GetProperty("billVersions").GetBoolean().Should().BeTrue(
            "a phone that pulled its bills before BILL-1 learns it may ask once for every bill again");
        Bill(root, Cost).GetProperty("billVersion").GetInt32().Should().Be(1);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> ApprovePayload(Guid bill, int version) => new()
    {
        ["approvalId"] = Guid.NewGuid(),
        ["costEntryId"] = bill,
        ["farmId"] = FarmA,
        ["billVersion"] = version,
    };

    private static Dictionary<string, object?> CorrectPayload(Guid bill, decimal amount) => new()
    {
        ["financeCorrectionId"] = Guid.NewGuid(),
        ["costEntryId"] = bill,
        ["correctedAmount"] = amount,
        ["currencyCode"] = "INR",
        ["reason"] = "बिल पुन्हा पाहिलं",
    };

    private static object RaceContent(decimal cost) => new
    {
        schema = 1,
        inputs = new object[] { new { id = "in-1", productName = "इथरेल", quantity = 250, unit = "मिली", cost } },
    };

    private static Dictionary<string, object?> RaceLogPayload(decimal cost) => new()
    {
        ["dailyLogId"] = RaceLog,
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["operatorUserId"] = Mukadam,
        ["logDate"] = WorkDay,
        ["content"] = RaceContent(cost),
    };

    private static JsonElement Bill(JsonElement root, Guid id)
    {
        var rows = ArrayOf(root, "costEntries").Where(e => e.GetProperty("id").GetGuid() == id).ToList();
        rows.Should().ContainSingle($"the pull carries bill {id}");
        return rows[0];
    }

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REST] POST {url} by {user} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var exists = db.CreateCommand();
        exists.CommandText = "SELECT to_regclass('ssf.cost_entry_approvals') IS NOT NULL";
        if (!(bool)(await exists.ExecuteScalarAsync())! && sql.Contains("cost_entry_approvals", StringComparison.Ordinal))
        {
            return 0;
        }

        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    /// <summary>Waits (up to a minute) until at least <paramref name="count"/> sessions of this database wait on a lock.</summary>
    private async Task<bool> WaitForLockWaitersAsync(int count)
    {
        var until = DateTime.UtcNow.AddMinutes(1);
        while (DateTime.UtcNow < until)
        {
            await using var db = new NpgsqlConnection(SuperuserConn);
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                SELECT count(*) FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'
                """;
            if ((long)(await cmd.ExecuteScalarAsync())! >= count)
            {
                return true;
            }

            await Task.Delay(100);
        }

        return false;
    }

    private async Task<int> ScalarIntAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }
}
