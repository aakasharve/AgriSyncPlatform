// spec: plr-d10-redesign-real-integration-2026-10-25 - lane POSTPONE-B (founder pick B, round 5, question 4).
//
// What these prove, on the board's source of followed-schedule steps (no database):
//   1. a step's postpone count is its own move rows (history included), per (subscription, activity, original day);
//   2. a postponed step is SHOWN on its moved day but can be read again on the day its schedule asks it (OnOriginalDays), and on that day it
//      is Overdue where the moved reading would not even look at it - which is what keeps the plot's late count honest;
//   3. a schedule nobody moved is returned as it is (the same object), so a plot with no postpone is read exactly as before (P11).
// The handler's own totals (overdue figure, health, rank) and the third-postpone refusal need the real host: see
// AttentionSeveralSchedulesRealPostgresTests (RequiresPostgres, run by the orchestrator).
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PostponeCountAndOriginalDayTests
{
    private static readonly DateOnly DayZero = new(2026, 1, 1);
    private static readonly DateOnly Today = DayZero.AddDays(40);
    private static readonly FarmId Farm = new(Guid.Parse("00000000-0000-0000-0000-00000000f001"));
    private static readonly Guid Plot = Guid.Parse("00000000-0000-0000-0000-00000000a001");
    private static readonly Guid Cycle = Guid.Parse("00000000-0000-0000-0000-00000000c001");
    private static readonly Guid Template = Guid.Parse("00000000-0000-0000-0000-00000000e001");
    private static readonly Guid SprayId = Guid.Parse("00000000-0000-0000-0000-000000000501");
    private static readonly Guid Subscription = Guid.Parse("00000000-0000-0000-0000-00000000b001");
    private static readonly UserId Owner = new(Guid.Parse("00000000-0000-0000-0000-0000000000a1"));

    // A spray every 5 days from day 10 to day 45: days 10, 15, 20, 25, 30, 35, 40 (today), 45.
    private static ScheduleTemplateDto Spray() => new(
        Template, "Sched U", "Grapes", 90,
        [new StageDefinitionDto("A", 0, 90)],
        [new TemplateActivityDto("Spray", "Spraying", "A", 10, 45, "every_n_days", 5, Id: SprayId, Part: "work", StoredFrequencyMode: "EveryNDays")],
        "h",
        HasStoredDays: true);

    private static ScheduleStepMove Move(DateOnly original, DateOnly to, int minute) =>
        ScheduleStepMove.Create(
            Guid.NewGuid(), Farm, Subscription, SprayId, original, to, Owner, new DateTime(2026, 2, 9, 6, minute, 0, DateTimeKind.Utc));

    private static IReadOnlyList<BoardScheduleSteps> StepsWith(params ScheduleStepMove[] moves)
    {
        var subscription = ScheduleSubscription.Adopt(
            Subscription, Farm, Plot, Cycle, "grapes", new ScheduleTemplateId(Template), "v1",
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), DayZero);
        var cycle = CropCycle.Create(Cycle, Farm, Plot, "Grapes", "A", DayZero, null, new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var source = new BoardScheduleSource(
            [subscription],
            new Dictionary<Guid, ScheduleTemplateDto> { [Template] = Spray() },
            moves);
        return source.For(Plot, cycle)!;
    }

    private static BoardStep StepOn(IReadOnlyList<BoardScheduleSteps> schedules, int scheduleDay) =>
        schedules.Single().Steps.Single(s => s.OriginalDate == DayZero.AddDays(scheduleDay));

    [Fact]
    public void A_step_never_postponed_has_count_zero_and_the_schedule_is_returned_as_it_is()
    {
        var schedules = StepsWith();

        Assert.All(schedules.Single().Steps, s => Assert.Equal(0, s.PostponeCount));
        Assert.False(schedules.Single().AnyMoved);
        Assert.Same(schedules.Single(), schedules.Single().OnOriginalDays());
    }

    [Fact]
    public void The_count_is_the_number_of_move_rows_of_that_step_and_of_no_other()
    {
        var day35 = DayZero.AddDays(35);
        var day30 = DayZero.AddDays(30);
        var schedules = StepsWith(
            Move(day35, Today.AddDays(1), 1),   // day 35: postponed twice
            Move(day35, Today.AddDays(2), 2),
            Move(day30, Today.AddDays(7), 3));  // day 30: postponed once

        Assert.Equal(2, StepOn(schedules, 35).PostponeCount);
        Assert.Equal(1, StepOn(schedules, 30).PostponeCount);
        Assert.Equal(0, StepOn(schedules, 25).PostponeCount);
        Assert.Equal(0, StepOn(schedules, 40).PostponeCount);
    }

    [Fact]
    public void A_postponed_step_is_shown_on_the_moved_day_but_its_original_day_stays_and_is_judged_by_it()
    {
        var original = DayZero.AddDays(35);
        var moved = Today.AddDays(2);
        var schedules = StepsWith(Move(original, moved, 1));
        var step = StepOn(schedules, 35);

        Assert.Equal(moved, step.Step.PlannedDate);       // the reminder day: the list keeps it for later
        Assert.Equal(original, step.OriginalDate);        // the day the schedule asked it
        Assert.True(schedules.Single().AnyMoved);

        var judged = schedules.Single().OnOriginalDays();
        Assert.Equal(original, judged.Steps.Single(s => s.OriginalDate == original).Step.PlannedDate);
        Assert.Equal(
            schedules.Single().Steps.Select(s => s.Step.StepId).ToList(),
            judged.Steps.Select(s => s.Step.StepId).ToList());
    }

    [Fact]
    public void On_the_moved_day_the_step_is_not_looked_at_yet_on_its_original_day_it_is_overdue_with_its_true_lateness()
    {
        var original = DayZero.AddDays(35);
        var schedules = StepsWith(Move(original, Today.AddDays(2), 1));
        var stepId = StepOn(schedules, 35).Step.StepId;

        var asReminded = ScheduledWorkMatcher.Match(schedules.Single().Steps.Select(s => s.Step), [], Today);
        var asJudged = ScheduledWorkMatcher.Match(schedules.Single().OnOriginalDays().Steps.Select(s => s.Step), [], Today);

        Assert.DoesNotContain(asReminded, s => s.Step.StepId == stepId);   // snoozed: out of the list
        var late = Assert.Single(asJudged, s => s.Step.StepId == stepId);  // but still counted late for the plot
        Assert.Equal(ScheduledWorkState.Overdue, late.State);
        Assert.Equal(5, late.DaysLate);                                   // 40 - 35: the original lateness, not 0
    }

    [Fact]
    public void Recorded_work_clears_the_step_on_both_readings()
    {
        var original = DayZero.AddDays(35);
        var schedules = StepsWith(Move(original, Today.AddDays(2), 1));
        var stepId = StepOn(schedules, 35).Step.StepId;
        var record = new RecordedWork("Spray", DayZero.AddDays(37)); // two days after its own day: within the on-time window

        var judged = ScheduledWorkMatcher.Match(schedules.Single().OnOriginalDays().Steps.Select(s => s.Step), [record], Today);

        Assert.Equal(ScheduledWorkState.Done, Assert.Single(judged, s => s.Step.StepId == stepId).State);
    }
}
