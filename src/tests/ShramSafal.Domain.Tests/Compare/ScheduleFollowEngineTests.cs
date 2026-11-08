// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-E; D-86 note, D-100, D-104 a-e; R12, R28, R33, R34)
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

/// <summary>
/// The one schedule engine, Domain only: expected dates and per-stage counts from the days a schedule stores.
/// There is no <c>OnTimeToleranceDays</c> test here on purpose: तुलना has no day window (D-100); that rule belongs to
/// लक्ष द्या (R35). No quantity exists in any output (P4).
/// </summary>
public sealed class ScheduleFollowEngineTests
{
    private static readonly DateOnly Zero = new(2026, 1, 1);
    private static DateOnly D(int day) => Zero.AddDays(day);

    private static Guid Id(int n) => new(n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);

    /// <summary>A stored activity. The part is read from the title by the work recogniser, never typed.</summary>
    private static ScheduleActivityDef Act(
        int n, string title, int start, int? end, FrequencyMode? mode, int? interval = null, int? after = null, string? part = "from-title")
    {
        var recognised = WorkRecogniser.Recognise(title);
        var partName = part == "from-title" ? recognised?.Part.ToString().ToLowerInvariant() : part;
        return new ScheduleActivityDef(Id(n), title, partName, null, null, null, start, end, mode, interval, after.HasValue ? Id(after.Value) : null);
    }

    private static ScheduleActivityDef Once(int n, string title, int day, int? after = null) =>
        Act(n, title, day, day, FrequencyMode.OneTime, null, after);

    private static ScheduleActivityDef Every(int n, string title, int start, int end, int every) =>
        Act(n, title, start, end, FrequencyMode.EveryNDays, every);

    private static ScheduleDefinition Schedule(int templateNumber, params ScheduleActivityDef[] activities) =>
        new(Id(1000 + templateNumber), "schedule " + templateNumber,
            [new StageDefinition("आधी", 0, 30), new StageDefinition("फुलोरा ते फळधारणा", 31, 60), new StageDefinition("नंतर", 61, 90)],
            activities);

    private static RecordedWork Rec(int day, string title, ExecutionStatus status = ExecutionStatus.Completed, bool disputed = false) =>
        new(title, D(day), status, disputed);

    private static StageWindow Stage2 => new("फुलोरा ते फळधारणा", D(31), D(60));

    private static FollowedSchedule Follow1(ScheduleDefinition s, short slot = 1, DateOnly? zero = null) => new(slot, s, zero ?? Zero);

    private static PlotFollowResult Run(IReadOnlyList<FollowedSchedule> followed, IReadOnlyList<RecordedWork> records, int today, StageWindow? only = null) =>
        ScheduleFollowEngine.Follow(followed, ScheduleFollowEngine.StageWindows(followed[0].Schedule, followed[0].DayZero), records, D(today), only);

    private static StageCount StageOf(PlotFollowResult r, int scheduleIndex, string name) =>
        r.Schedules[scheduleIndex].Stages.Single(s => s.Name == name);

    // ---- Expand / StagePlan (round 2) ----------------------------------------------------------------

    [Fact]
    public void Every_5_days_spray_over_days_18_to_35_expands_to_the_same_dates_as_the_phone()
    {
        // ClientPlanEngine.getPeriodicWindow: first = own start (inside the stage), step 5, stops at its own end day -> 18, 23, 28, 33.
        var schedule = Schedule(1, Every(1, "फवारणी", 18, 35, 5));

        var dates = ScheduleFollowEngine.Expand(schedule, Zero).Select(s => s.Date).ToArray();

        Assert.Equal([D(18), D(23), D(28), D(33)], dates);
    }

    [Fact]
    public void Stage_plan_counts_the_expanded_dates_in_the_window()
    {
        var schedule = Schedule(1, Every(1, "फवारणी", 34, 59, 5));

        var plan = ScheduleFollowEngine.StagePlan(schedule, Zero, new StageWindow("s", D(31), D(60)));

        var line = Assert.Single(plan);
        Assert.Equal(6, line.TimesInStage);
        Assert.Equal([D(34), D(39), D(44), D(49), D(54), D(59)], line.Dates);
    }

