// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177; founder 27 Nov B1.4: "an owner switch for each farm; off unless the owner turns it on")
//
// The farm's own-bill switch, on a real Postgres AS THE RESTRICTED APPLICATION ROLE (E3 first), through the real push door and the real pull route:
// off (the default for every farm) a person who checks money is refused his own bill BY NAME; the farm's primary owner turns it on and the same person
// approves it, the stamp naming him; turned off again he is refused again (decided when the approval ARRIVES); nobody but the primary owner may turn it;
// farm B's switch never changes farm A; the owner approves his own bill either way; the phones learn the value through accessScopes, written only when on.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Finance;

[Trait("Category", "RequiresPostgres")]
public sealed class OwnBillApprovalSwitchRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Approve = "approve_cost_entry";
    private const string Switch = "farm.own_bill_approval.set";
    private const string OwnBillCode = "ShramSafal.OwnBillApproval.Forbidden";
    private const string OwnBillWords =
        "By ShramSafal's rules a bill is approved by someone other than the person who made it, or by the farm's main owner. Nothing was approved.";

    private static readonly Guid Bill1 = Guid.Parse("d1770000-0000-4000-8000-000000000001");
    private static readonly Guid Bill2 = Guid.Parse("d1770000-0000-4000-8000-000000000002");
    private static readonly Guid OwnerBill = Guid.Parse("d1770000-0000-4000-8000-000000000003");

    private static Dictionary<string, object?> ApprovePayload(Guid bill) => new()
    {
        ["approvalId"] = Guid.NewGuid(),
        ["costEntryId"] = bill,
        ["farmId"] = FarmA,
        ["billVersion"] = 1,
    };

    private static Dictionary<string, object?> SwitchPayload(Guid farm, bool allowed) => new() { ["farmId"] = farm, ["allowed"] = allowed };

    private async Task<object?> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    private async Task<long> StampsAsync(Guid bill) =>
        Convert.ToInt64(await ScalarAsync("SELECT count(*) FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", ("id", bill)));

    private async Task<bool> SwitchOfAsync(Guid farm) =>
        (bool)(await ScalarAsync("SELECT reviewer_may_approve_own_bill FROM ssf.farms WHERE \"Id\" = @id", ("id", farm)))!;

    /// <summary>The farm's entry in the caller's accessScopes, and the raw pull body.</summary>
    private async Task<(string Body, JsonElement Scope)> ScopeOfAsync(Guid user, Guid farm)
    {
        var (body, root) = await PullAsync(user);
        return (body, root.GetProperty("accessScopes").EnumerateArray().Single(s => s.GetProperty("farmId").GetGuid() == farm));
    }

    [Fact]
    public async Task A_checker_approves_his_own_bill_only_when_the_owner_turned_it_on()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        await PushAppliedAsync(Mukadam, "add_cost_entry", "d177-bill-1", CostPayload(Bill1, FarmA, PlotA, CycleA, 1234.51m));
        await PushAppliedAsync(Mukadam, "add_cost_entry", "d177-bill-2", CostPayload(Bill2, FarmA, PlotA, CycleA, 2345.62m));

        // OFF is the default for every farm, old and new, and an old phone's pull does not even carry the word.
        (await SwitchOfAsync(FarmA)).Should().BeFalse();
        (await SwitchOfAsync(FarmB)).Should().BeFalse();
        var (bodyOff, scopeOff) = await ScopeOfAsync(Mukadam, FarmA);
        bodyOff.Should().NotContain("reviewerMayApproveOwnBill", "the member is written only when the switch is on");
        scopeOff.TryGetProperty("reviewerMayApproveOwnBill", out _).Should().BeFalse();

        // Switch off: the checker's own bill is refused by name, nothing is stamped.
        var refused = await PushAsync(Mukadam, Approve, "d177-own-off", ApprovePayload(Bill1));
        refused.Status.Should().NotBe("applied");
        refused.ErrorCode.Should().Be(OwnBillCode);
        refused.ErrorMessage.Should().Be(OwnBillWords);
        (await StampsAsync(Bill1)).Should().Be(0);

        // The primary owner approves his OWN bill with the switch off (he may either way).
        await PushAppliedAsync(Owner, Approve, "d177-owner-own-off", ApprovePayload(Cost));
        (await StampsAsync(Cost)).Should().Be(1);

        // Nobody but the farm's primary owner may turn the switch: not the checker himself, not the सहमालक, not another farm's owner.
        foreach (var person in new[] { Mukadam, CoOwner, Worker })
        {
            var notHis = await PushAsync(person, Switch, $"d177-switch-{person:N}", SwitchPayload(FarmA, true));
            notHis.Status.Should().NotBe("applied");
            notHis.ErrorCode.Should().Be("ShramSafal.Forbidden");
            notHis.ErrorMessage.Should().Be("User is not allowed to modify this farm.");
        }

        var stranger = await PushAsync(OwnerB, Switch, "d177-switch-other-owner", SwitchPayload(FarmA, true));
        stranger.ErrorCode.Should().Be("ShramSafal.Forbidden");
        stranger.ErrorMessage.Should().Be("User is not a member of the target farm.");
        (await SwitchOfAsync(FarmA)).Should().BeFalse();

        // Farm B's switch is farm B's: turning it on changes nothing on farm A.
        await PushAppliedAsync(OwnerB, Switch, "d177-switch-b", SwitchPayload(FarmB, true));
        (await SwitchOfAsync(FarmB)).Should().BeTrue();
        (await SwitchOfAsync(FarmA)).Should().BeFalse();
        (await PushAsync(Mukadam, Approve, "d177-own-b-on", ApprovePayload(Bill1))).ErrorCode.Should().Be(OwnBillCode);
        var (_, scopeB) = await ScopeOfAsync(OwnerB, FarmB);
        scopeB.GetProperty("reviewerMayApproveOwnBill").GetBoolean().Should().BeTrue();

        // A payload with a key the contract does not know is refused whole.
        var extra = SwitchPayload(FarmA, true);
        extra["reason"] = "x";
        (await PushAsync(Owner, Switch, "d177-switch-extra", extra)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");

        // The owner turns farm A's switch ON: one audit row (who, old, new); the same value again writes nothing.
        var on = await PushAppliedAsync(Owner, Switch, "d177-switch-on", SwitchPayload(FarmA, true));
        JsonSerializer.Serialize(on.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Should().Contain("\"allowed\":true");
        await PushAppliedAsync(Owner, Switch, "d177-switch-on-again", SwitchPayload(FarmA, true));
        (await SwitchOfAsync(FarmA)).Should().BeTrue();
        Convert.ToInt64(await ScalarAsync("SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = 'OwnBillApprovalSwitchSet'", ("f", FarmA))).Should().Be(1);
        ((string)(await ScalarAsync("SELECT payload::text FROM ssf.audit_events WHERE farm_id = @f AND action = 'OwnBillApprovalSwitchSet'", ("f", FarmA)))!)
            .Replace(" ", string.Empty).Should().Contain("\"old\":false").And.Contain("\"new\":true");
        Convert.ToString(await ScalarAsync("SELECT actor_user_id FROM ssf.audit_events WHERE farm_id = @f AND action = 'OwnBillApprovalSwitchSet'", ("f", FarmA)))
            .Should().Be(Owner.ToString());

        // Every phone of the farm is told, through the scope the pull already sends in full.
        foreach (var reader in new[] { Owner, Mukadam, Worker })
        {
            var (_, scopeOn) = await ScopeOfAsync(reader, FarmA);
            scopeOn.GetProperty("reviewerMayApproveOwnBill").GetBoolean().Should().BeTrue($"{reader} is told the farm allows it");
        }

        // Switch on: the SAME person approves the SAME bill, and the stamp names him.
        await PushAppliedAsync(Mukadam, Approve, "d177-own-on", ApprovePayload(Bill1));
        (await StampsAsync(Bill1)).Should().Be(1);
        Convert.ToString(await ScalarAsync("SELECT approved_by_user_id FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", ("id", Bill1)))
            .Should().Be(Mukadam.ToString());

        // The owner approves his own bill with the switch on too.
        await PushAppliedAsync(Owner, "add_cost_entry", "d177-owner-bill", CostPayload(OwnerBill, FarmA, PlotA, CycleA, 3456.73m));
        await PushAppliedAsync(Owner, Approve, "d177-owner-own-on", ApprovePayload(OwnerBill));

        // Turned OFF again: decided when the approval ARRIVES, so his second bill is refused again; the stamp already made stays.
        await PushAppliedAsync(Owner, Switch, "d177-switch-off", SwitchPayload(FarmA, false));
        var again = await PushAsync(Mukadam, Approve, "d177-own-off-again", ApprovePayload(Bill2));
        again.Status.Should().NotBe("applied");
        again.ErrorCode.Should().Be(OwnBillCode);
        again.ErrorMessage.Should().Be(OwnBillWords);
        (await StampsAsync(Bill2)).Should().Be(0);
        (await StampsAsync(Bill1)).Should().Be(1);
        var (bodyAfter, _) = await ScopeOfAsync(Mukadam, FarmA);
        bodyAfter.Should().NotContain("reviewerMayApproveOwnBill");
        Convert.ToInt64(await ScalarAsync("SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = 'OwnBillApprovalSwitchSet'", ("f", FarmA))).Should().Be(2);
    }
}
