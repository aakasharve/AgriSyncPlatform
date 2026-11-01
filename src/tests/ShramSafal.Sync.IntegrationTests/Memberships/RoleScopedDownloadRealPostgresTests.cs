// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — THE KEY PROOF: each phone
// downloads only what that person may see. One farm, pulled from the beginning as each of its people
// through the real /sync/pull route on a real Postgres as agrisync_app (E3 asserted first), and the
// CONTENT of every body asserted — not counts alone: no seeded amount, and no other person's name where
// none may go. Then the owner switches see money on for the मुकादम and his OLD cursor brings the older money.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class RoleScopedDownloadRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    // MU-3 fix 1 (F7): a job card is the farm's WORK and travels to every seat that reads it, its pay withheld by rule.
    private static readonly string[] MoneyKinds = ["costEntries", "financeCorrections", "dayLedgers"];

    [Fact]
    public async Task The_owner_gets_everything_of_his_farm_and_nothing_of_another()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (body, root) = await PullAsync(Owner);
        Evidence("owner", root, body);

        IdsOf(root, "dailyLogs").Should().Contain([OwnerLog, MukadamLog, WorkerLog, Worker2Log]);
        IdsOf(root, "costEntries").Should().Equal(Cost);
        IdsOf(root, "dayLedgers").Should().Equal(Ledger);
        IdsOf(root, "jobCards").Should().Equal(JobCard);
        IdsOf(root, "attendanceMarks").Should().Equal(Mark);
        IdsOf(root, "testInstances", "testInstanceId").Should().Equal(TestRecord);
        IdsOf(root, "plannedActivities").Should().Equal(Planned);
        IdsOf(root, "attachments").Should().BeEquivalentTo([FarmPhoto, OwnerLogPhoto, Receipt, WorkerLogPhoto]);
        foreach (var amount in FarmAMoney)
        {
            body.Should().Contain(amount, "the primary account holder sees every rupee of his farm");
        }

        LabourOf(root, OwnerLog).GetProperty("wagePerPerson").GetDecimal().Should().Be(OwnerWage);
        Scope(root, FarmA).GetProperty("seeMoney").GetBoolean().Should().BeTrue();
        Scope(root, FarmA).GetProperty("seeWages").GetBoolean().Should().BeTrue();
        Scope(root, FarmA).GetProperty("ownRecordsOnly").GetBoolean().Should().BeFalse();
        NothingOfFarmB(body, root);
    }

    [Fact]
    public async Task A_co_owner_whose_money_is_off_gets_the_farms_work_and_not_one_rupee()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (body, root) = await PullAsync(CoOwner);
        Evidence("co-owner money off", root, body);

        IdsOf(root, "dailyLogs").Should().Contain([OwnerLog, MukadamLog, WorkerLog, Worker2Log], "he reads the farm's work");
        foreach (var kind in MoneyKinds)
        {
            ArrayOf(root, kind).Should().BeEmpty($"{kind} is money and his money is switched off");
        }

        foreach (var amount in FarmAMoney.Append("155.53"))
        {
            body.Should().NotContain(amount, "no seeded amount may appear anywhere in his body");
        }

        var crew = LabourOf(root, OwnerLog);
        crew.GetProperty("workerCount").GetInt32().Should().Be(8, "the work itself travels (P7)");
        crew.GetProperty("wagePerPerson").ValueKind.Should().Be(JsonValueKind.Null, "a wage withheld is not sent, never a ₹0");
        crew.GetProperty("totalCost").ValueKind.Should().Be(JsonValueKind.Null);
        crew.GetProperty("wageWithheld").GetBoolean().Should().BeTrue("fix 1 F10: withheld by rule, never 'not stated'");
        crew.GetProperty("totalCostWithheld").GetBoolean().Should().BeTrue();
        IdsOf(root, "jobCards").Should().Equal([JobCard], "fix 1 F7: the work travels; its pay does not");
        // Fix 1 F2: the farm-linked photo is a bill of an earlier build, money like the receipt.
        IdsOf(root, "attachments").Should().BeEquivalentTo([OwnerLogPhoto, WorkerLogPhoto], "a receipt and a bill are money");
        IdsOf(root, "attendanceMarks").Should().Equal([Mark], "he holds take हजेरी");
        Scope(root, FarmA).GetProperty("seeMoney").GetBoolean().Should().BeFalse();
        Scope(root, FarmA).GetProperty("seeWages").GetBoolean().Should().BeFalse();
        NothingOfFarmB(body, root);
    }

    [Fact]
    public async Task A_mukadam_with_take_attendance_gets_the_farms_work_attendance_no_money_and_others_wages_withheld()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (body, root) = await PullAsync(Mukadam);
        Evidence("mukadam", root, body);

        IdsOf(root, "dailyLogs").Should().Contain([OwnerLog, MukadamLog, WorkerLog, Worker2Log]);
        foreach (var kind in MoneyKinds)
        {
            ArrayOf(root, kind).Should().BeEmpty($"{kind} is money");
        }

        IdsOf(root, "attendanceMarks").Should().Equal([Mark], "he takes हजेरी");
        IdsOf(root, "jobCards").Should().Equal([JobCard], "fix 1 F7: the farm's work assignment reaches him");
        foreach (var log in new[] { OwnerLog, Worker2Log })
        {
            var crew = LabourOf(root, log);
            crew.GetProperty("workerCount").ValueKind.Should().Be(JsonValueKind.Number);
            crew.GetProperty("wagePerPerson").ValueKind.Should().Be(JsonValueKind.Null, "another person's wage is withheld");
            crew.GetProperty("totalCost").ValueKind.Should().Be(JsonValueKind.Null);
        }

        // His OWN record comes back whole — his own statement.
        LabourOf(root, MukadamLog).GetProperty("wagePerPerson").GetDecimal().Should().Be(MukadamWage);
        body.Should().Contain("333.37", "the money HE stated on his own record is his");
        foreach (var amount in new[] { "9876.54", "432.17", "3457.36", "777.73", "166.61", "6129.37" })
        {
            body.Should().NotContain(amount, "no money of the farm and no wage of another person");
        }

        Scope(root, FarmA).GetProperty("seeAttendance").GetBoolean().Should().BeTrue();
        Scope(root, FarmA).GetProperty("seeMoney").GetBoolean().Should().BeFalse();
        NothingOfFarmB(body, root);
    }

    [Fact]
    public async Task A_worker_gets_his_own_records_only_no_money_attendance_job_cards_tests_or_other_names()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (body, root) = await PullAsync(Worker);
        Evidence("worker", root, body);

        IdsOf(root, "dailyLogs").Should().Equal([WorkerLog], "a कामगार reads his own records only");
        foreach (var kind in MoneyKinds.Concat(["attendanceMarks", "testInstances", "testRecommendations", "complianceSignals", "plannedActivities"]))
        {
            ArrayOf(root, kind).Should().BeEmpty($"{kind} is not his");
        }

        if (root.TryGetProperty("attentionBoard", out var board) && board.ValueKind == JsonValueKind.Object)
        {
            ArrayOf(board, "cards").Should().BeEmpty("the farm's attention board is not his");
            ArrayOf(board, "scheduledWork").Should().BeEmpty();
        }

        IdsOf(root, "attachments").Should().BeEquivalentTo([WorkerLogPhoto], "his record's photo; the farm-linked bill is money (fix 1 F2)");
        ArrayOf(root, "jobCards").Should().BeEmpty("no card is assigned to him; another worker's card is not his");
        IdsOf(root, "operators", "userId").Should().Equal([Worker], "no other person's name");
        foreach (var name in new[] { OwnerName, CoOwnerName, MukadamName, Worker2Name, PausedName, OwnerBName, CrewName, "हजेरी-शंकर" })
        {
            body.Should().NotContain(name, "no other person's name reaches a कामगार");
        }

        foreach (var amount in FarmAMoney)
        {
            body.Should().NotContain(amount, "no money of the farm");
        }

        LabourOf(root, WorkerLog).GetProperty("wagePerPerson").GetDecimal().Should().Be(WorkerWage, "his own statement");
        Scope(root, FarmA).GetProperty("ownRecordsOnly").GetBoolean().Should().BeTrue();
        NothingOfFarmB(body, root);
    }

    [Fact]
    public async Task A_paused_member_gets_nothing_of_the_farm_though_every_power_is_stored_on_his_seat()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (body, root) = await PullAsync(Paused);
        Evidence("paused", root);

        foreach (var kind in new[] { "farms", "plots", "cropCycles", "dailyLogs", "attachments", "attendanceMarks", "plannedActivities", "testInstances" }
                     .Concat(MoneyKinds))
        {
            ArrayOf(root, kind).Should().BeEmpty($"{kind}: a paused seat reads nothing");
        }

        ArrayOf(root, "accessScopes").Should().BeEmpty("he holds no working seat anywhere");
        body.Should().NotContain(FarmA.ToString());
        foreach (var amount in FarmAMoney)
        {
            body.Should().NotContain(amount);
        }
    }

    [Fact]
    public async Task Another_farms_owner_gets_nothing_of_this_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (body, root) = await PullAsync(OwnerB);
        Evidence("farm B owner", root);

        IdsOf(root, "farms").Should().Equal([FarmB]);
        IdsOf(root, "dailyLogs").Should().Equal([FarmBLog]);
        IdsOf(root, "costEntries").Should().Equal([CostB]);
        body.Should().NotContain(FarmA.ToString());
        foreach (var amount in FarmAMoney)
        {
            body.Should().NotContain(amount);
        }

        foreach (var name in new[] { OwnerName, CoOwnerName, MukadamName, WorkerName, Worker2Name, PausedName })
        {
            body.Should().NotContain(name);
        }
    }

    /// <summary>
    /// Plan §2 #6 / §6 #12 — ONE cursor across farms: a seat whose reading widens must still receive the rows
    /// that changed BEFORE his cursor while he could not read them. The owner switches see money on (the real
    /// domain decision, <see cref="FarmMembership.SetAuthorities"/>); the मुकादम's OLD cursor now brings the
    /// older money, and only once.
    /// </summary>
    [Fact]
    public async Task Switching_see_money_on_brings_the_older_money_to_his_old_cursor_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, first) = await PullAsync(Mukadam);
        ArrayOf(first, "costEntries").Should().BeEmpty("before the switch he sees no money");
        var oldCursor = first.GetProperty("nextCursorUtc").GetDateTime().ToUniversalTime();
        Output.WriteLine($"[EVIDENCE] mukadam cursor before the switch: {oldCursor:O}");

        await Task.Delay(50);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney);
        // MU-3 fix 1 (F1): a change is sent once its whole second is over (a phone's cursor counts whole seconds).
        await Task.Delay(1100);

        var (body, again) = await PullAsync(Mukadam, oldCursor);
        Evidence("mukadam after see money, old cursor", again);
        IdsOf(again, "costEntries").Should().Equal([Cost], "the older cost reaches his OLD cursor");
        IdsOf(again, "dayLedgers").Should().Equal([Ledger]);
        IdsOf(again, "jobCards").Should().Equal([JobCard]);
        body.Should().Contain("777.73", "the money stated on another person's record is his to see now");
        body.Should().NotContain("432.17", "wages are a separate authority, still withheld");

        var newCursor = again.GetProperty("nextCursorUtc").GetDateTime().ToUniversalTime();
        newCursor.Should().BeAfter(oldCursor);
        var (_, third) = await PullAsync(Mukadam, newCursor);
        ArrayOf(third, "costEntries").Should().BeEmpty("re-sent once; the cursor moved past the change");
        ArrayOf(third, "dailyLogs").Should().BeEmpty();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    private void Evidence(string who, JsonElement root, string? body = null)
    {
        if (body is not null)
        {
            // The narrowed body exactly as the server sent it: the P11 run feeds it to the 1.0.17 phone.
            Output.WriteLine($"[BODY {who}] {body}");
        }

        var kinds = new[]
        {
            "farms", "dailyLogs", "attachments", "costEntries", "financeCorrections", "dayLedgers", "jobCards",
            "attendanceMarks", "testInstances", "plannedActivities", "complianceSignals", "operators", "accessScopes",
        };
        Output.WriteLine($"[EVIDENCE] {who}: " + string.Join(" ", kinds.Select(k => $"{k}={ArrayOf(root, k).Count}")));
    }

    private static JsonElement LabourOf(JsonElement root, Guid logId)
    {
        var log = ArrayOf(root, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == logId);
        return log.GetProperty("labour").EnumerateArray().Single();
    }

    private static JsonElement Scope(JsonElement root, Guid farmId) =>
        ArrayOf(root, "accessScopes").Single(s => s.GetProperty("farmId").GetGuid() == farmId);

    private static void NothingOfFarmB(string body, JsonElement root)
    {
        body.Should().NotContain(FarmB.ToString(), "another farm's data: never");
        body.Should().NotContain("5555.67");
        ArrayOf(root, "accessScopes").Select(s => s.GetProperty("farmId").GetGuid()).Should().Equal([FarmA]);
    }

}