    [Fact]
    public void An_activity_without_stored_days_has_null_dates_and_null_times()
    {
        var words = Act(1, "फवारणी", 40, null, null);
        var schedule = Schedule(1, words);

        Assert.Empty(ScheduleFollowEngine.Expand(schedule, Zero));
        var line = Assert.Single(ScheduleFollowEngine.StagePlan(schedule, Zero, Stage2));
        Assert.Null(line.Dates);
        Assert.Null(line.TimesInStage);
        Assert.Empty(ScheduleFollowEngine.StagePlan(schedule, Zero, new StageWindow("s", D(61), D(90))));
    }

    [Fact]
    public void Stage_plan_count_equals_follow_expected_for_a_passed_stage()
    {
        var schedule = Schedule(1, Every(1, "फवारणी", 34, 59, 5), Every(2, "ठिबक सिंचन", 31, 56, 5), Once(3, "घड विरळणी", 38));
        var window = Stage2;
        var records = new[] { Rec(35, "फवारणी केली"), Rec(40, "ठिबक सिंचन"), Rec(45, "ठिबक सिंचन") };

        var plan = ScheduleFollowEngine.StagePlan(schedule, Zero, window);
        var result = Run([Follow1(schedule)], records, today: 70);
        var stage = StageOf(result, 0, window.Name);

        Assert.Equal(StageState.Passed, stage.State);
        Assert.Equal(plan.Sum(p => p.TimesInStage!.Value), stage.Asked);
        Assert.Equal(stage.Done + stage.NotYet, stage.Asked);
        Assert.Null(stage.DaysLeft);
    }

    [Fact]
    public void A_second_schedule_with_another_day_zero_is_counted_in_the_main_window()
    {
        // Schedule B's day 0 is 10 days later; its day-40 spray falls on plot day 50, inside the main schedule's window.
        var main = Schedule(1, Every(1, "ठिबक सिंचन", 31, 56, 5));
        var other = Schedule(2, Once(1, "फवारणी", 40));
        var followed = new[] { Follow1(main), Follow1(other, 2, D(10)) };

        var result = Run(followed, [Rec(50, "फवारणी केली")], today: 55);

        Assert.Equal(1, StageOf(result, 1, Stage2.Name).Asked);
        Assert.Equal(1, StageOf(result, 1, Stage2.Name).Done);
        Assert.Empty(result.OwnWork);
        // and the plot has one set of windows: schedule B's own stage names never appear
        Assert.All(result.Schedules, s => Assert.Equal(3, s.Stages.Count));
    }

    [Fact]
    public void PerWeek_spacing_matches_PlanDerivationEngine()
    {
        var template = ScheduleTemplate.Create(Guid.NewGuid(), "t", "Flowering", DateTime.UtcNow,
            stages: [new StageDefinition("Flowering", 0, 20)]);
        template.AddActivity(Guid.NewGuid(), "Spray", 0, FrequencyMode.PerWeek, 3);
        var derived = PlanDerivationEngine.DerivePlannedItemsForStage(template, Zero, "Flowering").Select(p => p.PlannedDate).ToArray();

        var schedule = Schedule(1, Act(1, "फवारणी", 0, 20, FrequencyMode.PerWeek, 3));
        var expanded = ScheduleFollowEngine.Expand(schedule, Zero).Select(s => s.Date).ToArray();

        Assert.NotEmpty(derived);
        Assert.Equal(derived, expanded);
    }

    [Fact]
    public void Expand_marks_only_a_stored_OneTime_as_once_only()
    {
        var schedule = Schedule(1, Once(1, "घड विरळणी", 38), Every(2, "ठिबक सिंचन", 31, 41, 5));

        var steps = ScheduleFollowEngine.Expand(schedule, Zero);

        Assert.True(steps.Single(s => s.ActivityId == Id(1)).OnceOnly);
        Assert.All(steps.Where(s => s.ActivityId == Id(2)), s => Assert.False(s.OnceOnly));
    }

