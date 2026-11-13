// spec: plr-d10-redesign-real-integration-2026-10-25 (lane ATT-W; R29, R35, D-100 note read with D-86, D-104e)
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

/// <summary>
/// लक्ष द्या's matcher over the steps a FOLLOWED schedule stores (<see cref="ScheduledWorkMatcher.Match(IEnumerable{ScheduledStep}, IEnumerable{RecordedWork}, DateOnly)"/>),
/// Domain only. The steps are the engine's own <c>Expand</c> dates (never typed by hand), so these tests also pin that the board and the
/// stage panel / तुलना have ONE "expected". R35: a once-only step open after the two day-rule passes takes an unused same-work record
/// inside its own stage, before or after its day; a repeated step keeps the three-day rule; the planned-activity overload is untouched.
/// </summary>
public sealed class ScheduledWorkMatcherStepTests
{
    private static readonly DateOnly Zero = new(2026, 1, 1);
    private static DateOnly D(int day) => Zero.AddDays(day);
    private static Guid Id(int n) => new(n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);

    private static ScheduleActivityDef Act(int n, string title, int start, int? end, FrequencyMode? mode, int? interval = null)
    {
        var recognised = WorkRecogniser.Recognise(title);
        return new ScheduleActivityDef(
            Id(n), title, recognised?.Part.ToString().ToLowerInvariant() ?? "work", null, null, null, start, end, mode, interval, null);
    }

    private static ScheduleActivityDef Once(int n, string title, int day) => Act(n, title, day, day, FrequencyMode.OneTime);

    private static ScheduleActivityDef Every(int n, string title, int start, int end, int every) =>
        Act(n, title, start, end, FrequencyMode.EveryNDays, every);

    private static ScheduleDefinition Schedule(params ScheduleActivityDef[] activities) =>
        new(Id(1000), "schedule",
            [new StageDefinition("आधी", 0, 30), new StageDefinition("फुलोरा ते फळधारणा", 31, 60), new StageDefinition("नंतर", 61, 90)],
            activities);

    /// <summary>The steps exactly as the attention board builds them: the engine's <c>Expand</c>, each with the stage window holding its own day.</summary>
    private static List<ScheduledStep> Steps(ScheduleDefinition schedule, Func<ExpectedStep, DateOnly>? shown = null)
    {
        var windows = ScheduleFollowEngine.StageWindows(schedule, Zero);
        return ScheduleFollowEngine.Expand(schedule, Zero)
            .Select(e =>
            {
                var window = windows.FirstOrDefault(w => e.Date >= w.From && e.Date <= w.To);
                return new ScheduledStep(
                    ScheduledStepIds.ForStep(Id(1000), e.ActivityId, e.Date), e.Title, shown?.Invoke(e) ?? e.Date, e.Part, e.OperationKey,
                    e.Role, e.NutrientKey, e.OnceOnly, window?.From, window?.To);
            })
            .ToList();
    }

    private static RecordedWork Rec(int day, string title, ExecutionStatus status = ExecutionStatus.Completed, bool disputed = false) =>
        new(title, D(day), status, disputed);

    private static ScheduledStepStatus Only(IReadOnlyList<ScheduledStepStatus> result) => Assert.Single(result);

    // ---- R35: the once-only pass ----------------------------------------------------------------------

    [Fact]
    public void A_once_only_step_is_cleared_by_an_earlier_record_in_its_stage()
    {
        // The confirmation page's boron case: scheduled on day 47, recorded on day 42, same stage (31-60).
        var steps = Steps(Schedule(Once(1, "बोरॉन फवारणी", 47)));

        var result = ScheduledWorkMatcher.Match(steps, [Rec(42, "बोरॉन फवारणी")], D(50));

        Assert.Equal(ScheduledWorkState.Done, Only(result).State);
    }

    [Fact]
    public void A_once_only_step_is_not_cleared_by_a_record_in_another_stage()
    {
        var steps = Steps(Schedule(Once(1, "बोरॉन फवारणी", 47)));

        var result = ScheduledWorkMatcher.Match(steps, [Rec(25, "बोरॉन फवारणी")], D(50));

        var status = Only(result);
        Assert.Equal(ScheduledWorkState.Overdue, status.State);
        Assert.Equal(3, status.DaysLate);
    }

