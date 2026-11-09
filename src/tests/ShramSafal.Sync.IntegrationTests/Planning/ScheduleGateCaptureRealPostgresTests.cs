// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-GATE-a Task 3 ("capture never waits"; founder D-83 = 1; Review Focus 8).
//
// After the trial, on a plot that follows NO schedule while a checked schedule exists for its crop (the pull says NeedsSchedule for
// it), recording work, हजेरी, खरेदी and planned work still save: the server never refuses, parks or hides a record because of a
// schedule. Each fact first proves its precondition THROUGH THE PULL (so a plot that never needed a schedule cannot pass vacuously),
// then pushes, then reads the rows back as superuser.
//
// "After the trial" is built two ways: a paid (Active) subscription, and an Expired one with an active pilot access extension (R9).
// An Expired farm WITHOUT an extension is refused by billing (DefaultEntitlementPolicy), which is not this lane - and this host
// swaps that policy for AllowAll, so billing is not under test here. Real Postgres as agrisync_app (E3 first). Fake numbers only.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleGateCaptureRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string OldDay = "2026-10-29";

    private async Task PaidAfterTrialAsync()
    {
        await SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));
        await CheckedInstitutionAsync();
        await AssertPlotMustChooseAsync();
    }

    private async Task ExpiredWithExtensionAsync()
    {
        await SetStandingAsync(AccountA, Owner, Expired, DateTime.UtcNow.AddDays(-3), DateTime.UtcNow.AddDays(-3));
        await SetExtensionAsync(AccountA, DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(30));
        await CheckedInstitutionAsync();
        await AssertPlotMustChooseAsync();
    }

    /// <summary>The precondition, through the pull: PlotA is after the trial, follows nothing, and the server says it must choose first.</summary>
    private async Task AssertPlotMustChooseAsync()
    {
        var state = StateOf((await PullAsync(Owner)).Root, PlotA);
        state.Should().NotBeNull("the owner's pull names the plot");
        state!.Value.GetProperty("inTrial").GetBoolean().Should().BeFalse();
        state.Value.GetProperty("followsAllowed").GetBoolean().Should().BeFalse();
        state.Value.GetProperty("needsSchedule").GetBoolean().Should().BeTrue("the gate DOES say this plot must choose a schedule first");
    }

    private async Task<long> RowsAsync(string table, string column, Guid id) =>
        await CountAsync($"SELECT count(*) FROM {table} WHERE {column} = @id", ("id", id));

    // ---- the five facts of the plan ---------------------------------------------------------------------------

    [Fact]
    public async Task Log_push_is_accepted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAfterTrialAsync();

        var log = Guid.NewGuid();
        await PushOkAsync(Owner, "create_daily_log", "sgate-log-1", LogPayload(log, Owner, Guid.NewGuid(), 4, 300m, null, [], null));
        (await RowsAsync("ssf.daily_logs", "\"Id\"", log)).Should().Be(1, "the record was really written");

        // A 1.0.17 phone's create_daily_log (its own payload shape, its own version header) is accepted the same way.
        var oldLog = Guid.NewGuid();
        var oldResult = await PushAsAsync(Owner, "create_daily_log", "sgate-log-1017", new Dictionary<string, object?>
        {
            ["dailyLogId"] = oldLog,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = Owner,
            ["logDate"] = OldDay,
            ["labour"] = new object[]
            {
                new Dictionary<string, object?>
                {
                    ["labourAssignmentId"] = Guid.NewGuid(), ["engagementType"] = "hired_daily", ["workerCount"] = 2,
                },
            },
        }, "1.0.17");
        oldResult.Status.Should().Be("applied", $"{oldResult.ErrorCode}: {oldResult.ErrorMessage}");
        (await RowsAsync("ssf.daily_logs", "\"Id\"", oldLog)).Should().Be(1);
        await AssertPlotMustChooseAsync();
    }

    [Fact]
    public async Task Attendance_push_is_accepted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAfterTrialAsync();

        var mark = Guid.NewGuid();
        await PushOkAsync(Owner, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{OldDay}:Full:-:-:-", new Dictionary<string, object?>
        {
            ["attendanceMarkId"] = mark,
            ["farmId"] = FarmA,
            ["fieldOperatorId"] = FieldOperator,
            ["workDate"] = OldDay,
            ["dayMark"] = "Full",
        });
        (await RowsAsync("ssf.attendance_marks", "\"Id\"", mark)).Should().Be(1, "the mark was really written");
        await AssertPlotMustChooseAsync();
    }

    [Fact]
    public async Task Purchase_push_is_accepted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAfterTrialAsync();

        var cost = Guid.NewGuid();
        await PushOkAsync(Owner, "add_cost_entry", "sgate-cost-1", CostPayload(cost, FarmA, PlotA, CycleA, 1234.50m));
        (await RowsAsync("ssf.cost_entries", "\"Id\"", cost)).Should().Be(1, "the purchase was really written");

        var oldCost = Guid.NewGuid();
        var oldResult = await PushAsAsync(Owner, "add_cost_entry", "sgate-cost-1017", CostPayload(oldCost, FarmA, PlotA, CycleA, 99.25m), "1.0.17");
        oldResult.Status.Should().Be("applied", $"{oldResult.ErrorCode}: {oldResult.ErrorMessage}");
        (await RowsAsync("ssf.cost_entries", "\"Id\"", oldCost)).Should().Be(1);
        await AssertPlotMustChooseAsync();
    }

    [Fact]
    public async Task A_1_0_17_plan_add_push_is_answered_the_same_in_and_after_the_trial_and_the_REST_door_is_open()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAfterTrialAsync();

        // What a 1.0.17 phone can send for planned work. Its catalog has plan.add / plan.override / plan.remove and NO plannedwork.*; the
        // server answers every plan.* push "registered, not yet wired" (MUTATION_TYPE_UNIMPLEMENTED) - the same answer in the trial as after
        // it, so it is not a refusal made for a missing schedule. What the phone really does to add a plan step is the REST door below.
        var afterTrial = await PushAsAsync(Owner, "plan.add", "sgate-plan-add-1", PlanAddPayload(), "1.0.17");
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(5), DateTime.UtcNow.AddDays(5));
        var inTrial = await PushAsAsync(Owner, "plan.add", "sgate-plan-add-2", PlanAddPayload(), "1.0.17");
        (afterTrial.Status, afterTrial.ErrorCode).Should().Be((inTrial.Status, inTrial.ErrorCode),
            "plan.add is answered the same after the trial as in it: the schedule gate is not in this path");
        afterTrial.ErrorCode.Should().Be("MUTATION_TYPE_UNIMPLEMENTED");
        await PaidAfterTrialAsync();

        // The REST door 1.0.17 uses to put a step in the plan: created.
        var step = Guid.NewGuid();
        using var rest = await SendAsync(HttpMethod.Post, "/shramsafal/planned-activities", Owner, new
        {
            newActivityId = step,
            cropCycleId = CycleA,
            farmId = FarmA,
            activityName = "फवारणी SCH-GATE",
            stage = "Vegetative",
            plannedDate = "2026-12-05",
            reason = "सल्ला",
            clientCommandId = "sgate-rest-plan-1",
        }, "1.0.17");
        rest.StatusCode.Should().Be(HttpStatusCode.Created, await rest.Content.ReadAsStringAsync());
        (await RowsAsync("ssf.planned_activities", "\"Id\"", step)).Should().Be(1);

        // The current app's own planned-work push (plannedwork.create) is accepted too.
        var task = Guid.NewGuid();
        await PushOkAsync(Owner, "plannedwork.create", "sgate-pw-1", PlannedTask(task));
        (await RowsAsync("ssf.planned_work", "id", task)).Should().Be(1);
        await AssertPlotMustChooseAsync();
    }

    [Fact]
    public async Task Nothing_is_parked_for_a_missing_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAfterTrialAsync();
        await EveryDoorAsync("paid");
    }

    [Fact]
    public async Task Every_door_opens_for_a_pilot_farm_on_an_access_extension_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExpiredWithExtensionAsync();
        await EveryDoorAsync("extension");
    }

    /// <summary>Log, हजेरी, खरेदी and planned work in one go: every answer "applied", every row really there, nothing parked.</summary>
    private async Task EveryDoorAsync(string label)
    {
        var log = Guid.NewGuid();
        var mark = Guid.NewGuid();
        var cost = Guid.NewGuid();
        var task = Guid.NewGuid();
        var results = new List<(string Door, SyncResult Result)>
        {
            ("log", Of(await PushAsAsync(Owner, "create_daily_log", $"sgate-{label}-log", LogPayload(log, Owner, Guid.NewGuid(), 3, 250m, null, [], null), "1.0.18"))),
            ("attendance", Of(await PushAsAsync(Owner, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{OldDay}:Half:-:-:-", new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = mark, ["farmId"] = FarmA, ["fieldOperatorId"] = FieldOperator, ["workDate"] = OldDay, ["dayMark"] = "Half",
            }, "1.0.18"))),
            ("purchase", Of(await PushAsAsync(Owner, "add_cost_entry", $"sgate-{label}-cost", CostPayload(cost, FarmA, PlotA, CycleA, 777.77m), "1.0.18"))),
            ("planned work", Of(await PushAsAsync(Owner, "plannedwork.create", $"sgate-{label}-pw", PlannedTask(task), "1.0.18"))),
        };

        foreach (var (door, result) in results)
        {
            result.Status.Should().Be("applied", $"{door}: {result.Code}: {result.Message}");
            result.Code.Should().BeNull($"{door} was neither rejected nor parked");
        }

        (await RowsAsync("ssf.daily_logs", "\"Id\"", log)).Should().Be(1);
        (await RowsAsync("ssf.attendance_marks", "\"Id\"", mark)).Should().Be(1);
        (await RowsAsync("ssf.cost_entries", "\"Id\"", cost)).Should().Be(1);
        (await RowsAsync("ssf.planned_work", "id", task)).Should().Be(1);

        // The plot still has to choose - the gate did not change, and no record door noticed it.
        await AssertPlotMustChooseAsync();
    }

    private sealed record SyncResult(string Status, string? Code, string? Message);

    private static SyncResult Of(ShramSafal.Application.Contracts.Dtos.SyncMutationResultDto r) => new(r.Status, r.ErrorCode, r.ErrorMessage);

    private static Dictionary<string, object?> PlanAddPayload() => new()
    {
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["actorUserId"] = Owner,
    };

    private static Dictionary<string, object?> PlannedTask(Guid id) => new()
    {
        ["plannedWorkId"] = id,
        ["farmId"] = FarmA,
        ["title"] = "द्राक्षाला फवारणी (SCH-GATE)",
        ["scope"] = "Plot",
        ["plotIds"] = new[] { PlotA },
    };
}