    [Fact]
    public void StageWindows_are_the_main_schedules_stages_as_dates()
    {
        var windows = ScheduleFollowEngine.StageWindows(Schedule(1), D(5));

        Assert.Equal(new StageWindow("फुलोरा ते फळधारणा", D(36), D(65)), windows[1]);
    }

    // ---- Follow (round 3: R33 / R34) -----------------------------------------------------------------

    [Fact]
    public void A_record_anywhere_in_the_stage_counts_whatever_its_day()
    {
        // the day-48 spray recorded on day 54 (6 days after) and on day 43 (5 days before): both Done, no day compared
        var schedule = Schedule(1, Once(1, "बुरशीनाशक फवारणी", 48), Once(2, "बुरशीनाशक फवारणी", 70));
        var late = Run([Follow1(schedule)], [Rec(54, "बुरशीनाशक फवारणी")], today: 58);
        var early = Run([Follow1(schedule)], [Rec(43, "बुरशीनाशक फवारणी")], today: 58);

        Assert.Equal(1, StageOf(late, 0, Stage2.Name).Done);
        Assert.Equal(1, StageOf(early, 0, Stage2.Name).Done);
        Assert.Equal(0, StageOf(late, 0, Stage2.Name).NotYet);
    }

    [Fact]
    public void A_partial_record_counts_done_and_a_skipped_or_delayed_one_does_not()
    {
        var schedule = Schedule(1, Every(1, "बुरशीनाशक फवारणी", 34, 55, 7));
        var records = new[]
        {
            Rec(36, "बुरशीनाशक फवारणी", ExecutionStatus.Partial),
            Rec(44, "बुरशीनाशक फवारणी", ExecutionStatus.Skipped),
            Rec(45, "बुरशीनाशक फवारणी", ExecutionStatus.Delayed),
            Rec(46, "बुरशीनाशक फवारणी", disputed: true),
        };

        var line = StageOf(Run([Follow1(schedule)], records, today: 50), 0, Stage2.Name).Activities.Single();

        Assert.Equal(4, line.Asked);
        Assert.Equal(1, line.Done);
        Assert.Equal(3, line.NotYet);
    }

    [Fact]
    public void Running_stage_reports_not_yet_and_days_left()
    {
        var schedule = Schedule(1, Every(1, "ठिबक सिंचन", 31, 56, 5));

        var stage = StageOf(Run([Follow1(schedule)], [Rec(31, "ठिबक सिंचन")], today: 50), 0, Stage2.Name);

        Assert.Equal(StageState.Current, stage.State);
        Assert.Equal(10, stage.DaysLeft);
        Assert.Equal(6, stage.Asked);
        Assert.Equal(1, stage.Done);
        Assert.Equal(5, stage.NotYet);
    }

    [Fact]
    public void Passed_stage_reports_not_yet_with_no_days_left()
    {
        var schedule = Schedule(1, Every(1, "ठिबक सिंचन", 31, 56, 5));

        var stage = StageOf(Run([Follow1(schedule)], [Rec(31, "ठिबक सिंचन")], today: 75), 0, Stage2.Name);

        Assert.Equal(StageState.Passed, stage.State);
        Assert.Null(stage.DaysLeft);
        Assert.Equal(5, stage.NotYet);
    }

    [Fact]
    public void A_window_not_reached_has_null_numbers()
    {
        var schedule = Schedule(1, Every(1, "ठिबक सिंचन", 31, 56, 5), Act(2, "नंतरचे काम", 70, 70, FrequencyMode.OneTime, null, null, "work"), Once(3, "घड विरळणी", 70));

        var result = Run([Follow1(schedule)], [], today: 50);
        var ahead = StageOf(result, 0, "नंतर");

        Assert.Equal(StageState.Ahead, ahead.State);
        Assert.Null(ahead.Asked);
        Assert.Null(ahead.Done);
        Assert.Null(ahead.NotYet);
        Assert.Null(ahead.DaysLeft);
        Assert.All(ahead.Activities, a => Assert.Null(a.Asked));
        Assert.All(ahead.Activities, a => Assert.Equal(0, a.Done));
        Assert.All(ahead.Activities, a => Assert.Null(a.NotYet));
    }