    [Fact]
    public void A_repeated_step_keeps_the_three_day_rule()
    {
        // One spray day (49), repeated by kind (EveryNDays), a record five days EARLY: not on time, not late, not once-only.
        var steps = Steps(Schedule(Every(1, "बुरशीनाशक फवारणी", 49, 50, 5)));
        Assert.False(Assert.Single(steps).OnceOnly);

        var tooEarly = ScheduledWorkMatcher.Match(steps, [Rec(44, "बुरशीनाशक फवारणी")], D(50));
        var onTime = ScheduledWorkMatcher.Match(steps, [Rec(46, "बुरशीनाशक फवारणी")], D(50));

        Assert.Equal(ScheduledWorkState.Overdue, Only(tooEarly).State);
        Assert.Equal(ScheduledWorkState.Done, Only(onTime).State);
    }

    [Fact]
    public void The_once_only_pass_runs_after_passes_1_and_2_and_never_takes_a_record_an_on_time_step_needs()
    {
        // A once-only fungicide spray on day 40 and a repeated one on day 45, ONE record on day 45. The on-time pass gives the record to the
        // day-45 step; the once-only step (earlier in the list) must NOT take it first.
        var steps = Steps(Schedule(Once(1, "बुरशीनाशक फवारणी", 40), Every(2, "बुरशीनाशक फवारणी", 45, 46, 5)));
        Assert.Equal(2, steps.Count);

        var result = ScheduledWorkMatcher.Match(steps, [Rec(45, "बुरशीनाशक फवारणी")], D(50));

        Assert.Equal(ScheduledWorkState.Overdue, result.Single(s => s.Step.OnceOnly).State);
        Assert.Equal(ScheduledWorkState.Done, result.Single(s => !s.Step.OnceOnly).State);
    }

    [Fact]
    public void A_once_only_pass_matches_by_role_never_by_name_alone()
    {
        // (1) Same part (a spray) but another ROLE: a record of an insecticide spray never clears the once-only boron spray.
        var boron = Steps(Schedule(Once(1, "बोरॉन फवारणी", 47)));
        var otherRole = ScheduledWorkMatcher.Match(boron, [Rec(42, "कीटकनाशक फवारणी")], D(50));
        Assert.Equal(ScheduledWorkState.Overdue, Only(otherRole).State);

        // (2) Words nobody can read, said the same way: the old name rule alone never clears a step from a record made days EARLY.
        var staking = Steps(Schedule(Once(2, "Zzqq vvxx", 47)));
        var nameAlone = ScheduledWorkMatcher.Match(staking, [Rec(42, "Zzqq vvxx")], D(50));
        Assert.Equal(ScheduledWorkState.Overdue, Only(nameAlone).State);
    }

    [Fact]
    public void A_once_only_step_cleared_early_is_not_cleared_twice()
    {
        // Two once-only boron steps in one stage (days 40 and 47) and ONE record on day 42: it clears one step, never both.
        var steps = Steps(Schedule(Once(1, "बोरॉन फवारणी", 40), Once(2, "बोरॉन फवारणी", 47)));

        var result = ScheduledWorkMatcher.Match(steps, [Rec(42, "बोरॉन फवारणी")], D(50));

        Assert.Equal(1, result.Count(s => s.State == ScheduledWorkState.Done));
        Assert.Equal(1, result.Count(s => s.State == ScheduledWorkState.Overdue));
    }

    [Fact]
    public void A_row_without_stored_frequency_is_never_once_only()
    {
        // An activity that stores no repeat has no days: it expands to nothing (so it is never a step and never once-only); a stored
        // OneTime is once-only and a stored EveryNDays is not.
        var schedule = Schedule(
            Act(1, "फवारणी", 40, null, null),
            Once(2, "बोरॉन फवारणी", 47),
            Every(3, "बुरशीनाशक फवारणी", 34, 59, 5));

        var expanded = ScheduleFollowEngine.Expand(schedule, Zero);

        Assert.DoesNotContain(expanded, e => e.ActivityId == Id(1));
        Assert.True(expanded.Single(e => e.ActivityId == Id(2)).OnceOnly);
        Assert.All(expanded.Where(e => e.ActivityId == Id(3)), e => Assert.False(e.OnceOnly));
    }

    // ---- the day rule, a moved step, the planned-activity overload --------------------------------------

    [Fact]
    public void A_moved_step_is_matched_and_reminded_on_its_moved_day()
    {
        // The schedule asks the step on day 47; the farmer moved the reminder to day 52.
        var steps = Steps(Schedule(Every(1, "बुरशीनाशक फवारणी", 47, 48, 5)), e => e.Date.AddDays(5));

        Assert.Empty(ScheduledWorkMatcher.Match(steps, [], D(50))); // day 52 has not come: neither late nor able to claim a record
        var due = Only(ScheduledWorkMatcher.Match(steps, [], D(52)));
        Assert.Equal(ScheduledWorkState.DueToday, due.State);
        // the id never moves: it is a function of the ORIGINAL day
        Assert.Equal(
            ScheduledStepIds.ForStep(Id(1000), Id(1), D(47)),
            due.Step.StepId);
        var cleared = ScheduledWorkMatcher.Match(steps, [Rec(52, "बुरशीनाशक फवारणी")], D(52));
        Assert.Equal(ScheduledWorkState.Done, Only(cleared).State);
    }

