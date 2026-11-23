// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// An own work feeds नियोजन only by the farmer's SECOND act ("plan", then who: `ownschedule.item.plan`); saving a work makes no plan. The plan is linked by the
// work's stable identity, dated when the schedule gives a due day, otherwise waiting. Real events move the plans that depend on them: a sign seen
// (`schedule.task_event`) and the record of the work a follower comes after (made, moved, taken back). Removing, moving, postponing or cancelling a plan never
// edits the schedule.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and the real push handler; the switch row is written as superuser. Fake
// numbers only; no dose from any real schedule.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleFeedRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string Save = "ownschedule.item.save";
    private const string Plan = "ownschedule.item.plan";
    private const string TaskEvent = "schedule.task_event";
    private const string OffCode = "ShramSafal.ScheduleMechanismOff";

    // ---- arrangement -----------------------------------------------------------------------------------------------

    private Task SwitchOnAsync(params Guid[] farms) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-5 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    private async Task<(Guid Plot, Guid Cycle, DateOnly Start)> PlotOnDayAsync(int daysAgo = 15)
    {
        var start = TodayIst().AddDays(-daysAgo);
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", start);
        return (plot, cycle, start);
    }

    private static Dictionary<string, object?> DayTiming(int from, int? to = null) => new() { ["timer"] = "day", ["fromDay"] = from, ["toDay"] = to };

    private static Dictionary<string, object?> SignTiming(string words, int? expectedFrom = null) =>
        new() { ["timer"] = "sign", ["signWords"] = words, ["expectedFromDay"] = expectedFrom };

    private static Dictionary<string, object?> AfterTiming(string key, int usual) => new() { ["timer"] = "after", ["afterTaskKey"] = key, ["usualDays"] = usual };

    private static Dictionary<string, object?> Task(string key, string name, Dictionary<string, object?> timing) => new()
    {
        ["taskKey"] = key,
        ["name"] = name,
        ["kind"] = "work",
        ["timing"] = timing,
        ["basis"] = "experience",
        ["stageIndex"] = 0,
    };

    private async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private Task<SyncMutationResultDto> SaveAsync(Guid actor, Guid plot, Guid cycle, Dictionary<string, object?> task) =>
        PushAsAsync(actor, Save, $"own-save-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["task"] = task }, "1.0.18");

    private Task<SyncMutationResultDto> PlanAsync(
        Guid actor, Guid plot, Guid cycle, string key, Guid? planId = null, Guid? farm = null, Guid? assignee = null, string? requestId = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["plannedWorkId"] = planId ?? Guid.NewGuid(),
            ["farmId"] = farm ?? FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
        };
        if (assignee is { } who)
        {
            payload["assigneeUserId"] = who;
        }

        return PushAsAsync(actor, Plan, requestId ?? $"own-plan-{Guid.NewGuid():N}", payload, "1.0.18");
    }

    private Task<SyncMutationResultDto> AnswerAsync(Guid actor, Guid plot, Guid cycle, string key, string answer, DateOnly? on = null, Guid? farm = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["eventId"] = Guid.NewGuid(),
            ["farmId"] = farm ?? FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
            ["answer"] = answer,
        };
        if (on is { } day)
        {
            payload["observedOn"] = day.ToString("yyyy-MM-dd");
        }

        return PushAsAsync(actor, TaskEvent, $"sign-{Guid.NewGuid():N}", payload, "1.0.18");
    }

    private static Guid PlanIdOf(SyncMutationResultDto result) =>
        JsonSerializer.SerializeToElement(result.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("id").GetGuid();

    private sealed record PlanRow(Guid Id, Guid? OwnItemId, string? Key, int? Occurrence, DateOnly? Planned, DateOnly? Due, DateOnly? ExpectedFrom, string? Answer, string Status, string Source);

    private async Task<List<PlanRow>> PlanRowsAsync(Guid? ownItemId = null)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT id, own_item_id, schedule_task_key, occurrence, planned_date, schedule_due_on, expected_from, sign_answer, status, source
            FROM ssf.planned_work WHERE (@i::uuid IS NULL OR own_item_id = @i::uuid) ORDER BY occurrence NULLS FIRST, created_at_utc
            """;
        cmd.Parameters.AddWithValue("i", (object?)ownItemId ?? DBNull.Value).NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
        var rows = new List<PlanRow>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            rows.Add(new PlanRow(
                r.GetGuid(0),
                r.IsDBNull(1) ? null : r.GetGuid(1),
                r.IsDBNull(2) ? null : r.GetString(2),
                r.IsDBNull(3) ? null : r.GetInt32(3),
                r.IsDBNull(4) ? null : r.GetFieldValue<DateOnly>(4),
                r.IsDBNull(5) ? null : r.GetFieldValue<DateOnly>(5),
                r.IsDBNull(6) ? null : r.GetFieldValue<DateOnly>(6),
                r.IsDBNull(7) ? null : r.GetString(7),
                r.GetString(8),
                r.GetString(9)));
        }

        return rows;
    }

    private async Task<string> FingerprintAsync(string sql)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    private Task<string> ScheduleFingerprintAsync() => FingerprintAsync("""
        SELECT coalesce((SELECT string_agg(row_to_json(i)::text, '|' ORDER BY row_to_json(i)::text) FROM ssf.own_schedule_items i), '')
            || '#' || coalesce((SELECT string_agg(row_to_json(r)::text, '|' ORDER BY row_to_json(r)::text) FROM ssf.own_schedule_item_revisions r), '')
            || '#' || coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text) FROM ssf.schedule_templates t), '')
            || '#' || coalesce((SELECT string_agg(row_to_json(s)::text, '|' ORDER BY row_to_json(s)::text) FROM ssf.schedule_subscriptions s), '')
        """);

    // ---- the switch --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task SwitchOff_RefusesPlanAndTaskEvent_AndWritesNothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _) = await PlotOnDayAsync();

        (await PlanAsync(Owner, plot, cycle, "t1")).ErrorCode.Should().Be(OffCode);
        (await AnswerAsync(Owner, plot, cycle, "t1", "seen")).ErrorCode.Should().Be(OffCode);

        (await CountAsync("SELECT count(*) FROM ssf.schedule_task_events")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE own_item_id IS NOT NULL")).Should().Be(0);
    }

    // ---- saving makes no plan; planning is the second act ------------------------------------------------------------

    [Fact]
    public async Task SaveItem_MakesNoPlan()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, _) = await PlotOnDayAsync();

        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "पहिली खुरपणी", DayTiming(20))));

        (await CountAsync("SELECT count(*) FROM ssf.planned_work")).Should().Be(0, "saving an own work makes no plan (approved spec)");
        ArrayOf((await PullAsync(Owner)).Root, "plannedWork").Should().BeEmpty();
    }

    [Fact]
    public async Task PlanFromMine_LinksItem()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, start) = await PlotOnDayAsync();
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "पहिली खुरपणी", DayTiming(20))));
        var item = OwnScheduleItem.IdFor(cycle, "t1");

        var planned = await OkAsync(PlanAsync(Owner, plot, cycle, "t1", planId: PlannedWork.ScheduleIdFor(item, 1)));

        var row = (await PlanRowsAsync(item)).Should().ContainSingle().Subject;
        row.Id.Should().Be(PlannedWork.ScheduleIdFor(item, 1));
        row.Key.Should().Be("t1", "linked by the task key and the own item, never by a step id");
        row.Occurrence.Should().Be(1);
        row.Source.Should().Be("Schedule");
        row.Planned.Should().Be(start.AddDays(20), "a day window gives the date from the plot's start");
        row.ExpectedFrom.Should().Be(start.AddDays(20));
        PlanIdOf(planned).Should().Be(row.Id);

        var dto = ArrayOf((await PullAsync(Owner)).Root, "plannedWork").Should().ContainSingle().Subject;
        dto.GetProperty("ownItemId").GetGuid().Should().Be(item);
        dto.GetProperty("scheduleTaskKey").GetString().Should().Be("t1");
        dto.GetProperty("occurrence").GetInt32().Should().Be(1);
        dto.GetProperty("waiting").GetBoolean().Should().BeFalse();
        dto.GetProperty("title").GetString().Should().Be("पहिली खुरपणी");

        // SM-11 (team default): a plan made from the own schedule is the owner's and the assignee's, not the whole plot team's.
        ArrayOf((await PullAsync(Worker)).Root, "plannedWork").Should().BeEmpty("the schedule-steps audience never widens a plan from the own schedule");
    }

    [Fact]
    public async Task ExtraWork_NeverEntersSchedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, _, start) = await PlotOnDayAsync();
        var before = await ScheduleFingerprintAsync();

        await OkAsync(PushAsAsync(Owner, "plannedwork.create", $"extra-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["title"] = "विहिरीची दुरुस्ती",
            ["scope"] = "Plot",
            ["plotIds"] = new[] { plot },
            ["plannedDate"] = start.AddDays(18).ToString("yyyy-MM-dd"),
        }, "1.0.18"));

        (await ScheduleFingerprintAsync()).Should().Be(before, "unrelated work is planned directly and never enters the schedule");
        var row = (await PlanRowsAsync()).Should().ContainSingle().Subject;
        row.OwnItemId.Should().BeNull();
        row.Source.Should().Be("Planning");
    }

    [Fact]
    public async Task PostponeOrCancel_LeavesScheduleUnchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, start) = await PlotOnDayAsync();
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी", DayTiming(20))));
        var planId = PlanIdOf(await OkAsync(PlanAsync(Owner, plot, cycle, "t1")));
        var before = await ScheduleFingerprintAsync();

        await OkAsync(PushAsAsync(Owner, "plannedwork.edit", $"postpone-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = planId,
            ["farmId"] = FarmA,
            ["title"] = "खुरपणी",
            ["scope"] = "Plot",
            ["plotIds"] = new[] { plot },
            ["plannedDate"] = start.AddDays(24).ToString("yyyy-MM-dd"),
        }, "1.0.18"));
        (await PlanRowsAsync()).Single().Planned.Should().Be(start.AddDays(24));
        (await ScheduleFingerprintAsync()).Should().Be(before, "postponing a plan never edits the schedule");

        await OkAsync(PushAsAsync(Owner, "plannedwork.cancel", $"cancel-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["plannedWorkId"] = planId, ["farmId"] = FarmA }, "1.0.18"));
        (await PlanRowsAsync()).Single().Status.Should().Be("Cancelled");
        (await ScheduleFingerprintAsync()).Should().Be(before, "cancelling a plan never edits the schedule");
    }

    // ---- real events move dependants ---------------------------------------------------------------------------------

    [Fact]
    public async Task SignOnDay5_MovesPlanToDay5_KeepsExpected10()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, start) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("flower", "फुलोरा फवारणी", SignTiming("फुले दिसली", expectedFrom: 10))));
        await OkAsync(PlanAsync(Owner, plot, cycle, "flower"));

        var waiting = (await PlanRowsAsync()).Single();
        waiting.Planned.Should().BeNull("a 'when seen' work waits until the sign is seen");
        waiting.ExpectedFrom.Should().Be(start.AddDays(10));
        ArrayOf((await PullAsync(Owner)).Root, "plannedWork").Single().GetProperty("waiting").GetBoolean().Should().BeTrue();

        // "Unsure" is kept and moves nothing.
        await OkAsync(AnswerAsync(Worker, plot, cycle, "flower", "unsure", start.AddDays(4)));
        (await PlanRowsAsync()).Single().Planned.Should().BeNull();

        await OkAsync(AnswerAsync(Worker, plot, cycle, "flower", "seen", start.AddDays(5)));

        var moved = (await PlanRowsAsync()).Single();
        moved.Planned.Should().Be(start.AddDays(5), "the sign was seen on day 5");
        moved.ExpectedFrom.Should().Be(start.AddDays(10), "the expected day is kept");
        moved.Answer.Should().Be("seen");
        moved.Status.Should().Be("Open", "a sign seen is never the work done");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_task_events")).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'PlannedWorkFollowedSchedule'")).Should().BeGreaterThan(0);

        // A later "not yet" takes the seen back: the plan waits again, the expectation is still day 10.
        await OkAsync(AnswerAsync(Worker, plot, cycle, "flower", "not_yet", start.AddDays(6)));
        var back = (await PlanRowsAsync()).Single();
        back.Planned.Should().BeNull();
        back.ExpectedFrom.Should().Be(start.AddDays(10));
    }

    [Fact]
    public async Task PredecessorCorrected_RecomputesFollower_KeepsHistory()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, start) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("first", "छाटणीनंतर पाणी", DayTiming(2))));
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("second", "खत", AfterTiming("first", 3))));
        var firstPlan = PlanIdOf(await OkAsync(PlanAsync(Owner, plot, cycle, "first")));
        await OkAsync(PlanAsync(Owner, plot, cycle, "second"));
        var secondItem = OwnScheduleItem.IdFor(cycle, "second");

        var follower = (await PlanRowsAsync(secondItem)).Single();
        follower.Planned.Should().BeNull("nothing was recorded for the work it follows: only an expectation");
        follower.ExpectedFrom.Should().Be(start.AddDays(5));

        // The first work is recorded (a log on day 4) and its plan completed with it: the follower is due 3 days after the RECORD.
        var log = Guid.NewGuid();
        await OkAsync(PushAsAsync(Owner, "create_daily_log", $"log-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["operatorUserId"] = Owner,
            ["logDate"] = start.AddDays(4).ToString("yyyy-MM-dd"),
            ["content"] = new { schema = 1 },
        }, "1.0.18"));
        await OkAsync(PushAsAsync(Owner, "plannedwork.complete", $"done-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = firstPlan,
            ["farmId"] = FarmA,
            ["plotIds"] = new[] { plot },
            ["dailyLogIds"] = new[] { log },
        }, "1.0.18"));
        (await PlanRowsAsync(secondItem)).Single().Planned.Should().Be(start.AddDays(7));

        // The record is CORRECTED (moved to day 6): the follower moves with it.
        await OkAsync(PushAsAsync(Owner, "move_daily_log", $"move-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["newLogDate"] = start.AddDays(6).ToString("yyyy-MM-dd"),
            ["reason"] = "दिवस चुकला",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        }, "1.0.18"));
        (await PlanRowsAsync(secondItem)).Single().Planned.Should().Be(start.AddDays(9));

        // The record is TAKEN BACK (the owner says the work was not done): the follower returns to its expectation.
        await OkAsync(PushAsAsync(Owner, "plannedwork.reopen", $"reopen-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["plannedWorkId"] = firstPlan, ["farmId"] = FarmA, ["reason"] = "काम झालं नाही" }, "1.0.18"));
        var returned = (await PlanRowsAsync(secondItem)).Single();
        returned.Planned.Should().BeNull("with no record there is only the expectation again");
        returned.ExpectedFrom.Should().Be(start.AddDays(5));
        returned.Status.Should().Be("Open", "no record is never 'not done'");

        // History kept: every move is one audit row on the follower (made, corrected, taken back).
        (await CountAsync(
            "SELECT count(*) FROM ssf.audit_events WHERE action = 'PlannedWorkFollowedSchedule' AND entity_id = @e",
            ("e", follower.Id))).Should().Be(3);
    }

    // ---- never a flood -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task RepeatingWork_MakesOneOpenOccurrenceAtATime()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, start) = await PlotOnDayAsync(15);
        var timing = DayTiming(5, 40);
        timing["repeat"] = "every_n_days";
        timing["repeatInterval"] = 7;
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("water", "पाणी", timing)));
        var item = OwnScheduleItem.IdFor(cycle, "water");

        var first = PlanIdOf(await OkAsync(PlanAsync(Owner, plot, cycle, "water")));
        PlanIdOf(await OkAsync(PlanAsync(Owner, plot, cycle, "water"))).Should().Be(first, "while one occurrence is open, planning again is the same plan");
        (await PlanRowsAsync(item)).Should().ContainSingle();

        await OkAsync(PushAsAsync(Owner, "plannedwork.complete", $"done-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = first,
            ["farmId"] = FarmA,
            ["plotIds"] = new[] { plot },
            ["dailyLogIds"] = Array.Empty<Guid>(),
        }, "1.0.18"));

        var second = PlanIdOf(await OkAsync(PlanAsync(Owner, plot, cycle, "water")));
        second.Should().NotBe(first);
        var rows = await PlanRowsAsync(item);
        rows.Select(r => r.Occurrence).Should().Equal(1, 2);
        rows[1].Planned.Should().Be(start.AddDays(12), "the next occurrence is the repeat's spacing after the first");
        rows.Count(r => r.Status is not ("Done" or "Cancelled")).Should().Be(1);
    }

    [Fact]
    public async Task TwoPhones_PlanTheSameOccurrenceOffline_OnePlan()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, _) = await PlotOnDayAsync();
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी", DayTiming(20))));
        var item = OwnScheduleItem.IdFor(cycle, "t1");

        // Phone 1 (the owner) and phone 2 (the मुकादम, planning permission by role) each minted their own id offline; then both sync.
        var one = await OkAsync(PlanAsync(Owner, plot, cycle, "t1", planId: Guid.NewGuid()));
        var two = await OkAsync(PlanAsync(Mukadam, plot, cycle, "t1", planId: Guid.NewGuid()));

        (await PlanRowsAsync(item)).Should().ContainSingle("two phones planning the same occurrence give one plan");
        PlanIdOf(two).Should().Be(PlanIdOf(one), "the second phone is answered with the plan already kept");

        // And when both mint the deterministic id, the replay path answers the same plan too.
        var three = await OkAsync(PlanAsync(Owner, plot, cycle, "t1", planId: PlannedWork.ScheduleIdFor(item, 1)));
        PlanIdOf(three).Should().Be(PlanIdOf(one));
        (await PlanRowsAsync(item)).Should().ContainSingle();
    }

    // ---- row security, both directions -------------------------------------------------------------------------------

    [Fact]
    public async Task ForeignFarm_BothDirections_Refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA, FarmB);
        var (plot, cycle, start) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("flower", "फुलोरा", SignTiming("फुले दिसली", 10))));
        await OkAsync(PlanAsync(Owner, plot, cycle, "flower"));
        await OkAsync(AnswerAsync(Owner, plot, cycle, "flower", "seen", start.AddDays(5)));
        var item = OwnScheduleItem.IdFor(cycle, "flower");

        // Farm B's owner names farm A: refused, nothing written. Farm A's owner names farm B, or farm A with farm B's plot: refused.
        (await PlanAsync(OwnerB, plot, cycle, "flower")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await AnswerAsync(OwnerB, plot, cycle, "flower", "seen")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await PlanAsync(Owner, plot, cycle, "flower", farm: FarmB)).Status.Should().Be("failed");
        (await PlanAsync(Owner, PlotB, CycleB, "flower")).Status.Should().Be("failed");
        (await AnswerAsync(Owner, PlotB, CycleB, "flower", "seen")).Status.Should().Be("failed");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_task_events")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE own_item_id IS NOT NULL")).Should().Be(1);

        // Row security as agrisync_app: farm B's scope sees none of farm A's answers or links; farm A's scope sees its own.
        (await AppCountAsync(FarmB, OwnerB, "SELECT count(*) FROM ssf.schedule_task_events")).Should().Be(0);
        (await AppCountAsync(FarmB, OwnerB, "SELECT count(*) FROM ssf.planned_work WHERE own_item_id IS NOT NULL")).Should().Be(0);
        (await AppCountAsync(FarmA, Owner, "SELECT count(*) FROM ssf.schedule_task_events")).Should().Be(1);

        string Insert(Guid farm, Guid plotId, Guid cycleId, Guid own, Guid by) => $"""
            INSERT INTO ssf.schedule_task_events (id, farm_id, plot_id, crop_cycle_id, own_item_id, task_key, answer, observed_on, recorded_by_user_id, recorded_at_utc)
            VALUES (gen_random_uuid(), '{farm}'::uuid, '{plotId}'::uuid, '{cycleId}'::uuid, '{own}'::uuid, 'flower', 'seen', CURRENT_DATE, '{by}'::uuid, NOW())
            """;
        (await AppTryAsync(FarmB, OwnerB, Insert(FarmA, plot, cycle, item, OwnerB))).Should().Be("42501", "farm B's scope cannot write an answer of farm A");
        (await AppTryAsync(FarmA, Owner, Insert(FarmB, PlotB, CycleB, item, Owner))).Should().Be("42501", "nor farm A's scope one of farm B");
        (await AppTryAsync(FarmA, Owner, Insert(FarmA, PlotB, CycleB, item, Owner))).Should().Be("42501", "nor an answer whose plot is not the work's");
        (await AppTryAsync(FarmA, Owner, Insert(FarmA, plot, cycle, item, Owner))).Should().BeNull("the positive control: farm A's own answer goes through");
        (await AppTryAsync(FarmA, Owner, "UPDATE ssf.schedule_task_events SET answer = 'unsure'")).Should().Be("42501", "the answers are append-only");
        (await AppTryAsync(FarmA, Owner, "DELETE FROM ssf.schedule_task_events")).Should().Be("42501");

        // A plan of farm B cannot link farm A's work (the trigger), and farm B's scope cannot touch farm A's plan.
        (await AppTryAsync(FarmB, OwnerB, $"""
            INSERT INTO ssf.planned_work (id, farm_id, title, scope, status, source, recorded_on, linked_daily_log_ids, created_by_user_id, created_at_utc, modified_at_utc,
                                          former_assignee_user_ids, own_item_id, schedule_task_key, occurrence)
            VALUES (gen_random_uuid(), '{FarmB}'::uuid, 'परकी', 'Farm', 'Open', 'Schedule', CURRENT_DATE, ARRAY[]::uuid[], '{OwnerB}'::uuid, NOW(), NOW(), ARRAY[]::uuid[], '{item}'::uuid, 'flower', 9)
            """)).Should().Be("42501");
        (await AppRowsAsync(FarmB, OwnerB, "UPDATE ssf.planned_work SET occurrence = 5 WHERE own_item_id IS NOT NULL")).Should().Be(0);
    }

    // ---- an old phone ------------------------------------------------------------------------------------------------

    [Fact]
    public async Task OldPhone_PullsAScheduleMadePlan_AndOnlyNewKeysAreAdded()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, start) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("flower", "फुलोरा फवारणी", SignTiming("फुले दिसली", 10))));
        await OkAsync(PlanAsync(Owner, plot, cycle, "flower"));
        await OkAsync(PushAsAsync(Owner, "plannedwork.create", $"extra-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["title"] = "विहीर",
            ["scope"] = "Plot",
            ["plotIds"] = new[] { plot },
            ["plannedDate"] = start.AddDays(18).ToString("yyyy-MM-dd"),
        }, "1.0.18"));

        // The pull a phone without the new format makes (no scheduleFormat): it is answered, and the plans arrive in the shape every older field had.
        var (body, root) = await PullAsync(Owner);
        var plans = ArrayOf(root, "plannedWork");
        plans.Should().HaveCount(2);
        var extra = plans.Single(p => p.GetProperty("title").GetString() == "विहीर");
        extra.TryGetProperty("ownItemId", out var none).Should().BeTrue();
        none.ValueKind.Should().Be(JsonValueKind.Null, "an ordinary plan carries the new keys empty");
        var fromSchedule = plans.Single(p => p.GetProperty("title").GetString() == "फुलोरा फवारणी");
        fromSchedule.GetProperty("plannedDate").ValueKind.Should().Be(JsonValueKind.Null, "a waiting plan is an undated plan to an older parser");
        fromSchedule.GetProperty("source").GetString().Should().Be("Schedule");

        // The body is kept for the phone's own test (an older DTO parser is run against it: mobile-web plannedWork.oldPhoneDto.test.ts).
        var path = Environment.GetEnvironmentVariable("SCHED5_PULL_SAMPLE_PATH");
        if (!string.IsNullOrWhiteSpace(path))
        {
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(plans, new JsonSerializerOptions { WriteIndented = true }));
        }

        body.Should().NotContain("schedule_task_events");
    }

    // ---- helpers (agrisync_app under a farm scope) -------------------------------------------------------------------

    private async Task<long> AppCountAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<int> AppRowsAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return await cmd.ExecuteNonQueryAsync();
    }

    private async Task<string?> AppTryAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        try
        {
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    private static async Task ScopeAsync(NpgsqlConnection db, Guid farm, Guid user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @f, true), set_config('agrisync.user_id', @u, true)";
        cmd.Parameters.AddWithValue("f", farm.ToString());
        cmd.Parameters.AddWithValue("u", user.ToString());
        await cmd.ExecuteNonQueryAsync();
    }
}