    [Fact]
    public void More_records_than_asked_are_MoreThanAsked_on_that_schedule_and_not_own_work_when_another_schedule_asks_them()
    {
        var one = Schedule(1, Once(1, "बुरशीनाशक फवारणी", 36));
        var two = Schedule(2, Every(1, "बुरशीनाशक फवारणी", 34, 55, 7));
        var records = new[] { Rec(36, "बुरशीनाशक फवारणी"), Rec(44, "बुरशीनाशक फवारणी"), Rec(49, "बुरशीनाशक फवारणी") };

        var result = Run([Follow1(one), Follow1(two, 2)], records, today: 50);

        var first = StageOf(result, 0, Stage2.Name);
        Assert.Equal(1, first.Done);
        Assert.Equal(2, first.Activities.Single().MoreThanAsked);
        Assert.Equal(3, StageOf(result, 1, Stage2.Name).Done);
        Assert.Empty(result.OwnWork);
    }

    [Fact]
    public void A_record_after_the_window_counts_in_the_next_stage()
    {
        var schedule = Schedule(1, Once(1, "बुरशीनाशक फवारणी", 58), Once(2, "बुरशीनाशक फवारणी", 63));

        var result = Run([Follow1(schedule)], [Rec(62, "बुरशीनाशक फवारणी")], today: 65);

        Assert.Equal(0, StageOf(result, 0, Stage2.Name).Done);
        Assert.Equal(1, StageOf(result, 0, "नंतर").Done);
    }

    [Fact]
    public void An_order_note_only_when_the_later_work_comes_first()
    {
        // activity 2 (GA) is stored as coming after activity 1 (thinning)
        var schedule = Schedule(1, Once(1, "घड विरळणी", 38), Once(2, "जीए (संजीवक) बुडवणी", 42, after: 1));

        var wrong = Run([Follow1(schedule)], [Rec(44, "जीए (संजीवक) बुडवणी"), Rec(46, "घड विरळणी")], today: 50);
        var laterOnly = Run([Follow1(schedule)], [Rec(44, "जीए (संजीवक) बुडवणी")], today: 50);
        var right = Run([Follow1(schedule)], [Rec(40, "घड विरळणी"), Rec(44, "जीए (संजीवक) बुडवणी")], today: 50);

        var note = Assert.Single(wrong.Schedules[0].Order);
        Assert.Equal(new OrderNote(Id(1), Id(2), D(46), D(44)), note);
        Assert.Equal(new OrderNote(Id(1), Id(2), null, D(44)), Assert.Single(laterOnly.Schedules[0].Order));
        Assert.Empty(right.Schedules[0].Order);
        // a note never changes a count
        Assert.Equal(StageOf(wrong, 0, Stage2.Name).Done, 2);
    }

    [Fact]
    public void No_order_note_without_a_stored_order()
    {
        var schedule = Schedule(1, Once(1, "घड विरळणी", 38), Once(2, "जीए (संजीवक) बुडवणी", 42));

        var result = Run([Follow1(schedule)], [Rec(44, "जीए (संजीवक) बुडवणी"), Rec(46, "घड विरळणी")], today: 50);

        Assert.Empty(result.Schedules[0].Order);
    }

    [Fact]
    public void No_order_note_from_a_generic_records_placement()
    {
        // The later work (GA, stored to come after the thinning) has ONLY a generic record ("फवारणी केली"), dated
        // BEFORE the thinning keyed record. The tie rule places that generic record on the GA line (its next day is
        // earliest), so a note WOULD appear if placement drove notes. It must not.
        var schedule = Schedule(1, Once(1, "घड विरळणी", 44), Once(2, "जीए (संजीवक) बुडवणी", 40, after: 1));

        var result = Run([Follow1(schedule)], [Rec(40, "फवारणी केली"), Rec(45, "घड विरळणी")], today: 50);

        Assert.Empty(result.Schedules[0].Order);
        var stage = StageOf(result, 0, Stage2.Name);
        Assert.Equal(1, stage.Activities.Single(a => a.ActivityId == Id(2)).Done); // the generic record was placed on GA
        Assert.Equal(1, stage.Activities.Single(a => a.ActivityId == Id(1)).Done);
    }