    [Fact]
    public void The_PlannedActivity_overload_of_Match_is_unchanged()
    {
        // The old rule, byte for byte: a once-only boron row has no stage window, so a record five days EARLY is not on time and not late.
        var cycle = Guid.NewGuid();
        var created = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var planned = PlannedActivity.CreateLocallyAdded(
            Guid.NewGuid(), cycle, "बोरॉन फवारणी", "Fruiting", D(47), new UserId(Guid.NewGuid()), "test", created);

        var early = ScheduledWorkMatcher.Match([planned], [Rec(42, "बोरॉन फवारणी")], D(50));
        var onTime = ScheduledWorkMatcher.Match([planned], [Rec(46, "बोरॉन फवारणी")], D(50));

        Assert.Equal(ScheduledWorkState.Overdue, Assert.Single(early).State);
        Assert.Equal(ScheduledWorkState.Done, Assert.Single(onTime).State);
    }

    [Fact]
    public void The_board_matcher_and_the_engine_agree_on_the_boron_case()
    {
        // Review Focus 11: लक्ष द्या must never remind work तुलना already counts.
        var schedule = Schedule(Once(1, "बोरॉन फवारणी", 47));
        var records = new[] { Rec(42, "बोरॉन फवारणी") };

        var follow = ScheduleFollowEngine.Follow(
            [new FollowedSchedule(1, schedule, Zero)], ScheduleFollowEngine.StageWindows(schedule, Zero), records, D(50), null);
        var counted = follow.Schedules[0].Stages.Single(s => s.Name == "फुलोरा ते फळधारणा");
        var matched = ScheduledWorkMatcher.Match(Steps(schedule), records, D(50));

        Assert.Equal(1, counted.Done);
        Assert.Equal(ScheduledWorkState.Done, Only(matched).State);
    }

    // ---- proof: the last real record of the same kind (P4) ---------------------------------------------

    [Fact]
    public void LastSameWorkDate_is_the_real_last_record_of_that_kind()
    {
        var spray = Steps(Schedule(Every(1, "फवारणी", 34, 59, 5))).First();

        // "औषध मारलं" is a spray (WORK-ID); the later record of the same kind is the answer; another kind of work is not.
        var last = ScheduledWorkMatcher.LastSameWorkDate(
            spray, [Rec(30, "औषध मारलं"), Rec(38, "औषध मारलं"), Rec(40, "ठिबक सिंचन")], D(45));

        Assert.Equal(D(38), last);
    }

    [Fact]
    public void LastSameWorkDate_is_null_when_there_is_none()
    {
        var spray = Steps(Schedule(Every(1, "फवारणी", 34, 59, 5))).First();

        Assert.Null(ScheduledWorkMatcher.LastSameWorkDate(spray, [], D(45)));
        Assert.Null(ScheduledWorkMatcher.LastSameWorkDate(spray, [Rec(40, "ठिबक सिंचन")], D(45)));
    }

    [Fact]
    public void LastSameWorkDate_never_counts_a_skipped_disputed_future_or_note_record()
    {
        var spray = Steps(Schedule(Every(1, "फवारणी", 34, 59, 5))).First();

        var last = ScheduledWorkMatcher.LastSameWorkDate(
            spray,
            [
                Rec(36, "फवारणी"),
                Rec(37, "फवारणी", ExecutionStatus.Skipped),
                Rec(38, "फवारणी", disputed: true),
                Rec(46, "फवारणी"),            // after today
                Rec(39, "Reminder"),
            ],
            D(45));

        Assert.Equal(D(36), last);
    }

    [Fact]
    public void A_step_id_is_the_same_every_time_and_differs_by_original_day_activity_and_subscription()
    {
        var a = ScheduledStepIds.ForStep(Id(1), Id(2), D(10));

        Assert.Equal(a, ScheduledStepIds.ForStep(Id(1), Id(2), D(10)));
        Assert.NotEqual(a, ScheduledStepIds.ForStep(Id(1), Id(2), D(11)));
        Assert.NotEqual(a, ScheduledStepIds.ForStep(Id(1), Id(3), D(10)));
        Assert.NotEqual(a, ScheduledStepIds.ForStep(Id(9), Id(2), D(10)));
    }
}
