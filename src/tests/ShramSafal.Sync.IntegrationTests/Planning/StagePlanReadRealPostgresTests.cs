// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-GATE-a Task 6, server half ("the stage panel"; founder D-99 layout B,
// R10, R28, R34, P4, E4; Review Focus 11, 12, 13).
//
// GET /shramsafal/farms/{farmId}/plots/{plotId}/stage-plan: what each schedule a plot follows asks in the plot's stage - the stage is the
// MAIN schedule's (R28), the counts are the one engine's (CMP-E) from the days the schedules STORE, never recounted on the phone.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and route. The engine's own numbers are computed in the
// test straight from the stored rows (no mapper, no DTO) and compared. Fake phone numbers only.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class StagePlanReadRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd");

    private Task PaidAsync() =>
        SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));

    private async Task<JsonElement> GetOkAsync(Guid user, Guid plot, string? forDate = null)
    {
        var (status, body) = await StagePlanAsync(user, FarmA, plot, forDate);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private static IReadOnlyList<JsonElement> Schedules(JsonElement root) => root.GetProperty("schedules").EnumerateArray().ToList();

    private static IReadOnlyList<JsonElement> Items(JsonElement schedule) => schedule.GetProperty("items").EnumerateArray().ToList();

    private static int[]? DaysOf(JsonElement item) =>
        item.GetProperty("days").ValueKind == JsonValueKind.Null ? null : item.GetProperty("days").EnumerateArray().Select(d => d.GetInt32()).ToArray();

    private async Task<ScheduleTemplate> CheckedAsync(string name, IReadOnlyList<StageDefinition> stages, IReadOnlyList<ImportedActivity> activities)
    {
        var row = await SeedStoredRowWithStagesAsync(name, stages, activities);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);
        return row;
    }

    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate Uni, Guid Sub)> PlotFollowingUniversityAsync(int dayToday, string? referenceDate = null)
    {
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-dayToday));
        var sub = await PushAdoptAsync(Owner, plot, cycle, uni.Id, referenceDate);
        return (plot, cycle, uni, sub);
    }

    // ---- the plan's facts ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Followed_schedules_come_in_slot_order_with_his_own_last()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, cycle, uni, _) = await PlotFollowingUniversityAsync(20);
        var second = await CheckedInstitutionAsync("Grapes - Second Checked");
        var third = await CheckedInstitutionAsync("Grapes - Third Checked");
        await PushAdoptAsync(Owner, plot, cycle, second.Id);
        await PushAdoptAsync(Owner, plot, cycle, third.Id);

        // His OWN schedule cannot be adopted before SCH-OWN opens that branch (adopt answers OwnScheduleNotOpenYet), so its row is
        // DB-seeded here (superuser, arrangement only), in place 0, exactly as L8b-3's tests did. It stores days (D-82 = 3).
        var own = await SeedStoredRowWithStagesAsync("Grapes - Mine", UnequalStages,
            [new ImportedActivity("m1", "बुरशीनाशक फवारणी", 18, 40, FrequencyMode.EveryNDays, 5)],
            TenantScope.Team, Owner);
        await SeedFollowedRowAsync(plot, cycle, own.Id, "Own", 0);

        // The owner's pull with this plot on 3 + 1 is kept for the P11 run (release 1.0.17's own reader parses it).
        var (threePlusOneBody, _) = await PullAsync(Owner);
        KeepGateBody("owner-three-plus-one", threePlusOneBody);

        var plan = await GetOkAsync(Owner, plot);
        var schedules = Schedules(plan);
        schedules.Select(s => s.GetProperty("name").GetString()).Should().Equal(
            "Grapes - University Schedule", "Grapes - Second Checked", "Grapes - Third Checked", "Grapes - Mine");
        schedules.Select(s => (int)s.GetProperty("slot").GetInt16()).Should().Equal(1, 2, 3, 0);
        schedules.Select(s => s.GetProperty("origin").GetString()).Should().Equal("Outside", "Outside", "Outside", "Own");
        schedules.Select(s => s.GetProperty("isMain").GetBoolean()).Should().Equal(true, false, false, false);
        schedules[0].GetProperty("templateId").GetGuid().Should().Be(uni.Id);
        // every schedule is described inside the SAME stage window
        plan.GetProperty("stage").GetProperty("name").GetString().Should().Be("Canopy Build");
        schedules.Should().OnlyContain(s => Items(s).Count > 0, "each of them asks the spray in this stage");
    }

    [Fact]
    public async Task Times_equal_the_engine_for_the_same_window()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, _, uni, _) = await PlotFollowingUniversityAsync(20);
        var day0 = TodayIst().AddDays(-20);

        // The engine called directly on the same stored rows (Review Focus 11), with no mapper and no DTO in between.
        var definition = new ScheduleDefinition(
            uni.Id, uni.Name, uni.Stages.ToList(),
            uni.Activities.Select(a => new ScheduleActivityDef(
                a.Id, a.ActivityName, a.Part!.ToLowerInvariant(), a.OperationKey, a.Role, a.NutrientKey, a.OffsetDays, a.EndDay,
                a.FrequencyMode, a.IntervalDays, a.AfterActivityId)).ToList());
        var window = ScheduleFollowEngine.StageWindows(definition, day0).Single(w => w.Name == "Canopy Build");
        var expected = ScheduleFollowEngine.StagePlan(definition, day0, window);
        expected.Should().NotBeEmpty("the precondition: this stage asks something");

        var plan = await GetOkAsync(Owner, plot);
        var items = Items(Schedules(plan).Single());
        items.Select(i => i.GetProperty("activityId").GetGuid()).Should().BeEquivalentTo(expected.Select(e => e.ActivityId));
        foreach (var item in items)
        {
            var engine = expected.Single(e => e.ActivityId == item.GetProperty("activityId").GetGuid());
            DaysOf(item).Should().Equal(engine.Dates!.Select(d => d.DayNumber - day0.DayNumber));
            item.GetProperty("timesInStage").GetInt32().Should().Be(engine.TimesInStage);
            item.GetProperty("part").GetString().Should().Be(engine.Part);
            item.GetProperty("frequencyMode").GetString().Should().Be(engine.FrequencyMode.ToString());
            item.GetProperty("intervalDays").GetInt32().Should().Be(engine.IntervalDays!.Value);
        }

        // and the window it names is the stage's own
        var stage = plan.GetProperty("stage");
        stage.GetProperty("startDay").GetInt32().Should().Be(13);
        stage.GetProperty("endDay").GetInt32().Should().Be(40);
        stage.GetProperty("dayToday").GetInt32().Should().Be(20);
    }

    [Fact]
    public async Task A_second_schedule_is_counted_in_the_main_schedules_stage_window()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, cycle, _, _) = await PlotFollowingUniversityAsync(20); // main: stages 0-12 / 13-40 / 41-99, day 0 = 20 days ago
        var second = await CheckedAsync("Grapes - Other Checked",
            [new StageDefinition("A", 0, 5), new StageDefinition("B", 6, 30), new StageDefinition("C", 31, 99)],
            [new ImportedActivity("irr", "Drip Irrigation", 0, 99, FrequencyMode.EveryNDays, 2)]);
        // its OWN day 0 is 10 days ago (the day count of a schedule is its own; the window is not)
        await PushAdoptAsync(Owner, plot, cycle, second.Id, Day(TodayIst().AddDays(-10)));

        var plan = await GetOkAsync(Owner, plot);
        plan.GetProperty("stage").GetProperty("name").GetString().Should().Be("Canopy Build", "the stage is the MAIN schedule's");
        var other = Schedules(plan).Single(s => s.GetProperty("templateId").GetGuid() == second.Id);
        var irrigation = Items(other).Single();

        // Window = main days 13..40 = today-7 .. today+20. The second's irrigation falls every 2 days from ITS day 0 (today-10):
        // k = 4, 6, ..., 30 days after its day 0 are inside it (14 dates), which are days 14, 16, ..., 40 of the main count.
        var expectedDays = Enumerable.Range(0, 14).Select(i => 14 + (2 * i)).ToArray();
        DaysOf(irrigation).Should().Equal(expectedDays);
        irrigation.GetProperty("timesInStage").GetInt32().Should().Be(14);
        // Had the window come from the second schedule's own stage B (its days 6-30) the count would have been 13.
        expectedDays.Length.Should().NotBe(13);
    }

    [Fact]
    public async Task An_activity_without_stored_days_has_null_days_and_null_times()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        // D-91 = 1: while grapes have no checked schedule a sample is followable. The plot follows one...
        var sample = await SeedThinRowAsync("Grapes - SCH-GATE sample", ("Foliar Spray", 15));
        await PushAdoptAsync(Owner, plot, cycle, sample);
        // ...then a checked schedule arrives and the sample drops out of the library for a NEW choice (R7: the plot keeps it).
        await CheckedInstitutionAsync();
        (await LibraryAsync(Owner)).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(sample, "the precondition: the library no longer lists it");
        var uni = (await LibraryAsync(Owner)).Single(t => t.GetProperty("name").GetString() == "Grapes - University Schedule");
        await PushAdoptAsync(Owner, plot, cycle, uni.GetProperty("id").GetGuid());

        var plan = await GetOkAsync(Owner, plot);
        var kept = Schedules(plan).SingleOrDefault(s => s.GetProperty("templateId").GetGuid() == sample);
        kept.ValueKind.Should().Be(JsonValueKind.Object, "a sample kept after its crop got a checked schedule is still described (a library lookup would lose it)");
        var spray = Items(kept).Single();
        spray.GetProperty("title").GetString().Should().Be("Foliar Spray");
        spray.GetProperty("part").GetString().Should().Be("spray");
        spray.GetProperty("days").ValueKind.Should().Be(JsonValueKind.Null, "its days are not stored: words only");
        spray.GetProperty("timesInStage").ValueKind.Should().Be(JsonValueKind.Null, "and no number");
        spray.GetProperty("frequencyMode").ValueKind.Should().Be(JsonValueKind.Null);
        // the checked schedule next to it still counts
        Items(Schedules(plan).Single(s => s.GetProperty("templateId").GetGuid() == uni.GetProperty("id").GetGuid()))
            .Should().OnlyContain(i => i.GetProperty("timesInStage").ValueKind == JsonValueKind.Number);
    }

    [Fact]
    public async Task No_stored_main_stage_means_no_stage_and_no_items()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        var sample = await SeedThinRowAsync("Grapes - SCH-GATE only sample", ("Foliar Spray", 15));
        await PushAdoptAsync(Owner, plot, cycle, sample);

        var plan = await GetOkAsync(Owner, plot);
        plan.GetProperty("needsSchedule").GetBoolean().Should().BeFalse();
        plan.GetProperty("stage").ValueKind.Should().Be(JsonValueKind.Null, "a sample stores no stages: no stage is invented (P4)");
        Items(Schedules(plan).Single()).Should().BeEmpty();
    }

    [Fact]
    public async Task His_own_schedule_has_no_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, cycle, _, _) = await PlotFollowingUniversityAsync(20);
        var own = await SeedStoredRowWithStagesAsync("Grapes - Mine", UnequalStages,
            [new ImportedActivity("m1", "बुरशीनाशक फवारणी", 18, 40, FrequencyMode.EveryNDays, 5)], TenantScope.Team, Owner);
        await SeedFollowedRowAsync(plot, cycle, own.Id, "Own", 0);

        var schedules = Schedules(await GetOkAsync(Owner, plot));
        var mine = schedules.Single(s => s.GetProperty("origin").GetString() == "Own");
        mine.GetProperty("check").ValueKind.Should().Be(JsonValueKind.Null, "D-82 = 3: never a badge, never 'waiting'");
        Items(mine).Should().NotBeEmpty("it stores days, so it counts");
        var outside = schedules.Single(s => s.GetProperty("origin").GetString() == "Outside");
        outside.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
    }

    [Fact]
    public async Task In_the_trial_only_todays_stage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(10), DateTime.UtcNow.AddDays(10));
        var (plot, _, _, _) = await PlotFollowingUniversityAsync(20);
        var eighteenDaysAgo = Day(TodayIst().AddDays(-18)); // day 2 = "Post Pruning"

        var trial = await GetOkAsync(Owner, plot, eighteenDaysAgo);
        trial.GetProperty("stage").GetProperty("name").GetString().Should().Be("Canopy Build", "in the trial the stage is today's whatever the date asked (R10)");
        trial.GetProperty("stage").GetProperty("dayToday").GetInt32().Should().Be(20);

        // Control: after the trial the same date asked names that day's stage - the date IS honoured outside the trial.
        await PaidAsync();
        var paid = await GetOkAsync(Owner, plot, eighteenDaysAgo);
        paid.GetProperty("stage").GetProperty("name").GetString().Should().Be("Post Pruning");
        paid.GetProperty("stage").GetProperty("dayToday").GetInt32().Should().Be(20, "'you are on day N' is always today");
    }

    [Fact]
    public async Task After_the_trial_with_NeedsSchedule_no_counts_are_returned()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        await CheckedInstitutionAsync();
        var (plot, _) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));

        // the precondition, through the pull
        StateOf((await PullAsync(Owner)).Root, plot)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();

        var plan = await GetOkAsync(Owner, plot);
        plan.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();
        plan.GetProperty("stage").ValueKind.Should().Be(JsonValueKind.Null);
        Schedules(plan).Should().BeEmpty("nothing is counted until he chooses");
    }

    [Fact]
    public async Task The_answer_holds_no_done_count_and_no_quantity()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var uni = await CheckedInstitutionAsync();
        // PlotA already holds records that WOULD be counted (the base farm's logs, with inputs and a quantity, and a cost entry).
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE plot_id = @p", ("p", PlotA))).Should().BeGreaterThan(0);
        (await CountAsync("SELECT count(*) FROM ssf.cost_entries WHERE plot_id = @p", ("p", PlotA))).Should().BeGreaterThan(0);
        await PushAdoptAsync(Owner, PlotA, CycleA, uni.Id, Day(TodayIst().AddDays(-20)));

        var plan = await GetOkAsync(Owner, PlotA);
        Items(Schedules(plan).Single()).Should().NotBeEmpty("the answer is live, not an empty shell");

        var names = new SortedSet<string>(StringComparer.Ordinal);
        void Walk(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var p in e.EnumerateObject())
                    {
                        names.Add(p.Name);
                        Walk(p.Value);
                    }

                    break;
                case JsonValueKind.Array:
                    foreach (var child in e.EnumerateArray())
                    {
                        Walk(child);
                    }

                    break;
            }
        }

        Walk(plan);
        names.Should().BeEquivalentTo(new[]
        {
            "serverTimeUtc", "plotId", "needsSchedule", "stage", "name", "startDay", "endDay", "dayToday", "schedules",
            "subscriptionId", "templateId", "slot", "origin", "isMain", "check", "state", "checkerDisplayName", "checkedAtUtc", "note", "items",
            "activityId", "part", "title", "operationKey", "frequencyMode", "intervalDays", "days", "timesInStage", "afterTitle",
        }, "exactly these fields; no done, no remaining, no amount, no quantity, no money (P4)");
        names.Should().NotContain(n => n.Contains("done", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("quantity", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("amount", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("cost", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("count", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task A_seat_without_farm_overview_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, _, _, _) = await PlotFollowingUniversityAsync(20);

        (await StagePlanAsync(Owner, FarmA, plot)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: a seat that reads the overview gets it");
        (await StagePlanAsync(CoOwner, FarmA, plot)).Status.Should().Be(HttpStatusCode.OK);
        var worker = await StagePlanAsync(Worker, FarmA, plot);
        worker.Status.Should().Be(HttpStatusCode.Forbidden, "a कामगार reads his own records only: no overview, no stage plan");
        worker.Body.Should().NotContain(plot.ToString());
    }

    [Fact]
    public async Task A_chosen_plots_seat_asking_another_plot_gets_404()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (mine, _, _, _) = await PlotFollowingUniversityAsync(20);
        var (other, otherCycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-5));
        _ = otherCycle;
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { mine } }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await StagePlanAsync(Mukadam, FarmA, mine)).Status.Should().Be(HttpStatusCode.OK, "his own plot");
        var notMine = await StagePlanAsync(Mukadam, FarmA, other);
        var madeUpId = Guid.NewGuid();
        var madeUp = await StagePlanAsync(Mukadam, FarmA, madeUpId);
        notMine.Status.Should().Be(HttpStatusCode.NotFound);
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        ErrorCode(notMine.Body).Should().Be(ErrorCode(madeUp.Body), "E4: a plot he may not see answers exactly like one that does not exist");
        notMine.Body.Replace(other.ToString(), "X").Should().Be(madeUp.Body.Replace(madeUpId.ToString(), "X"), "same body, ids aside");
    }

    [Fact]
    public async Task Another_farms_plot_answers_404_like_a_made_up_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();

        // The owner of farm A asks about farm B's plot through HIS farm's route.
        var foreign = await StagePlanAsync(Owner, FarmA, PlotB);
        var madeUp = await StagePlanAsync(Owner, FarmA, Guid.NewGuid());
        foreign.Status.Should().Be(HttpStatusCode.NotFound);
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        ErrorCode(foreign.Body).Should().Be(ErrorCode(madeUp.Body));

        // Farm B's owner on farm A's route is refused outright, and learns nothing about the plot.
        var (plotA2, _) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-5));
        var outsider = await StagePlanAsync(OwnerB, FarmA, plotA2);
        outsider.Status.Should().NotBe(HttpStatusCode.OK);
        outsider.Body.Should().NotContain(plotA2.ToString());

        // SCH-GATE-a review L005: a farm he has no seat on answers like a farm that does not exist (E4), body ids aside.
        var madeUpFarmId = Guid.NewGuid();
        var madeUpPlotId = Guid.NewGuid();
        var unseenFarm = await StagePlanAsync(OwnerB, FarmA, plotA2);
        var noFarm = await StagePlanAsync(OwnerB, madeUpFarmId, madeUpPlotId);
        unseenFarm.Status.Should().Be(noFarm.Status, "E4: a farm he cannot open answers exactly like one that does not exist");
        ErrorCode(unseenFarm.Body).Should().Be(ErrorCode(noFarm.Body));
        unseenFarm.Body.Replace(FarmA.ToString(), "F").Replace(plotA2.ToString(), "P")
            .Should().Be(noFarm.Body.Replace(madeUpFarmId.ToString(), "F").Replace(madeUpPlotId.ToString(), "P"));
    }

    [Fact]
    public async Task A_stored_order_gives_AfterTitle()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, _, _, _) = await PlotFollowingUniversityAsync(3); // day 3: "Post Pruning" (0-12)

        var items = Items(Schedules(await GetOkAsync(Owner, plot)).Single());
        var cut = items.Single(i => i.GetProperty("title").GetString() == "Pruning");
        var paste = items.Single(i => i.GetProperty("title").GetString() == "Paste");
        paste.GetProperty("afterTitle").GetString().Should().Be("Pruning", "the schedule stores that Paste comes after Pruning (R34)");
        cut.GetProperty("afterTitle").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task A_followed_row_with_no_place_has_a_null_slot_never_the_own_place()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        // A row written by a binary that sets no place (the deployed server does not, E8): arranged as superuser.
        await SeedFollowedRowAsync(plot, cycle, uni.Id, "Outside", null);

        var only = Schedules(await GetOkAsync(Owner, plot)).Single();
        only.GetProperty("slot").ValueKind.Should().Be(JsonValueKind.Null, "0 is HIS OWN place; a row with no place is not shown as one that it does not hold");
        only.GetProperty("origin").GetString().Should().Be("Outside");
        only.GetProperty("isMain").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task A_date_that_is_not_a_date_is_refused_with_400_not_guessed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, _, _, _) = await PlotFollowingUniversityAsync(20);

        (await StagePlanAsync(Owner, FarmA, plot, "2026-02-30")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await StagePlanAsync(Owner, FarmA, plot, "tomorrow")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await StagePlanAsync(Owner, FarmA, plot, Day(TodayIst()))).Status.Should().Be(HttpStatusCode.OK, "a real date is accepted");
    }
}