    [Fact]
    public void A_stored_role_on_an_unrecognised_title_still_takes_its_records()
    {
        var line = new ScheduleActivityDef(Id(1), "zzqx wvv", "spray", null, "fungicide", null, 40, 40, FrequencyMode.OneTime, null, null);
        var schedule = Schedule(1, line);

        var fungicide = Run([Follow1(schedule)], [Rec(41, "बुरशीनाशक फवारणी")], today: 50);
        var insecticide = Run([Follow1(schedule)], [Rec(41, "कीटकनाशक फवारणी")], today: 50);

        Assert.Equal(1, StageOf(fungicide, 0, Stage2.Name).Done);
        Assert.Empty(fungicide.OwnWork);
        Assert.Equal(0, StageOf(insecticide, 0, Stage2.Name).Done);
        Assert.Single(insecticide.OwnWork);
    }

    [Fact]
    public void A_fungicide_record_never_fills_an_insecticide_line()
    {
        var schedule = Schedule(1, Once(1, "कीटकनाशक फवारणी", 46));

        var result = Run([Follow1(schedule)], [Rec(46, "बुरशीनाशक फवारणी")], today: 50);

        var stage = StageOf(result, 0, Stage2.Name);
        Assert.Equal(0, stage.Done);
        Assert.Equal(1, stage.NotYet);
        Assert.Single(result.OwnWork);
    }

    [Fact]
    public void A_generic_spray_goes_to_the_line_with_most_left_then_the_earliest_next_day()
    {
        // line 1: 4 dates left; line 2: 2 dates left -> the generic spray goes to line 1 (most left)
        var big = Every(1, "बुरशीनाशक फवारणी", 34, 55, 7);
        var small = Act(2, "कीटकनाशक फवारणी", 36, 50, FrequencyMode.EveryNDays, 14);
        var schedule = Schedule(1, big, small);
        var first = StageOf(Run([Follow1(schedule)], [Rec(40, "फवारणी केली")], today: 50), 0, Stage2.Name);
        Assert.Equal(1, first.Activities.Single(a => a.ActivityId == Id(1)).Done);
        Assert.Equal(0, first.Activities.Single(a => a.ActivityId == Id(2)).Done);

        // equal left (2 each): the line whose next stored day is earliest takes it
        var early = Act(3, "कीटकनाशक फवारणी", 34, 48, FrequencyMode.EveryNDays, 14);
        var late = Act(4, "बुरशीनाशक फवारणी", 36, 50, FrequencyMode.EveryNDays, 14);
        var tie = StageOf(Run([Follow1(Schedule(1, late, early))], [Rec(40, "फवारणी केली")], today: 50), 0, Stage2.Name);
        Assert.Equal(1, tie.Activities.Single(a => a.ActivityId == Id(3)).Done);
        Assert.Equal(0, tie.Activities.Single(a => a.ActivityId == Id(4)).Done);

        // equal left and equal next day: the lower activity id
        var a1 = Act(5, "कीटकनाशक फवारणी", 34, 48, FrequencyMode.EveryNDays, 14);
        var a2 = Act(6, "बुरशीनाशक फवारणी", 34, 48, FrequencyMode.EveryNDays, 14);
        var byId = StageOf(Run([Follow1(Schedule(1, a2, a1))], [Rec(40, "फवारणी केली")], today: 50), 0, Stage2.Name);
        Assert.Equal(1, byId.Activities.Single(a => a.ActivityId == Id(5)).Done);
    }

