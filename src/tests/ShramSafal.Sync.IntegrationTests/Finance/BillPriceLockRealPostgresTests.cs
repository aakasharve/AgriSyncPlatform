// spec: plr-d10-redesign-real-integration-2026-10-25 — lane FIX-1, fix 2 (BILL-1b; founder D-105 (b), answered 2026-11-08:
// "Only you, the main owner, can change an approved bill's price. The bill then shows 'changed by owner' to everyone, you
// included.").
//
// On a real Postgres as agrisync_app (doctrine E3 first in every fact), through the real host and the real handlers:
//   A  a reviewer (review money) cannot change an APPROVED bill's amount - on the sync push AND the REST route, with the plain
//      reason (a three-segment code ending CONFLICT, so every phone parks it, never loses it) - while the primary account holder
//      can; his change keeps the old stamp in the history and the pull then carries the mark (`changedByOwnerAtUtc`) to
//      EVERYONE who receives the bill, the owner included, and the mark stays after the new version is approved;
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

        // The mark shows to EVERYONE who receives the bill - the reviewer AND the owner himself - with the old stamp kept.
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, Cost);
            Output.WriteLine($"[EVIDENCE] {(who == Owner ? "owner" : "reviewer")} receives: {bill}");
            bill.GetProperty(MarkKey).GetDateTime().ToUniversalTime().Should().BeAfter(before, "the day the owner changed it");
            bill.GetProperty("billVersion").GetInt32().Should().Be(2);
            bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(1, "the old stamp stays in the history, read as for an earlier version");
            bill.GetProperty("needsReview").GetBoolean().Should().BeTrue("a changed price is never silently approved (BILL-1): the review state is unchanged");
        }

        (await CountAsync("SELECT count(*) FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", Cost)).Should().Be(1, "the old stamp row is kept");
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", Cost)).Should().Be(1, "the owner's change, with who and when");

        // Still locked for the reviewer after the owner's change (the bill has been approved once).
        var again = await PushAsync(Mukadam, Correct, "bill1b-a-mukadam-again", CorrectPayload(Cost, 2222.22m));
        again.ErrorCode.Should().Be(LockedCode);

        // The new version is approved: the mark stays - the bill's history never lies, even to the owner.
        var markAt = Bill((await PullAsync(Owner)).Root, Cost).GetProperty(MarkKey).GetDateTime();
        await PushAppliedAsync(Owner, Approve, "bill1b-a-approve-2", ApprovePayload(Cost, 2));
        await Task.Delay(1150);
        foreach (var who in new[] { Owner, Mukadam })
        {
            var bill = Bill((await PullAsync(who)).Root, Cost);
            bill.GetProperty("needsReview").GetBoolean().Should().BeFalse();
            bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(2);
            bill.GetProperty(MarkKey).GetDateTime().Should().Be(markAt, "the mark is a fact of the bill, not of its review state");
        }

        // The answer to the approval door carries it too (the same projection as the pull).
        var (approveStatus, approveBody) = await PostAsync(Owner, $"/shramsafal/finance/cost-entry/{Cost}/approve", new { billVersion = 2 });
        approveStatus.Should().Be(HttpStatusCode.OK, approveBody);
        using (var doc = JsonDocument.Parse(approveBody))
        {
            doc.RootElement.TryGetProperty(MarkKey, out _).Should().BeTrue("the approve door answers with the bill as the pull sends it");
        }
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
            bill.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(1, "the old stamp stays");
        }
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
