// spec: plr-d10-redesign-real-integration-2026-10-25 — lane FIX-1, fix 2 (BILL-1b; founder D-105 (b), answered 2026-11-08:
// "Only you, the main owner, can change an approved bill's price. The bill then shows 'changed by owner' to everyone, you
// included.").
//
// On a real Postgres as agrisync_app (doctrine E3 first in every fact), through the real host and the real handlers:
//   A  a reviewer (review money) cannot change an APPROVED bill's amount - on the sync push AND the REST route, with the plain
//      reason (a three-segment code ending CONFLICT, so every phone parks it, never loses it) - while the primary account holder
//      can; his change keeps the old stamp in the history and the pull then carries the mark (`changedByOwnerAtUtc`) to
//      EVERYONE who receives the bill, the owner included. ROUND 2 (founder, 2026-11-08): his change counts as approved
//      straight away - the bill is approved for the new version by the owner (his own stamp, audited) and does NOT go back to
//      "तपासायचे";
//   D  the same on the REST route;  E  an unapproved bill the owner changes gets no stamp (unchanged by the rule);
//   B  a bill nobody approved is unchanged by the rule: a reviewer corrects it as before, and no mark appears (not even after
//      it is approved later);
//   C  the other door to a bill's price - a record edit restating a priced line - lands for a maker/reviewer who is not the
//      owner but leaves an approved bill's amount alone (said: `approvedPriceLocked`), and changes it for the owner (the mark).
// Every fact speaks only the WIRE and the database.
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
public sealed class BillPriceLockRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Approve = "approve_cost_entry";
    private const string Correct = "correct_cost_entry";
    private const string LockedCode = "ShramSafal.BillPrice.Conflict";
    private const string MarkKey = "changedByOwnerAtUtc";

    private static readonly Guid FreshBill = Guid.Parse("b1b20000-0000-4000-8000-000000000001");
    private static readonly Guid EditLog = Guid.Parse("b1b20000-0000-4000-8000-000000000002");

    private static string CorrectRoute(Guid id) => $"/shramsafal/finance/cost-entry/{id}/correct";

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_a_reviewer_cannot_change_an_approved_bills_price_the_owner_can_and_the_mark_shows_to_everyone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);

        // The owner approves the bill (₹9,876.54, never set aside by the amount rule).
        await PushAppliedAsync(Owner, Approve, "bill1b-a-approve-1", ApprovePayload(Cost, 1));

        // The reviewer cannot change its price: refused with the plain code, on the push ...
        var refused = await PushAsync(Mukadam, Correct, "bill1b-a-mukadam-push", CorrectPayload(Cost, 1111.11m));
        Output.WriteLine($"[EVIDENCE] reviewer corrects an approved bill (push) -> {refused.Status} {refused.ErrorCode}: {refused.ErrorMessage}");
        refused.Status.Should().NotBe("applied");
        refused.ErrorCode.Should().Be(LockedCode);
        refused.ErrorCode!.Split('.').Should().HaveCount(3, "three segments, tail CONFLICT: every shipped phone parks it where the farmer sees it");
        refused.ErrorCode.Split('.')[^1].Should().Be("Conflict");
        refused.ErrorMessage.Should().Contain("main owner").And.Contain("approved");

        // ... and on the REST route (409 with the same code and reason).
        var (rest, restBody) = await PostAsync(Mukadam, CorrectRoute(Cost),
            new { correctedAmount = 1111.11m, currencyCode = "INR", reason = "दर बदलला" });
        rest.Should().Be(HttpStatusCode.Conflict, restBody);
        using (var doc = JsonDocument.Parse(restBody))
        {
            doc.RootElement.GetProperty("error").GetString().Should().Be(LockedCode);
            doc.RootElement.GetProperty("message").GetString().Should().Contain("main owner");
        }

        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", Cost)).Should().Be(0, "nothing was changed");
        (await ScalarIntAsync("""SELECT content_version FROM ssf.cost_entries WHERE "Id" = @id""", Cost)).Should().Be(1);

        // Nothing changed, so no mark, for the owner or for him.
        await Task.Delay(1150);
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, Cost);
            bill.TryGetProperty(MarkKey, out _).Should().BeFalse("no change by the owner yet - the key is absent, not null");
            bill.GetProperty("needsReview").GetBoolean().Should().BeFalse();
        }

        // The owner changes the price: allowed.
        var before = DateTime.UtcNow.AddSeconds(-2);
        await PushAppliedAsync(Owner, Correct, "bill1b-a-owner-push", CorrectPayload(Cost, 9999.99m));
        await Task.Delay(1150);

        // Round 2 (founder, 2026-11-08): the owner's change counts as approved straight away. The bill carries the mark to EVERYONE
        // who receives it - the reviewer AND the owner himself - is approved for the NEW version (by the owner), and keeps the
        // old stamp in its history. It does NOT go back to तपासायचे.
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, Cost);
            Output.WriteLine($"[EVIDENCE] {(who == Owner ? "owner" : "reviewer")} receives: {bill}");
            bill.GetProperty(MarkKey).GetDateTime().ToUniversalTime().Should().BeAfter(before, "the day the owner changed it");
            bill.GetProperty("billVersion").GetInt32().Should().Be(2);
            var stamp = bill.GetProperty("approval");
            stamp.GetProperty("billVersion").GetInt32().Should().Be(2, "approved straight away, for the version the owner made");
            stamp.GetProperty("approvedByUserId").GetGuid().Should().Be(Owner, "his stamp, not anyone else's");
            bill.GetProperty("needsReview").GetBoolean().Should().BeFalse("the main owner's change does not wait for a reviewer");
            bill.TryGetProperty("reviewReason", out _).Should().BeFalse("nothing to review, so no reason is sent");
        }

        var stamps = await StampsAsync(Cost);
        Output.WriteLine("[EVIDENCE] stamps (by version): " + string.Join(" | ", stamps.Select(s => $"v{s.Version} by {(s.By == Owner ? "owner" : "other")}")));
        stamps.Select(s => s.Version).Should().Equal([1, 2], "the old stamp row is kept; the owner's own stamp for the new version is added");
        stamps.Single(s => s.Version == 2).By.Should().Be(Owner);
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", Cost)).Should().Be(1, "the owner's change, with who and when");

        // Still locked for the reviewer after the owner's change (the bill has been approved).
        var again = await PushAsync(Mukadam, Correct, "bill1b-a-mukadam-again", CorrectPayload(Cost, 2222.22m));
        again.ErrorCode.Should().Be(LockedCode);
        (await StampsAsync(Cost)).Should().HaveCount(2, "a refused change adds nothing");

        // The mark stays whatever happens next: a second owner change adds its own stamp (v3) and moves the date, never the review state.
        var markAt = Bill((await PullAsync(Owner)).Root, Cost).GetProperty(MarkKey).GetDateTime();
        await Task.Delay(1150);
        await PushAppliedAsync(Owner, Correct, "bill1b-a-owner-push-2", CorrectPayload(Cost, 10101.01m));
        await Task.Delay(1150);
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, Cost);
            bill.GetProperty("billVersion").GetInt32().Should().Be(3);
            bill.GetProperty("needsReview").GetBoolean().Should().BeFalse();
            bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(3);
            bill.GetProperty(MarkKey).GetDateTime().Should().BeAfter(markAt, "the date of his latest change");
        }
        (await StampsAsync(Cost)).Select(s => s.Version).Should().Equal([1, 2, 3]);

        // The answer to the approval door carries the mark too (the same projection as the pull), and approving the version the owner
        // already stamped is answered as it stands: no second stamp.
        var (approveStatus, approveBody) = await PostAsync(Owner, $"/shramsafal/finance/cost-entry/{Cost}/approve", new { billVersion = 3 });
        approveStatus.Should().Be(HttpStatusCode.OK, approveBody);
        using (var doc = JsonDocument.Parse(approveBody))
        {
            doc.RootElement.TryGetProperty(MarkKey, out _).Should().BeTrue("the approve door answers with the bill as the pull sends it");
            doc.RootElement.GetProperty("needsReview").GetBoolean().Should().BeFalse();
        }

        (await StampsAsync(Cost)).Should().HaveCount(3);
    }

    // ── D (round 2) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task D_the_owners_change_on_the_REST_route_is_approved_straight_away_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Owner, Approve, "bill1b-d-approve", ApprovePayload(Cost, 1));

        var (status, body) = await PostAsync(Owner, CorrectRoute(Cost), new { correctedAmount = 9500.5m, currencyCode = "INR", reason = "दर बदलला" });
        status.Should().Be(HttpStatusCode.OK, body);
        await Task.Delay(1150);

        var bill = Bill((await PullAsync(Owner)).Root, Cost);
        bill.GetProperty("billVersion").GetInt32().Should().Be(2);
        bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(2);
        bill.GetProperty("needsReview").GetBoolean().Should().BeFalse();
        bill.TryGetProperty(MarkKey, out _).Should().BeTrue();
        (await StampsAsync(Cost)).Select(s => s.Version).Should().Equal([1, 2]);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'Approved'", Cost))
            .Should().Be(2, "the first approval and the owner's stamp each have their audit row, like any approval");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'Approved' AND payload::text LIKE '%OwnerChangedApprovedPrice%'", Cost))
            .Should().Be(1, "and the owner's says why it was made");
    }

    // ── E (round 2) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task E_an_unapproved_bill_the_owner_changes_gets_no_stamp_and_stays_taken_for_review()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // ₹25,000 or more is set aside for review on its first save.
        await PushAppliedAsync(Owner, "add_cost_entry", "bill1b-e-add", CostPayload(FreshBill, FarmA, PlotA, CycleA, 31234.56m));
        await PushAppliedAsync(Owner, Correct, "bill1b-e-owner", CorrectPayload(FreshBill, 32109.87m));
        await Task.Delay(1150);

        (await StampsAsync(FreshBill)).Should().BeEmpty("nobody approved it, so the owner's change is not an approval");
        var bill = Bill((await PullAsync(Owner)).Root, FreshBill);
        bill.GetProperty("needsReview").GetBoolean().Should().BeTrue("an unapproved bill is unchanged by the rule");
        bill.TryGetProperty("approval", out _).Should().BeFalse();
        bill.TryGetProperty(MarkKey, out _).Should().BeFalse();
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task B_an_unapproved_bill_is_unchanged_by_the_rule_and_a_correction_before_the_approval_leaves_no_mark()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        await PushAppliedAsync(Owner, "add_cost_entry", "bill1b-b-add", CostPayload(FreshBill, FarmA, PlotA, CycleA, 3210.45m));

        // Nobody approved it: the reviewer corrects it exactly as before (push and REST), and so does the owner.
        await PushAppliedAsync(Mukadam, Correct, "bill1b-b-mukadam-push", CorrectPayload(FreshBill, 3300.45m));
        var (rest, restBody) = await PostAsync(Mukadam, CorrectRoute(FreshBill),
            new { correctedAmount = 3400.45m, currencyCode = "INR", reason = "फेरतपासणी" });
        rest.Should().Be(HttpStatusCode.OK, restBody);
        await PushAppliedAsync(Owner, Correct, "bill1b-b-owner-push", CorrectPayload(FreshBill, 3500.45m));
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", FreshBill)).Should().Be(3);

        // Approved only now (at its version 4): the corrections all came BEFORE the stamp, so they are ordinary - no mark.
        await Task.Delay(1150);
        await PushAppliedAsync(Owner, Approve, "bill1b-b-approve", ApprovePayload(FreshBill, 4));
        await Task.Delay(1150);
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, FreshBill);
            Output.WriteLine($"[EVIDENCE] approved after its corrections: {bill}");
            bill.TryGetProperty(MarkKey, out _).Should().BeFalse("a change before the approval is not 'changed by owner'");
            bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(4);
            bill.GetProperty("needsReview").GetBoolean().Should().BeFalse();
        }

        // And from now on the price is locked for the reviewer.
        var locked = await PushAsync(Mukadam, Correct, "bill1b-b-mukadam-late", CorrectPayload(FreshBill, 9.99m));
        locked.ErrorCode.Should().Be(LockedCode);
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task C_a_record_edit_cannot_change_an_approved_bills_price_unless_the_owner_makes_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var money = MoneyEntryIdentity.ForRecordLine(EditLog, MoneyEntryIdentity.Input, "in-1");
        // The मुकादम makes the record and its first money (the maker may restate his own prices); the owner approves the bill.
        await PushAppliedAsync(Mukadam, "create_daily_log", "bill1b-c-log", LogPayload(5000m));
        await PushAppliedAsync(Mukadam, "add_cost_entry", "bill1b-c-money", CostPayload(money, FarmA, PlotA, CycleA, 5000m));
        await PushAppliedAsync(Owner, Approve, "bill1b-c-approve", ApprovePayload(money, 1));

        // The maker restates the price: his edit lands (P9), the approved bill's amount does not move, and he is told why.
        var edit = await PushAsync(Mukadam, "revise_log_content", "bill1b-c-mukadam-edit", EditPayload(1, 7000m));
        Output.WriteLine($"[EVIDENCE] maker edits the price of an approved bill -> {edit.Status} {edit.ErrorCode}: {JsonSerializer.Serialize(edit.Data)}");
        edit.Status.Should().Be("applied", "the edit itself always lands (P9)");
        JsonSerializer.Serialize(edit.Data).Should().Contain("approvedPriceLocked");
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", money)).Should().Be(0, "the approved price did not move");
        (await ScalarIntAsync("""SELECT content_version FROM ssf.cost_entries WHERE "Id" = @id""", money)).Should().Be(1);

        // The owner restates the price in the record: the money follows, and the bill carries the mark for everyone.
        await PushAppliedAsync(Owner, "revise_log_content", "bill1b-c-owner-edit", EditPayload(2, 8000m));
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", money)).Should().Be(1, "the owner's edit changed the approved price");
        await Task.Delay(1150);
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, money);
            bill.TryGetProperty(MarkKey, out var mark).Should().BeTrue();
            mark.ValueKind.Should().Be(JsonValueKind.String);
            // Round 2: the owner's change through the record is approved straight away, like his change in the money book.
            bill.GetProperty("billVersion").GetInt32().Should().Be(2);
            bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(2);
            bill.GetProperty("approval").GetProperty("approvedByUserId").GetGuid().Should().Be(Owner);
            bill.GetProperty("needsReview").GetBoolean().Should().BeFalse();
        }

        (await StampsAsync(money)).Select(s => s.Version).Should().Equal([1, 2], "the old stamp stays; the owner's stamp for the new version is added");
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

    private static object Content(decimal cost) => new
    {
        schema = 1,
        inputs = new object[] { new { id = "in-1", productName = "इथरेल", quantity = 250, unit = "मिली", cost } },
    };

    private static Dictionary<string, object?> LogPayload(decimal cost) => new()
    {
        ["dailyLogId"] = EditLog,
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["operatorUserId"] = Mukadam,
        ["logDate"] = WorkDay,
        ["content"] = Content(cost),
    };

    private static Dictionary<string, object?> EditPayload(int baseVersion, decimal cost) => new()
    {
        ["dailyLogId"] = EditLog,
        ["baseVersion"] = baseVersion,
        ["content"] = Content(cost),
        ["reason"] = "दर बदलला",
        ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
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

    private sealed record Stamp(Guid By, int Version);

    private async Task<List<Stamp>> StampsAsync(Guid bill)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT approved_by_user_id, bill_version FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id ORDER BY bill_version";
        cmd.Parameters.AddWithValue("id", bill);
        var stamps = new List<Stamp>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            stamps.Add(new Stamp(reader.GetGuid(0), reader.GetInt32(1)));
        }

        return stamps;
    }

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return (long)(await cmd.ExecuteScalarAsync())!;
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