    [Fact]
    public void A_keyed_record_is_placed_before_a_generic_one()
    {
        // one fungicide line with one date: the generic spray recorded EARLIER must not take it from the fungicide record
        var schedule = Schedule(1, Once(1, "बुरशीनाशक फवारणी", 40), Once(2, "कीटकनाशक फवारणी", 41));
        var records = new[] { Rec(38, "फवारणी केली"), Rec(45, "बुरशीनाशक फवारणी") };

        var stage = StageOf(Run([Follow1(schedule)], records, today: 50), 0, Stage2.Name);

        Assert.Equal(1, stage.Activities.Single(a => a.ActivityId == Id(1)).Done);
        Assert.Equal(1, stage.Activities.Single(a => a.ActivityId == Id(2)).Done);
        Assert.Equal(2, stage.Done);
    }

    [Fact]
    public void A_words_only_activity_takes_its_records_and_they_are_not_own_work()
    {
        var sample = Act(1, "बुरशीनाशक फवारणी", 40, null, null);
        var stored = Once(2, "ठिबक सिंचन", 45);
        var schedule = Schedule(1, sample, stored);

        var result = Run([Follow1(schedule)], [Rec(41, "बुरशीनाशक फवारणी"), Rec(44, "ठिबक सिंचन")], today: 50);

        var stage = StageOf(result, 0, Stage2.Name);
        var words = stage.Activities.Single(a => a.ActivityId == Id(1));
        Assert.Null(words.Asked);
        Assert.Null(words.NotYet);
        Assert.Equal(1, words.Done);
        // the total sums ONLY the activity whose days are stored
        Assert.Equal(1, stage.Asked);
        Assert.Equal(1, stage.Done);
        Assert.Equal(0, stage.NotYet);
        Assert.Empty(result.OwnWork);
    }

    [Fact]
    public void A_stage_with_only_words_activities_has_null_totals()
    {
        var schedule = Schedule(1, Act(1, "बुरशीनाशक फवारणी", 40, null, null));

        var stage = StageOf(Run([Follow1(schedule)], [Rec(41, "बुरशीनाशक फवारणी")], today: 50), 0, Stage2.Name);

        Assert.Null(stage.Asked);
        Assert.Null(stage.Done);
        Assert.Null(stage.NotYet);
    }

    [Fact]
    public void A_skipped_record_turns_not_yet_into_said_not_done()
    {
        var schedule = Schedule(1, Every(1, "बुरशीनाशक फवारणी", 34, 48, 7)); // 34, 41, 48
        var records = new[]
        {
            Rec(36, "बुरशीनाशक फवारणी"),
            Rec(40, "बुरशीनाशक फवारणी", ExecutionStatus.Skipped),
            Rec(42, "बुरशीनाशक फवारणी", ExecutionStatus.Delayed),
            Rec(43, "बुरशीनाशक फवारणी", ExecutionStatus.Skipped),
        };

        var line = StageOf(Run([Follow1(schedule)], records, today: 50), 0, Stage2.Name).Activities.Single();

        Assert.Equal(3, line.Asked);
        Assert.Equal(1, line.Done);
        Assert.Equal(2, line.NotYet);
        Assert.Equal(2, line.SaidNotDone); // three said-not-done records, capped at NotYet
    }

    [Fact]
    public void A_not_recognised_record_is_never_own_work()
    {
        var schedule = Schedule(1, Once(1, "ठिबक सिंचन", 40));

        var result = Run([Follow1(schedule)], [Rec(41, "zzqx wvv")], today: 50);

        Assert.Empty(result.OwnWork);
        var item = Assert.Single(result.NotRecognised);
        Assert.Equal(0, item.RecordIndex);
        Assert.Equal(Stage2.Name, item.StageName);
        Assert.Equal(0, StageOf(result, 0, Stage2.Name).Done);
    }

    [Fact]
    public void A_record_matching_a_step_of_schedule_B_but_no_step_of_schedule_A_is_not_own_work()
    {
        var a = Schedule(1, Once(1, "ठिबक सिंचन", 40));
        var b = Schedule(2, Once(1, "घड विरळणी", 40));

        var result = Run([Follow1(a), Follow1(b, 2)], [Rec(41, "घड विरळणी")], today: 50);

        Assert.Empty(result.OwnWork);
        Assert.Equal(1, StageOf(result, 1, Stage2.Name).Done);
        Assert.Equal(0, StageOf(result, 0, Stage2.Name).Done);
    }

