// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W ("लक्ष द्या warns before, with proof and the reason"; founder L8-C1 note;
// R13, R29 path b, R35, D-100 note read with D-86, D-104e).
//
// The attention board used to read ONE planned-activity list, the latest season's, so a second followed schedule never reached it and an
// item carried only its name, stage, day and days late. Now, for a season with an Active subscription, the board reads each followed
// schedule's STORED days (the schedule engine's Expand), with the latest "पुढे ठरवा" applied to the reminder day, plus the season's locally
// added rows - and says WHY every item is there (which schedule, the plot's last real record of that kind, how often, which reason).
// A season with no Active subscription keeps today's board exactly (P11). Nothing is written to ssf.planned_activities.
//
// Real Postgres as agrisync_app (E3 first), through the real host and routes; a record reaches the plot through the real push door.
// Every negative asserts that NOTHING leaked and NOTHING was written. Fake phone numbers only.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data.Common;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class AttentionSeveralSchedulesRealPostgresTests(ITestOutputHelper output) : FarmCompareLane(output)
{
    private const string MigrationId = "20261113090000_AddScheduleStepMoves";
    private const string MigrationBefore = "20261110120000_ScheduleTemplateOwnerAndMadeFor";
    private const string Fungicide = "बुरशीनाशक फवारणी";
    private const string Boron = "बोरॉन फवारणी";
    private const string Drip = "ठिबक सिंचन";
    private const string GrowthRegulator = "जीए (संजीवक) बुडवणी";

    /// <summary>Counts every command EF Core sends and keeps its text (the named bound of the board's new reads).</summary>
    private sealed class CommandLog : DbCommandInterceptor
    {
        private int _count;
        private readonly ConcurrentBag<string> _texts = [];

        public int Count => Volatile.Read(ref _count);

        public int Reading(string table) => _texts.Count(t => t.Contains(table, StringComparison.OrdinalIgnoreCase));

        public void Reset()
        {
            Interlocked.Exchange(ref _count, 0);
            _texts.Clear();
        }

        private void Note(DbCommand command)
        {
            Interlocked.Increment(ref _count);
            _texts.Add(command.CommandText);
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Note(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        {
            Note(command);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
        {
            Note(command);
            return result;
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }
    }

    private readonly CommandLog _commands = new();

    protected override void AddHostServices(IServiceCollection services)
    {
        services.ConfigureDbContext<ShramSafalDbContext>(options => options.AddInterceptors(_commands));
    }

    // ---- the schedules and the plots ----------------------------------------------------------------------------

    /// <summary>Stages 0-30, 31-60, 61-90. A fungicide spray every 5 days from day 34 to 59 (34 39 44 49 54 59), a once-only boron spray on 47, drip every 5 days 31-56.</summary>
    private static IReadOnlyList<ImportedActivity> UniActivities =>
    [
        new("spray", Fungicide, 34, 59, FrequencyMode.EveryNDays, 5),
        new("boron", Boron, 47, 47, FrequencyMode.OneTime, 1),
        new("drip", Drip, 31, 56, FrequencyMode.EveryNDays, 5),
    ];

    private static DateOnly DayOf(int dayToday, int day) => TodayIst().AddDays(-dayToday + day);

    private static Guid ActivityOf(ScheduleTemplate schedule, string name) => schedule.Activities.Single(a => a.ActivityName == name).Id;

    /// <summary>Two checked schedules ("Sched U", "Sched V") both followed by ONE new plot whose day today is <paramref name="dayToday"/>.</summary>
    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate U, ScheduleTemplate V, Guid SubU, Guid SubV)> TwoSchedulesAsync(
        int dayToday, IReadOnlyList<ImportedActivity> second)
    {
        await PaidAccountAsync();
        var u = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);
        var v = await CheckedScheduleAsync("Sched V", CompareStages, second);
        var (plot, cycle, subU) = await FollowingAsync(u.Id, dayToday);
        var subV = await PushAdoptAsync(Owner, plot, cycle, v.Id);
        return (plot, cycle, u, v, subU, subV);
    }

    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate U, Guid SubU)> OneScheduleAsync(int dayToday)
    {
        await PaidAccountAsync();
        var u = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);
        var (plot, cycle, subU) = await FollowingAsync(u.Id, dayToday);
        return (plot, cycle, u, subU);
    }

    // ---- the reads ----------------------------------------------------------------------------------------------

    private async Task<JsonElement> BoardAsync(Guid user)
    {
        var (status, body) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/attention", user, null);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private static List<JsonElement> WorkOf(JsonElement board, Guid plot) =>
        ArrayOf(board, "scheduledWork").Where(w => w.GetProperty("plotId").GetGuid() == plot).ToList();

    private static JsonElement CardOf(JsonElement board, Guid plot) =>
        ArrayOf(board, "cards").Single(c => c.GetProperty("plotId").GetGuid() == plot);

    private static bool Absent(JsonElement e, string name) => !e.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null;

    private static string NameOf(JsonElement item) => item.GetProperty("activityName").GetString()!;

    /// <summary>A body with every clock removed (any property whose name ends in "Utc", at any depth), so two reads can be compared byte for byte.</summary>
    private static string Stable(string body, bool withoutIds = false)
    {
        object? Walk(JsonElement e) => e.ValueKind switch
        {
            JsonValueKind.Object => e.EnumerateObject().Where(p => !p.Name.EndsWith("Utc", StringComparison.Ordinal) && !(withoutIds && p.Name == "id"))
                .ToDictionary(p => p.Name, p => Walk(p.Value)),
            JsonValueKind.Array => e.EnumerateArray().Select(Walk).ToList(),
            JsonValueKind.String => e.GetString(),
            JsonValueKind.Number => e.GetRawText(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };

        using var doc = JsonDocument.Parse(body);
        return JsonSerializer.Serialize(Walk(doc.RootElement));
    }

    private static DateOnly DateOfItem(JsonElement item, string name) => DateOnly.Parse(item.GetProperty(name).GetString()!);

    private Task<(HttpStatusCode Status, string Body)> MoveAsync(Guid user, Guid farm, Guid subscription, Guid activity, DateOnly original, DateOnly to) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/farms/{farm}/schedule-steps/move", user, new
        {
            subscriptionId = subscription,
            activityId = activity,
            originalDate = Day(original),
            newDate = Day(to),
        });

    private Task<long> MoveRowsAsync(Guid? subscription = null) => CountAsync(
        "SELECT count(*) FROM ssf.schedule_step_moves WHERE (@s::uuid IS NULL OR schedule_subscription_id = @s)",
        ("s", (object?)subscription ?? DBNull.Value));

    private Task<long> PlannedRowsAsync(Guid cycle) => CountAsync(
        "SELECT count(*) FROM ssf.planned_activities WHERE crop_cycle_id = @c", ("c", cycle));

    /// <summary>A planned-activity row as superuser. A <paramref name="templateActivity"/> makes it a TEMPLATE-GENERATED row (otherwise it is locally added).</summary>
    private async Task<Guid> SeedPlannedAsync(Guid cycle, string name, DateOnly date, Guid? templateActivity = null)
    {
        var id = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc, source_template_activity_id)
            VALUES (@id, @cycle, @name, 'Vegetative', @date, NOW(), NOW(), @source)
            """,
            ("id", id), ("cycle", cycle), ("name", name), ("date", date), ("source", (object?)templateActivity ?? DBNull.Value));
        return id;
    }

    // ============================================================================================================
    // Task 1 - several schedules on the board
    // ============================================================================================================

    [Fact]
    public async Task A_plot_following_two_schedules_lists_both_schedules_due_steps()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // V asks a once-only growth-regulator dip on day 35, which U does not ask: both schedules' steps must be on the board.
        var (plot, _, _, _, subU, subV) = await TwoSchedulesAsync(40, [new("dip", GrowthRegulator, 35, 35, FrequencyMode.OneTime, 1)]);

        var work = WorkOf(await BoardAsync(Owner), plot);

        work.Where(w => w.GetProperty("scheduleName").GetString() == "Sched U").Select(NameOf).Should().Contain(Fungicide).And.Contain(Drip);
        work.Should().Contain(w => w.GetProperty("scheduleName").GetString() == "Sched V" && NameOf(w) == GrowthRegulator,
            "a second followed schedule used to never reach the board");
        work.Select(w => w.GetProperty("subscriptionId").GetGuid()).Distinct().Should().BeEquivalentTo([subU, subV]);
    }

    [Fact]
    public async Task The_same_step_on_the_same_day_from_both_schedules_is_one_item_with_AlsoAskedBy()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // U asks the fungicide spray on 34 and 39; V asks it on 39 too (the same work, the same day).
        var (plot, _, _, _, _, _) = await TwoSchedulesAsync(40, [new("fung", Fungicide, 39, 39, FrequencyMode.OneTime, 1)]);

        var board = await BoardAsync(Owner);
        var work = WorkOf(board, plot);

        var day39 = work.Where(w => NameOf(w) == Fungicide && DateOfItem(w, "plannedDate") == DayOf(40, 39)).ToList();
        var merged = day39.Should().ContainSingle("the same step asked by two schedules on one day shows ONCE (R13)").Subject;
        merged.GetProperty("scheduleName").GetString().Should().Be("Sched U", "the मुख्य schedule's step is the item");
        merged.GetProperty("alsoAskedBy").EnumerateArray().Select(n => n.GetString()).Should().Equal("Sched V");
        Absent(work.Single(w => NameOf(w) == Fungicide && DateOfItem(w, "plannedDate") == DayOf(40, 34)), "alsoAskedBy")
            .Should().BeTrue("a step only one schedule asks has nobody else to name");
        // open: drip 31, 36; fungicide 34, 39 (merged once) - the card's red count is 4, never 5
        CardOf(board, plot).GetProperty("overdueTaskCount").GetInt32().Should().Be(4);
    }

    [Fact]
    public async Task Only_open_steps_merge_into_one_item_and_the_overdue_count_counts_it_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Both schedules ask a fungicide spray on day 44: U as a repeated step, V as a once-only step. ONE record on day 38 is six days early:
        // for V it clears the once-only step (inside its stage, R35); for U it is on time for day 39 and not for day 44. So on day 44 only U's
        // step is OPEN: it is the item, and it names nobody else, because only open steps merge.
        var (plot, cycle, _, _, _, _) = await TwoSchedulesAsync(
            50, [new("fung", Fungicide, 44, 44, FrequencyMode.OneTime, 1)]);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 38), Fungicide);

        var openOnly = WorkOf(await BoardAsync(Owner), plot).Where(w => NameOf(w) == Fungicide && DateOfItem(w, "plannedDate") == DayOf(50, 44)).ToList();
        openOnly.Should().ContainSingle("U's step is open; V's was cleared early and is not an item");
        openOnly[0].GetProperty("scheduleName").GetString().Should().Be("Sched U");
        Absent(openOnly[0], "alsoAskedBy").Should().BeTrue("only OPEN steps merge: a step the record met never appears and never merges");
    }

    [Fact]
    public async Task One_record_clears_the_same_work_in_two_schedules_on_nearby_days()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // U asks a spray on day 49 and V on day 50; ONE spray is recorded on 49. Each subscription is matched on its own (R35): the record clears
        // BOTH (as तुलना counts it in both), so लक्ष द्या never reminds a spray तुलना counts.
        var (plot, cycle, _, _, _, _) = await TwoSchedulesAsync(
            52,
            [new("fung", Fungicide, 50, 50, FrequencyMode.OneTime, 1)]);
        await RecordAsync(Owner, plot, cycle, DayOf(52, 49), Fungicide);

        var work = WorkOf(await BoardAsync(Owner), plot);

        // U's 49 and V's 50 spray days are both within three days of the record on 49.
        work.Where(w => NameOf(w) == Fungicide && DateOfItem(w, "plannedDate") == DayOf(52, 49)).Should().BeEmpty("the record cleared U's spray day 49");
        work.Where(w => NameOf(w) == Fungicide && DateOfItem(w, "plannedDate") == DayOf(52, 50)).Should().BeEmpty("the same record cleared V's spray day 50 too");
    }

    [Fact]
    public async Task A_once_only_step_is_cleared_by_an_earlier_record_in_its_stage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The confirmation page's boron case: scheduled on day 47, recorded on day 42, same stage. लक्ष द्या does not remind it.
        var (plot, cycle, _, _) = await OneScheduleAsync(50);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 42), Boron);

        var work = WorkOf(await BoardAsync(Owner), plot);

        work.Select(NameOf).Should().NotContain(Boron, "a once-only work recorded early in its stage is never reminded (R35)");
        work.Select(NameOf).Should().Contain(Fungicide, "not vacuous: the other steps are still there");
    }

    [Fact]
    public async Task A_once_only_step_is_not_cleared_by_a_record_in_another_stage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _, _) = await OneScheduleAsync(50);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 25), Boron); // stage 1 (0-30); the boron step is in stage 2 (31-60)

        var work = WorkOf(await BoardAsync(Owner), plot);

        work.Should().Contain(w => NameOf(w) == Boron, "a record of another stage never clears it");
    }

    [Fact]
    public async Task A_repeated_step_keeps_the_three_day_rule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _, _) = await OneScheduleAsync(50);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 44), Fungicide); // spray days 44 (on time) and 39 / 49 (not within three days)

        var work = WorkOf(await BoardAsync(Owner), plot).Where(w => NameOf(w) == Fungicide).ToList();

        work.Should().NotContain(w => DateOfItem(w, "plannedDate") == DayOf(50, 44), "recorded on its own day");
        work.Should().Contain(w => DateOfItem(w, "plannedDate") == DayOf(50, 39), "five days away: not on time, not once-only");
    }

    [Fact]
    public async Task The_once_only_pass_runs_after_passes_1_and_2_and_never_takes_a_record_an_on_time_step_needs()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // ONE schedule asks a repeated fungicide spray (34 39 44 49 ...) AND a once-only fungicide spray on day 40 (the same stage). ONE record on
        // day 44: the on-time pass gives it to the repeated day-44 step; the once-only pass (it runs after) must not take it first.
        await PaidAccountAsync();
        var both = await CheckedScheduleAsync("Sched W", CompareStages,
        [
            new("spray", Fungicide, 34, 59, FrequencyMode.EveryNDays, 5),
            new("once", Fungicide, 40, 40, FrequencyMode.OneTime, 1),
        ]);
        var (plot, cycle, _) = await FollowingAsync(both.Id, 50);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 44), Fungicide);

        var work = WorkOf(await BoardAsync(Owner), plot).Where(w => NameOf(w) == Fungicide).ToList();

        work.Should().NotContain(w => DateOfItem(w, "originalDate") == DayOf(50, 44), "the on-time step kept its own record");
        work.Should().Contain(w => DateOfItem(w, "originalDate") == DayOf(50, 40),
            "the once-only pass never takes a record an on-time step needed: the once-only step is still open");
    }

    [Fact]
    public async Task A_once_only_pass_matches_by_role_never_by_name_alone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _, _) = await OneScheduleAsync(50);
        // A spray of ANOTHER role (an insecticide) five days early never clears the once-only boron spray.
        await RecordAsync(Owner, plot, cycle, DayOf(50, 42), "कीटकनाशक फवारणी");

        WorkOf(await BoardAsync(Owner), plot).Should().Contain(w => NameOf(w) == Boron);
    }

    [Fact]
    public async Task A_row_without_stored_frequency_is_never_once_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        // A THIN sample stores no days: it expands to nothing, so it is never a step and never once-only (P4). The plot has no step at all.
        var thin = await SeedThinRowAsync("Thin sample", ("बोरॉन फवारणी", 47));
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-50));
        await SeedFollowedRowAsync(plot, cycle, thin, "Outside", 1);
        await RecordAsync(Owner, plot, cycle, DayOf(50, 42), Boron);

        var board = await BoardAsync(Owner);

        WorkOf(board, plot).Should().BeEmpty("a schedule that stores no days asks no dated step");
    }

    [Fact]
    public async Task Board_steps_for_a_window_equal_Expand_dates()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // A spray stored every 5 days from day 34 to 59: six board steps on exactly the stage panel's six days (Review Focus 11).
        var (plot, _, _, _) = await OneScheduleAsync(60);

        var onBoard = WorkOf(await BoardAsync(Owner), plot).Where(w => NameOf(w) == Fungicide)
            .Select(w => w.GetProperty("scheduleDay").GetInt32()).OrderBy(d => d).ToList();

        var (status, body) = await StagePlanAsync(Owner, FarmA, plot, Day(DayOf(60, 40)));
        status.Should().Be(HttpStatusCode.OK, body);
        var panel = SchedulesOf(Json(body)).Single().GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("title").GetString() == Fungicide).GetProperty("days").EnumerateArray()
            .Select(d => d.GetInt32()).OrderBy(d => d).ToList();

        onBoard.Should().Equal(34, 39, 44, 49, 54, 59);
        onBoard.Should().Equal(panel, "the board and the panel read the same Expand dates");
    }

    [Fact]
    public async Task Adopting_writes_no_planned_activity_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var u = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-40));
        var before = await PlannedRowsAsync(cycle);

        var sub = await PushAdoptAsync(Owner, plot, cycle, u.Id);

        (await SubscriptionsAsync()).Should().Contain(s => s.Id == sub, "not vacuous: the schedule IS followed");
        (await PlannedRowsAsync(cycle)).Should().Be(before, "adopt writes none (R29: the board reads the schedule's own days)");
        await BoardAsync(Owner);
        (await PlannedRowsAsync(cycle)).Should().Be(before, "nor does reading the board");
    }

    [Fact]
    public async Task Compliance_signals_compare_and_plan_reads_are_unchanged_for_a_followed_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var u = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-40));
        await SeedPlannedAsync(cycle, "छाटणी", DayOf(40, 5), ActivityOf(u, Drip));
        await SeedPlannedAsync(cycle, "घड विरळणी", DayOf(40, 30));

        async Task<(string OldCompare, string OldStage, string PlanStage, string PlannedRows)> ReadAsync()
        {
            var oldCompare = await OldCompareAsync(Owner, cycle);
            oldCompare.Status.Should().Be(HttpStatusCode.OK, oldCompare.Body);
            var oldStage = await OldCompareStageAsync(Owner, cycle);
            var planStage = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/plan/stage?cropCycleId={cycle}&stage=Vegetative", Owner, null);
            var (_, pull) = await PullAsync(Owner);
            var planned = ArrayOf(pull, "plannedActivities").Where(p => p.GetProperty("cropCycleId").GetGuid() == cycle).ToList();
            planned.Should().HaveCount(2, "not vacuous: the pull carries the season's planned rows");
            return (Stable(oldCompare.Body), Stable(oldStage.Body), Stable(planStage.Body, withoutIds: true), JsonSerializer.Serialize(planned.Select(p => Stable(p.GetRawText())).OrderBy(x => x)));
        }

        var before = await ReadAsync();
        await PushAdoptAsync(Owner, plot, cycle, u.Id);
        var after = await ReadAsync();

        after.OldCompare.Should().Be(before.OldCompare, "the old compare reads only planned_activities");
        after.OldStage.Should().Be(before.OldStage);
        after.PlanStage.Should().Be(before.PlanStage, "/plan/stage reads only planned_activities");
        after.PlannedRows.Should().Be(before.PlannedRows, "the pull's planned rows are exactly as they were");
    }

    [Fact]
    public async Task Generated_rows_are_not_read_by_the_board_once_the_cycle_has_a_subscription()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var u = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-40));
        var generated = await SeedPlannedAsync(cycle, "टेम्पलेटचं काम", DayOf(40, 38), ActivityOf(u, Drip));
        var local = await SeedPlannedAsync(cycle, "स्वतःचं काम", DayOf(40, 38));

        var before = WorkOf(await BoardAsync(Owner), plot);
        before.Select(w => w.GetProperty("plannedActivityId").GetGuid()).Should().Contain([generated, local], "not followed yet: today's board lists both rows");

        await PushAdoptAsync(Owner, plot, cycle, u.Id);
        var after = WorkOf(await BoardAsync(Owner), plot);

        after.Select(w => w.GetProperty("plannedActivityId").GetGuid()).Should().NotContain(generated, "the schedule asks those steps itself: no double count");
        after.Select(w => w.GetProperty("plannedActivityId").GetGuid()).Should().Contain(local, "a locally added row is still the board's");
        after.Should().Contain(w => !Absent(w, "subscriptionId"), "not vacuous: the schedule's own steps are listed");
    }

    [Fact]
    public async Task A_plot_never_adopted_on_the_server_keeps_todays_board()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The base farm's own plot has no subscription; its base planned row (a spray) is cleared by the fixture's own records, so a row whose
        // words nobody can read (matched by its name alone, so no record meets it) is planted on it.
        var planted = await SeedPlannedAsync(CycleA, "Zzqq vvxx", new DateOnly(2026, 10, 1));
        var work = ArrayOf(await BoardAsync(Owner), "scheduledWork").Where(w => w.GetProperty("plotId").GetGuid() == PlotA).ToList();

        var item = work.Should().ContainSingle(w => w.GetProperty("plannedActivityId").GetGuid() == planted).Subject;
        NameOf(item).Should().Be("Zzqq vvxx");
        foreach (var added in new[] { "subscriptionId", "scheduleName", "alsoAskedBy", "lastSameWorkDate", "repeatText", "activityId", "originalDate", "scheduleDay" })
        {
            Absent(item, added).Should().BeTrue($"{added} belongs to a followed schedule's step only");
        }

        item.GetProperty("reasonKey").GetString().Should().BeOneOf("DueToday", "Late", "Missed");
        _commands.Reset();
        await BoardAsync(Owner);
        _commands.Reading("schedule_step_moves").Should().Be(0, "a farm with no Active subscription reads nothing more");
    }

    [Fact]
    public async Task A_worker_who_may_not_see_schedule_reminders_gets_none()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // REM-1 (who sees which reminder) is not built yet: this is TODAY'S board rule - a कामगार seat does not read the farm overview.
        var (plot, _, _, _) = await OneScheduleAsync(40);

        WorkOf(await BoardAsync(Owner), plot).Should().NotBeEmpty("not vacuous: the owner has items");
        var worker = await BoardAsync(Worker);

        ArrayOf(worker, "scheduledWork").Should().BeEmpty();
        ArrayOf(worker, "cards").Should().BeEmpty();
        worker.GetRawText().Should().NotContain(plot.ToString());
    }

    // ============================================================================================================
    // the move ("पुढे ठरवा" on a followed schedule's step)
    // ============================================================================================================

    [Fact]
    public async Task Moving_a_second_schedules_step_moves_only_that_step()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, v, subU, subV) = await TwoSchedulesAsync(40, [new("dip", GrowthRegulator, 35, 35, FrequencyMode.OneTime, 1)]);
        var before = WorkOf(await BoardAsync(Owner), plot);
        before.Should().Contain(w => NameOf(w) == GrowthRegulator);

        var moved = await MoveAsync(Owner, FarmA, subV, ActivityOf(v, GrowthRegulator), DayOf(40, 35), DayOf(40, 43));

        moved.Status.Should().Be(HttpStatusCode.OK, moved.Body);
        var after = WorkOf(await BoardAsync(Owner), plot);
        after.Should().NotContain(w => NameOf(w) == GrowthRegulator, "its reminder is on day 43 now: not yet");
        after.Count.Should().Be(before.Count - 1, "only that step moved");
        after.Where(w => w.GetProperty("subscriptionId").GetGuid() == subU).Should().HaveCount(
            before.Count(w => w.GetProperty("subscriptionId").GetGuid() == subU), "the first schedule's steps are untouched");
        (await MoveRowsAsync(subV)).Should().Be(1);
        (await MoveRowsAsync(subU)).Should().Be(0);
    }

    [Fact]
    public async Task Moving_a_subscription_step_changes_only_its_board_date_and_keeps_history()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, u, sub) = await OneScheduleAsync(40);
        var spray = ActivityOf(u, Fungicide);
        var original = DayOf(40, 39);

        // First move: to today. The item's reminder day is today and its reason is "due today"; the schedule's own day stays the original.
        (await MoveAsync(Owner, FarmA, sub, spray, original, DayOf(40, 40))).Status.Should().Be(HttpStatusCode.OK);
        var item = WorkOf(await BoardAsync(Owner), plot).Single(w => NameOf(w) == Fungicide && DateOfItem(w, "originalDate") == original);
        DateOfItem(item, "plannedDate").Should().Be(DayOf(40, 40));
        item.GetProperty("daysLate").GetInt32().Should().Be(0);
        item.GetProperty("reasonKey").GetString().Should().Be("DueToday");
        item.GetProperty("scheduleDay").GetInt32().Should().Be(39, "the schedule's own day never moves");

        // Second move: to tomorrow. The latest row wins (the step is not due), both rows stay.
        (await MoveAsync(Owner, FarmA, sub, spray, original, DayOf(40, 41))).Status.Should().Be(HttpStatusCode.OK);
        WorkOf(await BoardAsync(Owner), plot).Should().NotContain(w => NameOf(w) == Fungicide && DateOfItem(w, "originalDate") == original);
        (await MoveRowsAsync(sub)).Should().Be(2, "history is kept: a move appends, never updates");
        (await CountAsync(
            "SELECT count(*) FROM ssf.schedule_step_moves WHERE schedule_subscription_id = @s AND new_date = @d", ("s", sub), ("d", DayOf(40, 40))))
            .Should().Be(1, "the first row is still there, unchanged");

        // A re-sent request for the day the step already has writes nothing.
        (await MoveAsync(Owner, FarmA, sub, spray, original, DayOf(40, 41))).Status.Should().Be(HttpStatusCode.OK);
        (await MoveRowsAsync(sub)).Should().Be(2);
    }

    [Fact]
    public async Task A_moved_step_keeps_its_own_day_in_the_stage_panel_and_compare()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        var plot = (await SubscriptionsAsync()).Single().Plot;
        var panelBefore = Stable((await StagePlanAsync(Owner, FarmA, plot)).Body);
        var compareBefore = Stable((await CompareOkAsync(Owner, FarmA)).GetRawText());

        (await MoveAsync(Owner, FarmA, sub, ActivityOf(u, Fungicide), DayOf(40, 39), DayOf(40, 40))).Status.Should().Be(HttpStatusCode.OK);

        Stable((await StagePlanAsync(Owner, FarmA, plot)).Body).Should().Be(panelBefore, "a move changes only when लक्ष द्या reminds");
        Stable((await CompareOkAsync(Owner, FarmA)).GetRawText()).Should().Be(compareBefore, "तुलना counts the schedule's own days");
    }

    [Fact]
    public async Task A_move_on_a_plot_of_another_farm_answers_like_an_unknown_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, _) = await OneScheduleAsync(40);
        var thin = await SeedThinRowAsync("Thin sample for the crossed row", ("बोरॉन फवारणी", 47));
        var foreign = Guid.NewGuid();
        var crossed = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                    schedule_version_tag, adopted_at_utc, state, origin, check_state_at_adopt, slot, reference_date)
            VALUES (@foreign, @farmB, @plotB, @cycleB, 'grapes', @template, 'v1', NOW(), 0, 'Outside', 'Checked', 1, NULL),
                   (@crossed, @farmA, @plotB, @cycleB, 'grapes', @thin, 'v1', NOW(), 0, 'Outside', 'NotChecked', 2, NULL);
            """,
            ("foreign", foreign), ("crossed", crossed), ("farmA", FarmA), ("farmB", FarmB), ("plotB", PlotB), ("cycleB", CycleB),
            ("template", u.Id), ("thin", thin));
        var activity = ActivityOf(u, Fungicide);

        var madeUp = await MoveAsync(Owner, FarmA, Guid.NewGuid(), activity, DayOf(40, 39), DayOf(40, 41));
        var otherFarm = await MoveAsync(Owner, FarmA, foreign, activity, DayOf(40, 39), DayOf(40, 41));
        var mismatched = await MoveAsync(Owner, FarmA, crossed, activity, DayOf(40, 39), DayOf(40, 41));

        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        otherFarm.Status.Should().Be(HttpStatusCode.NotFound);
        otherFarm.Body.Should().Be(madeUp.Body, "another farm's subscription answers EXACTLY like a made-up id (E4)");
        mismatched.Status.Should().Be(HttpStatusCode.NotFound);
        mismatched.Body.Should().Be(madeUp.Body, "a subscription whose plot is another farm's answers the same");
        (await MoveAsync(Owner, FarmB, foreign, activity, DayOf(40, 39), DayOf(40, 41))).Status.Should().NotBe(HttpStatusCode.OK,
            "the owner of farm A is no member of farm B");
        (await MoveRowsAsync()).Should().Be(0, "nothing was written");
    }

    [Fact]
    public async Task A_chosen_plots_seat_with_PlanWork_moves_a_step_on_his_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, u, sub) = await OneScheduleAsync(40);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.PlanWork);
        using (var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { plot } }))
        {
            scoped.IsSuccessStatusCode.Should().BeTrue();
        }

        var moved = await MoveAsync(Mukadam, FarmA, sub, ActivityOf(u, Fungicide), DayOf(40, 39), DayOf(40, 41));

        moved.Status.Should().Be(HttpStatusCode.OK, moved.Body);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_step_moves WHERE schedule_subscription_id = @s AND moved_by_user_id = @u", ("s", sub), ("u", Mukadam)))
            .Should().Be(1, "the row names who moved it");
    }

    [Fact]
    public async Task A_chosen_plots_seat_moving_a_step_on_another_plot_gets_PlotScopeForbidden()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.PlanWork);
        using (var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { PlotA } }))
        {
            scoped.IsSuccessStatusCode.Should().BeTrue();
        }

        var moved = await MoveAsync(Mukadam, FarmA, sub, ActivityOf(u, Fungicide), DayOf(40, 39), DayOf(40, 41));

        moved.Status.Should().Be(HttpStatusCode.Forbidden);
        moved.Body.Should().Contain("PlotScope");
        (await MoveRowsAsync()).Should().Be(0);
    }

    [Fact]
    public async Task A_mukadam_without_PlanWork_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        var activity = ActivityOf(u, Fungicide);
        await SetAuthoritiesAsync(FarmA, Mukadam);
        await SetAuthoritiesAsync(FarmA, CoOwner);
        // The role pass of the planned-activity override door (a मुकादम or above) grants nothing here (D-26).
        var real = await MoveAsync(Mukadam, FarmA, sub, activity, DayOf(40, 39), DayOf(40, 41));
        var madeUp = await MoveAsync(Mukadam, FarmA, Guid.NewGuid(), activity, DayOf(40, 39), DayOf(40, 41));
        var worker = await MoveAsync(Worker, FarmA, sub, activity, DayOf(40, 39), DayOf(40, 41));
        var coOwner = await MoveAsync(CoOwner, FarmA, sub, activity, DayOf(40, 39), DayOf(40, 41));

        real.Status.Should().Be(HttpStatusCode.Forbidden);
        madeUp.Status.Should().Be(HttpStatusCode.Forbidden, "no seat without PlanWork can tell a real subscription from a made-up one");
        madeUp.Body.Should().Be(real.Body, "...nor by the body (P004)");
        worker.Status.Should().Be(HttpStatusCode.Forbidden);
        coOwner.Status.Should().Be(HttpStatusCode.Forbidden, "a co-owner holds nothing he was not given");
        (await MoveRowsAsync()).Should().Be(0);
    }

    [Fact]
    public async Task A_move_of_an_inactive_subscription_or_a_foreign_activity_or_a_date_not_in_Expand_is_refused_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        var spray = ActivityOf(u, Fungicide);

        // an activity that is not the schedule's
        var foreignActivity = await MoveAsync(Owner, FarmA, sub, Guid.NewGuid(), DayOf(40, 39), DayOf(40, 41));
        foreignActivity.Status.Should().Be(HttpStatusCode.BadRequest);
        foreignActivity.Body.Should().Contain("ScheduleStepNotInSchedule");

        // a day the activity does not ask (the spray asks 34, 39, 44...; day 40 is none of them)
        var notAsked = await MoveAsync(Owner, FarmA, sub, spray, DayOf(40, 40), DayOf(40, 41));
        notAsked.Status.Should().Be(HttpStatusCode.BadRequest);
        notAsked.Body.Should().Contain("ScheduleStepNotInSchedule");

        // a new day before today
        var past = await MoveAsync(Owner, FarmA, sub, spray, DayOf(40, 39), DayOf(40, 38));
        past.Status.Should().Be(HttpStatusCode.BadRequest);
        past.Body.Should().Contain("ScheduleStepMoveDate");

        // an inactive subscription
        await ExecOnSuperuserAsync("UPDATE ssf.schedule_subscriptions SET state = 2 WHERE id = @s", ("s", sub));
        var inactive = await MoveAsync(Owner, FarmA, sub, spray, DayOf(40, 39), DayOf(40, 41));
        inactive.Status.Should().Be(HttpStatusCode.BadRequest);
        inactive.Body.Should().Contain("ScheduleStepMoveInactive");

        (await MoveRowsAsync()).Should().Be(0, "every refusal wrote nothing");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'schedule.step.moved'")).Should().Be(0);
    }

    [Fact]
    public async Task A_successful_move_writes_one_audit_row_with_ids_and_dates_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);

        (await MoveAsync(Owner, FarmA, sub, ActivityOf(u, Fungicide), DayOf(40, 39), DayOf(40, 41))).Status.Should().Be(HttpStatusCode.OK);

        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'schedule.step.moved' AND entity_id = @s AND actor_user_id = @u",
            ("s", sub), ("u", Owner))).Should().Be(1, "a change is never silent (P3)");
    }

    // ---- fix round 1 -------------------------------------------------------------------------------------------

    private Task<long> MoveAuditsAsync() => CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'schedule.step.moved'");

    [Fact]
    public async Task A_seat_that_is_paused_removed_exited_or_waiting_is_refused_even_though_it_still_stores_PlanWork()
    {
        // P001: the stored PlanWork bit on a seat that is not Active holds nothing. Control first: the same seat moves a step while Active.
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        var spray = ActivityOf(u, Fungicide);
        var original = DayOf(40, 39);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.PlanWork);

        (await MoveAsync(Mukadam, FarmA, sub, spray, original, DayOf(40, 41))).Status.Should().Be(HttpStatusCode.OK, "control: Active + PlanWork moves it");
        var rows = await MoveRowsAsync();
        var audits = await MoveAuditsAsync();
        rows.Should().Be(1);
        audits.Should().Be(1);

        var day = 42;
        string? firstBody = null;
        // 4 Suspended (paused), 5 Revoked (removed), 6 Exited, 2 PendingApproval (waiting), 1 PendingOtpClaim
        foreach (var status in new[] { 4, 5, 6, 2, 1 })
        {
            await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET status = @s WHERE farm_id = @f AND user_id = @u", ("s", status), ("f", FarmA), ("u", Mukadam));

            var refused = await MoveAsync(Mukadam, FarmA, sub, spray, original, DayOf(40, day++));

            refused.Status.Should().Be(HttpStatusCode.Forbidden, $"seat status {status} is refused");
            firstBody ??= refused.Body;
            refused.Body.Should().Be(firstBody, "every refusal answers alike");
            (await MoveRowsAsync()).Should().Be(rows, $"nothing was written for status {status}");
            (await MoveAuditsAsync()).Should().Be(audits, $"no audit row was written for status {status}");
        }

        // and back to Active the same stored switch works again (the refusal was the seat's standing, not a broken row)
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET status = 3 WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Mukadam));
        (await MoveAsync(Mukadam, FarmA, sub, spray, original, DayOf(40, day))).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_new_day_beyond_ninety_days_past_the_later_of_today_and_the_original_day_is_refused_with_words()
    {
        // P002: bound = max(today, original day) + 90 days (farm-local).
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        var spray = ActivityOf(u, Fungicide);
        var past = DayOf(40, 39);   // yesterday: the later of (today, original) is today
        var future = DayOf(40, 44); // four days ahead: the later is the original day

        var tooFar = await MoveAsync(Owner, FarmA, sub, spray, past, DayOf(40, 40).AddDays(91));
        tooFar.Status.Should().Be(HttpStatusCode.BadRequest);
        tooFar.Body.Should().Contain("ScheduleStepMoveTooFar");
        var forever = await MoveAsync(Owner, FarmA, sub, spray, past, DateOnly.MaxValue);
        forever.Status.Should().Be(HttpStatusCode.BadRequest);
        forever.Body.Should().Contain("ScheduleStepMoveTooFar");
        (await MoveAsync(Owner, FarmA, sub, spray, future, future.AddDays(91))).Status.Should().Be(HttpStatusCode.BadRequest);
        (await MoveRowsAsync()).Should().Be(0, "nothing was written by a refusal");
        (await MoveAuditsAsync()).Should().Be(0);

        (await MoveAsync(Owner, FarmA, sub, spray, past, DayOf(40, 40).AddDays(90))).Status.Should().Be(HttpStatusCode.OK, "exactly on the bound");
        (await MoveAsync(Owner, FarmA, sub, spray, future, future.AddDays(90))).Status.Should().Be(HttpStatusCode.OK, "exactly on the bound of a step ahead");
        (await MoveRowsAsync()).Should().Be(2);
    }

    [Fact]
    public async Task A_first_ever_move_to_the_steps_own_original_day_is_200_and_writes_nothing()
    {
        // P005
        await AssertAppRoleIsNotVacuousAsync();
        var (_, _, u, sub) = await OneScheduleAsync(40);
        var original = DayOf(40, 44);

        (await MoveAsync(Owner, FarmA, sub, ActivityOf(u, Fungicide), original, original)).Status.Should().Be(HttpStatusCode.OK);

        (await MoveRowsAsync()).Should().Be(0, "no move row");
        (await MoveAuditsAsync()).Should().Be(0, "no audit row");
    }

    [Fact]
    public async Task LastSameWorkDate_never_names_a_record_outside_an_own_records_seats_reach()
    {
        // P006: a seat that reads the overview but only the records he made himself (OwnWork) is never given another person's day.
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _, _) = await OneScheduleAsync(40);
        await HoldsSeeCompareAsync(Mukadam);
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "OwnWork", plotIds = (Guid[]?)null }))
        {
            set.IsSuccessStatusCode.Should().BeTrue();
        }

        await RecordAsync(Owner, plot, cycle, DayOf(40, 36), Fungicide); // the owner's record: visible to everyone by audience, not his own

        var owner = WorkOf(await BoardAsync(Owner), plot).Single(w => NameOf(w) == Fungicide);
        var seatBoard = await BoardAsync(Mukadam);

        DateOfItem(owner, "lastSameWorkDate").Should().Be(DayOf(40, 36), "not vacuous: the owner reads it");
        // Today an own-records seat does not read the farm overview at all (FarmReadScope.SeeFarmOverview = !OwnRecordsOnly), so the board gives
        // him NOTHING of the plot: no item, no card, no day. The MayReadRecordOf clause in the board is a second lock behind that door.
        ArrayOf(seatBoard, "scheduledWork").Should().BeEmpty();
        seatBoard.GetRawText().Should().NotContain(plot.ToString()).And.NotContain(DayOf(40, 36).ToString("yyyy-MM-dd"));
    }

    [Fact]
    public async Task Two_same_work_same_day_open_steps_in_each_of_two_schedules_merge_into_two_groups_naming_both()
    {
        // P007: every open step lands in exactly one merged group; each group names both schedules; the red count is the number of merged items.
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var u = await CheckedScheduleAsync("Sched U", CompareStages,
        [
            new("a", Fungicide, 39, 39, FrequencyMode.OneTime, 1),
            new("b", Fungicide, 39, 39, FrequencyMode.OneTime, 1),
        ]);
        var v = await CheckedScheduleAsync("Sched V", CompareStages,
        [
            new("a", Fungicide, 39, 39, FrequencyMode.OneTime, 1),
            new("b", Fungicide, 39, 39, FrequencyMode.OneTime, 1),
        ]);
        var (plot, cycle, _) = await FollowingAsync(u.Id, 40);
        await PushAdoptAsync(Owner, plot, cycle, v.Id);

        var board = await BoardAsync(Owner);
        var items = WorkOf(board, plot);

        items.Should().HaveCount(2, "four open steps, two merged groups");
        foreach (var item in items)
        {
            item.GetProperty("scheduleName").GetString().Should().Be("Sched U");
            item.GetProperty("alsoAskedBy").EnumerateArray().Select(n => n.GetString()).Should().Equal("Sched V");
        }

        CardOf(board, plot).GetProperty("overdueTaskCount").GetInt32().Should().Be(items.Count, "the red count is the number of open merged items");
    }

    // ============================================================================================================
    // Task 2 - proof only from rows (P4)
    // ============================================================================================================

    [Fact]
    public async Task LastSameWorkDate_is_the_real_last_record_of_that_kind()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _, _) = await OneScheduleAsync(40);
        // "औषध मारलं" counts for a spray (WORK-ID): recorded on day 36, it clears spray day 34; spray day 39 is still open.
        await RecordAsync(Owner, plot, cycle, DayOf(40, 36), "औषध मारलं");

        var item = WorkOf(await BoardAsync(Owner), plot).Single(w => NameOf(w) == Fungicide);

        DateOfItem(item, "plannedDate").Should().Be(DayOf(40, 39));
        DateOfItem(item, "lastSameWorkDate").Should().Be(DayOf(40, 36), "the plot's real last record of that kind");
    }

    [Fact]
    public async Task LastSameWorkDate_is_null_when_there_is_no_record_and_the_phone_says_none()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await OneScheduleAsync(40);

        var item = WorkOf(await BoardAsync(Owner), plot).First(w => NameOf(w) == Fungicide);

        Absent(item, "lastSameWorkDate").Should().BeTrue("none is null - never a day count, never 0");
    }

    [Fact]
    public async Task LastSameWorkDate_never_names_a_record_kept_from_the_reader()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner);
        var (plot, cycle, _, _) = await OneScheduleAsync(40);
        await RecordAsync(Owner, plot, cycle, DayOf(40, 36), Fungicide, hide: true); // the owner keeps it "only me"

        var owner = WorkOf(await BoardAsync(Owner), plot).Single(w => NameOf(w) == Fungicide);
        var coOwner = WorkOf(await BoardAsync(CoOwner), plot).Where(w => NameOf(w) == Fungicide).ToList();

        DateOfItem(owner, "lastSameWorkDate").Should().Be(DayOf(40, 36), "not vacuous: the maker reads his own record's day");
        coOwner.Should().NotBeEmpty();
        coOwner.Should().OnlyContain(w => Absent(w, "lastSameWorkDate"), "a record kept from him clears the step for him but its day never reaches him (PRV)");
    }

    [Fact]
    public async Task RepeatText_is_a_stored_repeat_and_null_for_a_work_that_stores_none()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await OneScheduleAsync(50);

        var work = WorkOf(await BoardAsync(Owner), plot);

        work.First(w => NameOf(w) == Fungicide).GetProperty("repeatText").GetString().Should().Be("every_n_days:5");
        Absent(work.Single(w => NameOf(w) == Boron), "repeatText").Should().BeTrue("a once-only work stores no repeat: null, never guessed");
    }

    // ============================================================================================================
    // the table: privileges, the wall, the migration
    // ============================================================================================================

    private async Task SeedMoveRowAsync(Guid farm, Guid subscription) =>
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_step_moves ("Id", farm_id, schedule_subscription_id, template_activity_id, original_date, new_date, moved_by_user_id, moved_at_utc)
            VALUES (gen_random_uuid(), @f, @s, gen_random_uuid(), DATE '2026-11-01', DATE '2026-11-03', @u, NOW())
            """, ("f", farm), ("s", subscription), ("u", Owner));

    private async Task<long> CountAsAppAsync(Guid? farm, Guid? user)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText =
                $"SELECT set_config('agrisync.farm_id', '{(farm is { } f ? f.ToString() : string.Empty)}', true), "
                + $"set_config('agrisync.user_id', '{(user is { } u ? u.ToString() : string.Empty)}', true)";
            await scope.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT count(*) FROM ssf.schedule_step_moves";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<string> RefusedWithAsync(Guid farm, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText = $"SELECT set_config('agrisync.farm_id', '{farm}', true)";
            await scope.ExecuteNonQueryAsync();
        }

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
            return "none";
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    [Fact]
    public async Task Step_moves_of_another_farm_are_invisible_as_agrisync_app()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedMoveRowAsync(FarmA, Guid.NewGuid());
        await SeedMoveRowAsync(FarmB, Guid.NewGuid());

        (await CountAsAppAsync(FarmA, null)).Should().Be(1, "under its own farm's scope the row is there (else the proof is vacuous)");
        (await CountAsAppAsync(FarmB, null)).Should().Be(1, "farm B's scope sees only farm B's row");
        (await CountAsAppAsync(null, null)).Should().Be(0, "no scope sees nothing");
        (await CountAsAppAsync(null, Owner)).Should().Be(1, "farm A's primary account holder reads it by user scope (the board reads every farm of the caller)");
        (await CountAsAppAsync(null, OwnerB)).Should().Be(1, "farm B's owner reads farm B's row only");
        (await CountAsAppAsync(null, Paused)).Should().Be(0, "a paused seat reads nothing (m.status = 3)");

        var insert = $"""
            INSERT INTO ssf.schedule_step_moves ("Id", farm_id, schedule_subscription_id, template_activity_id, original_date, new_date, moved_by_user_id, moved_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}', gen_random_uuid(), gen_random_uuid(), DATE '2026-11-01', DATE '2026-11-03', '{Owner}', NOW())
            """;
        (await RefusedWithAsync(FarmB, insert)).Should().Be("42501", "a row policy refuses a row of another farm (WITH CHECK)");
    }

    [Fact]
    public async Task Update_and_delete_on_schedule_step_moves_are_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedMoveRowAsync(FarmA, Guid.NewGuid());

        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        foreach (var privilege in new[] { "SELECT", "INSERT" })
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT has_table_privilege(current_user, 'ssf.schedule_step_moves', '{privilege}')";
            (await cmd.ExecuteScalarAsync()).Should().Be(true, $"the app role appends and reads ({privilege})");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE", "TRUNCATE" })
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT has_table_privilege(current_user, 'ssf.schedule_step_moves', '{privilege}')";
            (await cmd.ExecuteScalarAsync()).Should().Be(false, $"a move is never edited or removed ({privilege} is revoked)");
        }

        foreach (var sql in new[]
                 {
                     "UPDATE ssf.schedule_step_moves SET new_date = DATE '2027-01-01'",
                     "DELETE FROM ssf.schedule_step_moves",
                     "TRUNCATE ssf.schedule_step_moves",
                 })
        {
            (await RefusedWithAsync(FarmA, sql)).Should().Be("42501", $"{sql} must be refused by privilege");
        }

        (await MoveRowsAsync()).Should().Be(1, "the refused writes changed nothing");
    }

    [Fact]
    public async Task The_table_is_forced_under_row_security_with_both_policies()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await CountAsync("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = 'schedule_step_moves' AND c.relrowsecurity AND c.relforcerowsecurity"))
            .Should().Be(1);
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'schedule_step_moves' AND policyname IN ('p_tenant_schedule_step_moves', 'p_user_select_schedule_step_moves')"))
            .Should().Be(2);
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'schedule_step_moves' AND policyname = 'p_user_select_schedule_step_moves' AND qual LIKE '%status = 3%'"))
            .Should().Be(1, "the member-read policy is written already narrowed to Active seats");
    }

    [Fact]
    public void AppendOnlyLedgers_lists_schedule_step_moves()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        string? text = null;
        while (current is not null && text is null)
        {
            var candidate = Path.Combine(current.FullName, "src", "tests", "ShramSafal.Sync.IntegrationTests", "Security", "AppendOnlyLedgerGrantsRealPostgresTests.cs");
            if (File.Exists(candidate))
            {
                text = File.ReadAllText(candidate);
            }

            current = current.Parent;
        }

        text.Should().NotBeNull("the suite's own source is found above the test output");
        text.Should().Contain("\"ssf.schedule_step_moves\"", "the table is named in AppendOnlyLedgers");
        text.Should().Contain("\"" + MigrationId + "\"", "the migration id is in the suite's reviewed list");
    }

    [Fact]
    public async Task The_migration_Down_drops_the_table_and_Up_brings_it_back()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedMoveRowAsync(FarmA, Guid.NewGuid());
        (await TableCountAsync()).Should().Be(1);

        await MigrateAsync(MigrationBefore);
        (await TableCountAsync()).Should().Be(0, "Down() drops the table (moved steps fall back to their schedule's day)");
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'schedule_step_moves'")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.planned_activities")).Should().BeGreaterThanOrEqualTo(1, "planned_activities is not touched");

        await MigrateAsync(null);
        (await TableCountAsync()).Should().Be(1, "Up() recreates it");
        (await MoveRowsAsync()).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = 'schedule_step_moves' AND c.relforcerowsecurity")).Should().Be(1);
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT has_table_privilege(current_user, 'ssf.schedule_step_moves', 'UPDATE') OR has_table_privilege(current_user, 'ssf.schedule_step_moves', 'DELETE')";
        (await cmd.ExecuteScalarAsync()).Should().Be(false, "the grants come back append-only too");
    }

    private Task<long> TableCountAsync() => CountAsync(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name = 'schedule_step_moves'");

    private async Task MigrateAsync(string? target)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);
        var migrator = db.Database.GetService<IMigrator>();
        if (target is null)
        {
            await migrator.MigrateAsync();
        }
        else
        {
            await migrator.MigrateAsync(target);
        }
    }

    [Fact]
    public void The_route_table_carries_the_move_route()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        string? text = null;
        while (current is not null && text is null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "routes", "server-rest-routes.txt");
            if (File.Exists(candidate))
            {
                text = File.ReadAllText(candidate);
            }

            current = current.Parent;
        }

        text.Should().NotBeNull();
        text!.Replace("\r\n", "\n").Split('\n').Should().Contain("POST /shramsafal/farms/{farmId:guid}/schedule-steps/move");
    }

    // ============================================================================================================
    // the member-read policy added beyond the plan: the board reads EVERY farm of the caller under his USER scope
    // ============================================================================================================

    [Fact]
    public async Task A_person_with_two_farms_sees_the_moves_of_both_on_the_board_and_another_user_none()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The co-owner of farm A is also an Active co-owner of farm B. Both farms' plots follow the same schedule; the spray of day 39 is due on both.
        var (plotA, _, u, subA) = await OneScheduleAsync(40);
        var cycleB = CycleB;
        await ExecOnSuperuserAsync("""
            UPDATE ssf.crop_cycles SET start_date = @start WHERE "Id" = @cycle;
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farmB, @coOwner, 'SecondaryOwner', NOW() - INTERVAL '30 days', NOW(), @accountB, 3, 256, TRUE);
            """,
            ("start", TodayIst().AddDays(-40)), ("cycle", cycleB), ("farmB", FarmB), ("coOwner", CoOwner), ("accountB", AccountB));
        var subB = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_subscriptions (id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id,
                                                    schedule_version_tag, adopted_at_utc, state, origin, check_state_at_adopt, slot, reference_date)
            VALUES (@sub, @farmB, @plotB, @cycleB, 'grapes', @template, 'v1', NOW(), 0, 'Outside', 'Checked', 1, NULL)
            """,
            ("sub", subB), ("farmB", FarmB), ("plotB", PlotB), ("cycleB", cycleB), ("template", u.Id));
        var spray = ActivityOf(u, Fungicide);
        var day39 = DayOf(40, 39);
        bool Lists(JsonElement board, Guid plot) =>
            WorkOf(board, plot).Any(w => NameOf(w) == Fungicide && DateOfItem(w, "originalDate") == day39);

        var before = await BoardAsync(CoOwner);
        Lists(before, plotA).Should().BeTrue("not vacuous: farm A's spray day 39 is on his board");
        Lists(before, PlotB).Should().BeTrue("not vacuous: farm B's spray day 39 is on his board");

        // one move on each farm: A's through the route, B's as superuser (as another PlanWork holder of farm B would have made it)
        (await MoveAsync(Owner, FarmA, subA, spray, day39, DayOf(40, 41))).Status.Should().Be(HttpStatusCode.OK);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_step_moves ("Id", farm_id, schedule_subscription_id, template_activity_id, original_date, new_date, moved_by_user_id, moved_at_utc)
            VALUES (gen_random_uuid(), @farmB, @sub, @activity, @original, @to, @by, NOW())
            """,
            ("farmB", FarmB), ("sub", subB), ("activity", spray), ("original", day39), ("to", DayOf(40, 41)), ("by", OwnerB));

        var after = await BoardAsync(CoOwner);
        Lists(after, plotA).Should().BeFalse("the move of farm A is read through his user scope");
        Lists(after, PlotB).Should().BeFalse("and so is the move of farm B: one request, two farms (without the member-read policy farm B's step would still be listed)");

        // another user: the owner of farm B sees farm B's move (his own farm) and nothing of farm A; a paused seat reads no move at all
        var ownerB = await BoardAsync(OwnerB);
        Lists(ownerB, PlotB).Should().BeFalse("the owner of farm B reads farm B's move");
        ArrayOf(ownerB, "scheduledWork").Should().NotContain(w => w.GetProperty("plotId").GetGuid() == plotA);
        (await CountAsAppAsync(null, Paused)).Should().Be(0);
        (await CountAsAppAsync(null, OwnerB)).Should().Be(1, "farm B's owner sees farm B's row only");
        (await CountAsAppAsync(null, CoOwner)).Should().Be(2, "the person with two farms sees both rows");

        // the read policy cannot write: under a user scope alone (no farm scope) an INSERT is refused
        var insert = $"""
            INSERT INTO ssf.schedule_step_moves ("Id", farm_id, schedule_subscription_id, template_activity_id, original_date, new_date, moved_by_user_id, moved_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}', gen_random_uuid(), gen_random_uuid(), DATE '2026-11-01', DATE '2026-11-03', '{CoOwner}', NOW())
            """;
        (await RefusedUnderUserScopeAsync(CoOwner, insert)).Should().Be("42501", "p_user_select_* is FOR SELECT: it never lets a row in");
        (await MoveRowsAsync()).Should().Be(2, "nothing was written by the refused insert");
    }

    private async Task<string> RefusedUnderUserScopeAsync(Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText = $"SELECT set_config('agrisync.user_id', '{user}', true), set_config('agrisync.farm_id', '', true)";
            await scope.ExecuteNonQueryAsync();
        }

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
            return "none";
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    // ============================================================================================================
    // cost: no query per plot beyond a named bound
    // ============================================================================================================

    private async Task AddFollowedPlotAsync(Guid uni)
    {
        var (plot, cycle, _) = await FollowingAsync(uni, 40);
        await RecordAsync(Owner, plot, cycle, DayOf(40, 36), Fungicide);
    }

    private async Task AddUnfollowedPlotAsync()
    {
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-40));
        await SeedPlannedAsync(cycle, "फवारणी", DayOf(40, 30));
        await RecordAsync(Owner, plot, cycle, DayOf(40, 36), Fungicide);
    }

    private async Task<int> BoardCommandsAsync()
    {
        await BoardAsync(Owner); // warm: the first read pays for compiled queries and nothing else
        _commands.Reset();
        await BoardAsync(Owner);
        return _commands.Count;
    }

    [Fact]
    public async Task The_board_costs_no_more_commands_per_plot_for_a_followed_plot_than_todays_board_and_reads_the_moves_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);

        await AddFollowedPlotAsync(uni.Id);
        var one = await BoardCommandsAsync();
        var movesOne = _commands.Reading("schedule_step_moves");
        for (var i = 0; i < 3; i++)
        {
            await AddFollowedPlotAsync(uni.Id);
        }

        var four = await BoardCommandsAsync();
        var movesFour = _commands.Reading("schedule_step_moves");
        for (var i = 0; i < 3; i++)
        {
            await AddUnfollowedPlotAsync();
        }

        var seven = await BoardCommandsAsync();
        Output.WriteLine($"[ATTW-COUNT] followed plots 1 -> 4: {one} -> {four}; plus 3 unfollowed: {seven}");

        movesOne.Should().Be(1, "the moves of every followed schedule are read ONCE");
        movesFour.Should().Be(1, "and still once with four followed plots");
        var followedSlope = (four - one) / 3.0;
        var unfollowedSlope = (seven - four) / 3.0;
        followedSlope.Should().BeLessThanOrEqualTo(unfollowedSlope + 0.001,
            "a followed plot costs no more commands than a plot on today's board (the schedule reads are constant for the request)");
    }

    [Fact]
    public async Task Board_read_time_inside_the_pull_stays_within_budget()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var uni = await CheckedScheduleAsync("Sched U", CompareStages, UniActivities);
        for (var i = 0; i < 4; i++)
        {
            await AddFollowedPlotAsync(uni.Id);
        }

        await PullAsync(Owner); // warm
        var clock = Stopwatch.StartNew();
        var (_, root) = await PullAsync(Owner);
        clock.Stop();

        Output.WriteLine($"[ATTW-TIME] pull of a farm with 5 plots, 4 followed: {clock.ElapsedMilliseconds} ms");
        root.TryGetProperty("attentionBoard", out _).Should().BeTrue("not vacuous: the pull carries the board");
        clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(10), "the budget on the throwaway cluster; the bound that matters is the command count above");
    }
}