    [Fact]
    public void A_recognised_record_no_schedule_asks_is_own_work_with_its_words()
    {
        var schedule = Schedule(1, Once(1, "ठिबक सिंचन", 40));

        var result = Run([Follow1(schedule)], [Rec(41, "वेली बांधणी")], today: 50);

        var own = Assert.Single(result.OwnWork);
        Assert.Equal(0, own.RecordIndex);
        Assert.NotEmpty(own.MatchedWords);
    }

    [Fact]
    public void One_recorded_spray_matches_at_most_one_expected_spray_per_schedule_and_each_schedule_counts_alone()
    {
        var one = Schedule(1, Once(1, "बुरशीनाशक फवारणी", 48));
        var two = Schedule(2, Once(1, "बुरशीनाशक फवारणी", 50));

        var result = Run([Follow1(one), Follow1(two, 2)], [Rec(49, "बुरशीनाशक फवारणी")], today: 52);

        Assert.Equal(1, StageOf(result, 0, Stage2.Name).Done);
        Assert.Equal(1, StageOf(result, 1, Stage2.Name).Done);
    }

    [Fact]
    public void Disputed_work_does_not_count_and_a_note_is_not_work()
    {
        var schedule = Schedule(1, Once(1, "बुरशीनाशक फवारणी", 40));
        var records = new[] { Rec(41, "बुरशीनाशक फवारणी", disputed: true), Rec(42, "Reminder"), Rec(43, "Observation") };

        var result = Run([Follow1(schedule)], records, today: 50);

        Assert.Equal(0, StageOf(result, 0, Stage2.Name).Done);
        Assert.Empty(result.OwnWork);
        Assert.Empty(result.NotRecognised);
    }

    [Fact]
    public void With_only_given_only_that_window_is_counted()
    {
        var schedule = Schedule(1, Once(1, "ठिबक सिंचन", 40));
        var followed = new[] { Follow1(schedule) };
        var windows = ScheduleFollowEngine.StageWindows(schedule, Zero);

        var result = ScheduleFollowEngine.Follow(followed, windows, [Rec(41, "ठिबक सिंचन")], D(50), Stage2);

        var stage = Assert.Single(result.Schedules[0].Stages);
        Assert.Equal(Stage2.Name, stage.Name);
        Assert.Equal(1, stage.Done);
    }

    [Fact]
    public void An_order_note_is_found_even_when_only_asks_for_another_window()
    {
        var schedule = Schedule(1, Once(1, "घड विरळणी", 38), Once(2, "जीए (संजीवक) बुडवणी", 42, after: 1));
        var windows = ScheduleFollowEngine.StageWindows(schedule, Zero);

        var result = ScheduleFollowEngine.Follow([Follow1(schedule)], windows,
            [Rec(44, "जीए (संजीवक) बुडवणी"), Rec(46, "घड विरळणी")], D(50), windows[2]);

        Assert.Single(result.Schedules[0].Order);
    }

    [Fact]
    public void No_output_carries_a_quantity()
    {
        // the output records hold dates, counts and words only: no quantity-like member exists on any of them
        var types = new[]
        {
            typeof(ExpectedStep), typeof(StageActivityPlan), typeof(ActivityCount), typeof(StageCount), typeof(OrderNote),
            typeof(ScheduleFollowResult), typeof(OwnWorkItem), typeof(NotRecognisedItem), typeof(PlotFollowResult),
        };
        var banned = new[] { "quantity", "kg", "litre", "liter", "amount", "dose", "score", "percent" };

        foreach (var member in types.SelectMany(t => t.GetProperties().Select(p => p.Name)))
        {
            Assert.DoesNotContain(banned, b => member.Contains(b, StringComparison.OrdinalIgnoreCase));
        }
    }

    // ---- the founder-approved confirmation page (index-L8R3.html) ------------------------------------

    [Fact]
    public void Worked_plot_of_index_L8R3_gives_its_numbers()
    {
        // Day numbers are the page's; day 0 is Zero. Every activity and record below is the page's Marathi title,
        // read by WorkRecogniser inside Act(); no work key is typed anywhere in this test.
        var s1 = Schedule(1,
            Every(1, "ठिबक सिंचन", 31, 56, 5),                       // 31 36 41 46 51 56
            Every(2, "विद्राव्य खत 0:52:34 (ठिबकातून)", 40, 60, 10),  // 40 50 60
            Every(3, "बुरशीनाशक फवारणी", 34, 55, 7),                  // 34 41 48 55
            Once(4, "जीए (संजीवक) बुडवणी", 42, after: 5),
            Once(5, "घड विरळणी", 38));
        var s2 = Schedule(2,
            Every(1, "बुरशीनाशक फवारणी", 36, 50, 14),                 // 36 50
            Once(2, "कीटकनाशक फवारणी", 46),
            Once(3, "पानांची तपासणी", 37));
        var s3 = Schedule(3, Once(1, "बोरॉन फवारणी", 47));
        var own = Schedule(4, Every(1, "खुरपणी (गवत काढणे)", 35, 55, 10)); // 35 45 55

        var records = new[]
        {
            Rec(31, "ठिबक सिंचन"),
            Rec(35, "खुरपणी केली"),
            Rec(36, "बुरशीनाशक फवारणी"),
            Rec(37, "ठिबक सिंचन"),
            Rec(41, "ठिबक सिंचन"),
            Rec(41, "वेली बांधणी"),
            Rec(42, "विद्राव्य खत 0:52:34 (ठिबकातून)"),
            Rec(42, "बोरॉन फवारणी"),
            Rec(44, "बुरशीनाशक फवारणी"),
            Rec(44, "जीए (संजीवक) बुडवणी"),
            Rec(45, "खुरपणी केली"),
            Rec(46, "घड विरळणी"),
            Rec(46, "कीटकनाशक फवारणी", ExecutionStatus.Partial),
            Rec(47, "ठिबक सिंचन"),
            Rec(49, "बुरशीनाशक फवारणी"),
        };

        var result = Run([Follow1(s1, 1), Follow1(s2, 2), Follow1(s3, 3), Follow1(own, 4)], records, today: 50);

        var a = StageOf(result, 0, Stage2.Name);
        Assert.Equal((15, 10, 5), (a.Asked, a.Done, a.NotYet));
        Assert.Equal(10, a.DaysLeft);
        var order = Assert.Single(result.Schedules[0].Order);
        Assert.Equal(Id(5), order.FirstActivityId); // घड विरळणी
        Assert.Equal(Id(4), order.ThenActivityId);  // जीए (संजीवक) बुडवणी, recorded first
        Assert.Equal(D(46), order.FirstDay);
        Assert.Equal(D(44), order.ThenDay);

        var b = StageOf(result, 1, Stage2.Name);
        Assert.Equal((4, 3, 1), (b.Asked, b.Done, b.NotYet));
        var fungicide = b.Activities.Single(x => x.ActivityId == Id(1));
        Assert.Equal(1, fungicide.MoreThanAsked); // 1 fungicide spray more than asked
        Assert.Equal(1, b.Activities.Sum(x => x.MoreThanAsked));
        Assert.Empty(result.Schedules[1].Order);

        var c = StageOf(result, 2, Stage2.Name);
        Assert.Equal((1, 1, 0), (c.Asked, c.Done, c.NotYet)); // boron, recorded 5 days early

        var o = StageOf(result, 3, Stage2.Name);
        Assert.Equal((3, 2, 1), (o.Asked, o.Done, o.NotYet));

        var item = Assert.Single(result.OwnWork);
        Assert.Equal(5, item.RecordIndex); // वेली बांधणी
        Assert.Empty(result.NotRecognised);
    }
}
