// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "नोंद and तुलना close the loop"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

/// <summary>
/// A plan completed with a saved record counts against exactly that schedule work: the explicit plan-to-log link first, words only for the rest.
/// "Taken" is never "done", no record is never "not done", one record never counts twice, a work with no day counts under its stage or "stage unknown",
/// and a "when seen" work in a stage that ends on a sign is counted once its sign is seen, never before (P4).
/// </summary>
public sealed class ScheduleLoopCountTests
{
    private static readonly DateOnly Zero = new(2026, 1, 1);
    private static DateOnly D(int day) => Zero.AddDays(day);
    private static Guid Id(int n) => new(n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6);

    private static readonly StageDefinition[] Stages = [new("आधी", 0, 30), new("फुलोरा", 31, 60), new("नंतर", 61, 90)];

    private static ScheduleDefinition Schedule(params ScheduleActivityDef[] activities) => new(Id(900), "माझे", Stages, activities);

    private static ScheduleActivityDef OnceKeyed(int n, string title, string part, int day, string key) =>
        new(Id(n), title, part, null, null, null, day, day, FrequencyMode.OneTime, 1, null, key);

    private static PlotFollowResult Run(ScheduleDefinition schedule, IReadOnlyList<RecordedWork> records, int today) =>
        ScheduleFollowEngine.Follow([new FollowedSchedule(1, schedule, Zero)], ScheduleFollowEngine.StageWindows(schedule, Zero), records, D(today), null);

    private static ActivityCount Line(PlotFollowResult r, int stage, int activity) =>
        r.Schedules[0].Stages[stage].Activities.Single(a => a.ActivityId == Id(activity));

    private static ScheduleTaskContent Task(string key, string name, ScheduleTaskKind kind, ScheduleTaskTiming timing, int stage = 0) =>
        new(key, name, kind, timing, ScheduleBasis.Experience, stage);

    // ---- the link ----------------------------------------------------------------------------------------------------

    [Fact]
    public void LinkedLog_CountsForItsTask_EvenWithDifferentWords()
    {
        // His work "वेली बांधणी" (tying) on day 10; the plan was completed with a record that says only "मजूर आले" (words nobody reads as tying).
        var schedule = Schedule(OnceKeyed(1, "वेली बांधणी", "work", 10, "tie"));
        var linked = new RecordedWork("मजूर आले", D(11), ForTaskKey: "tie");

        var result = Run(schedule, [linked], today: 20);

        Line(result, 0, 1).Done.Should().Be(1, "the record the plan was completed with counts for exactly that work, whatever its words");
        result.Schedules[0].Stages[0].Done.Should().Be(1);
        result.OwnWork.Should().BeEmpty("a record of a work of his schedule is never 'own work'");
        result.NotRecognised.Should().BeEmpty("nor 'not recognised'");

        // The same record without the link: words decide, and those words are no tying.
        Line(Run(schedule, [linked with { ForTaskKey = null }], today: 20), 0, 1).Done.Should().Be(0);
    }

    [Fact]
    public void LinkedLog_CountsInTheStageOfItsWork_NotTheStageOfItsDay()
    {
        // The work sits on day 35 (stage 2); its record was made on day 29 (stage 1) and linked: it counts once, on its work's line.
        var schedule = Schedule(OnceKeyed(1, "पहिली फवारणी", "spray", 35, "s1"));
        var result = Run(schedule, [new RecordedWork("फवारणी", D(29), ForTaskKey: "s1")], today: 40);

        Line(result, 1, 1).Done.Should().Be(1);
        result.Schedules[0].Stages[0].Activities.Should().BeEmpty();
        result.Schedules[0].Stages.Sum(s => s.Done ?? 0).Should().Be(1, "never in two stages");
    }

    [Fact]
    public void CompleteWithoutLog_IsNotDone()
    {
        var item = Id(70);
        var plan = PlannedWork.CreateFromSchedule(
            Id(71), new FarmId(Id(72)), "वेली बांधणी", Id(73), null, null, item, "tie", 1,
            new ScheduleResolution(new ScheduleWindow(D(10), D(10)), new ScheduleWindow(D(10), D(10)), ScheduleDueSource.StatedDay),
            null, D(5), Id(74), DateTime.UtcNow);
        plan.Complete(Id(74), [Id(73)], new Dictionary<Guid, IReadOnlyList<Guid>>(), [], false, DateTime.UtcNow);
        plan.Status.Should().Be(PlannedWorkStatus.Done, "the plan was marked done");

        // A record of other work on the same day exists, but the plan names none.
        var log = DailyLog.Create(Id(80), new FarmId(Id(72)), Id(73), Id(75), new UserId(Id(74)), D(10), null, null, DateTime.UtcNow);
        var other = log.AddTask(Id(81), "खुरपणी", null, DateTime.UtcNow);

        var links = ScheduleTaskLines.Links([plan], [other], new Dictionary<Guid, DateOnly> { [log.Id] = D(10) });
        links.Should().BeEmpty("a plan marked done with no record links nothing");

        var result = Run(Schedule(OnceKeyed(1, "वेली बांधणी", "work", 10, "tie")), [new RecordedWork(other.ActivityType, D(10))], today: 20);
        var line = Line(result, 0, 1);
        line.Done.Should().Be(0, "a plan marked done without a record is not a record: not done");
        line.NotYet.Should().Be(1);
        line.SaidNotDone.Should().Be(0, "and no record is never 'not done' either");
    }

    [Fact]
    public void OneLog_NeverCountsTwice()
    {
        // Two spray works in the same stage; one record "फवारणी" linked to the first. Words alone would also fit the second: it must not.
        var schedule = Schedule(OnceKeyed(1, "फवारणी", "spray", 10, "a"), OnceKeyed(2, "फवारणी", "spray", 12, "b"));
        var result = Run(schedule, [new RecordedWork("फवारणी", D(11), ForTaskKey: "a")], today: 20);

        Line(result, 0, 1).Done.Should().Be(1);
        Line(result, 0, 2).Done.Should().Be(0, "a linked record is its work's only, never another's by its words");
        result.Schedules[0].Stages[0].Done.Should().Be(1);

        // One log with one task, linked by the plans of BOTH works: it counts for one of them only.
        var farm = new FarmId(Id(72));
        var log = DailyLog.Create(Id(80), farm, Id(73), Id(75), new UserId(Id(74)), D(11), null, null, DateTime.UtcNow);
        var task = log.AddTask(Id(81), "फवारणी", null, DateTime.UtcNow);
        var plans = new[] { "a", "b" }.Select((key, i) =>
        {
            var p = PlannedWork.CreateFromSchedule(
                Id(90 + i), farm, "फवारणी", Id(73), null, null, Id(95 + i), key, 1,
                new ScheduleResolution(new ScheduleWindow(D(10), D(10)), null, ScheduleDueSource.StatedDay), null, D(5), Id(74), DateTime.UtcNow);
            p.Complete(Id(74), [Id(73)], new Dictionary<Guid, IReadOnlyList<Guid>>(), [log.Id], false, DateTime.UtcNow);
            return p;
        }).ToList();

        var links = ScheduleTaskLines.Links(plans, [task], new Dictionary<Guid, DateOnly> { [log.Id] = D(11) });
        links.Should().ContainSingle().Which.Value.Should().Be("a", "one recorded task is linked to one work only");
    }

    // ---- works with no day -------------------------------------------------------------------------------------------

    [Fact]
    public void DaylessTask_IsCountedUnderItsStageOrStageUnknown()
    {
        // A schedule of only "after" and "sign" works: after a work never recorded (stage 2), a sign never seen with no expectation (stage left open).
        var tasks = new[]
        {
            new ScheduleTaskSource(Id(1), Task("first", "पाणी", ScheduleTaskKind.Irrigation, new ScheduleTaskTiming { Timer = ScheduleTimerKind.Sign, SignWords = "माती कोरडी" }, stage: 0)),
            new ScheduleTaskSource(Id(2), Task("tie", "वेली बांधणी", ScheduleTaskKind.Work, new ScheduleTaskTiming { Timer = ScheduleTimerKind.After, AfterTaskKey = "first", UsualDays = 4 }, stage: 1)),
            new ScheduleTaskSource(Id(3), Task("look", "फुटवा पाहणी", ScheduleTaskKind.Observe, new ScheduleTaskTiming { Timer = ScheduleTimerKind.None })),
        };

        var lines = ScheduleTaskLines.Lines(tasks, new HashSet<string>(), Stages, Zero, new Dictionary<string, ScheduleTaskFacts>(), stageZeroMayBeOpen: true);

        lines.Should().HaveCount(2, "a look is not a work: no line");
        var tie = lines.Single(l => l.TaskKey == "tie");
        tie.EndDay.Should().BeNull("no date is known yet: words only, no number asked");
        tie.StartDay.Should().Be(31, "under its own stage");
        tie.StageUnknown.Should().BeFalse();
        var water = lines.Single(l => l.TaskKey == "first");
        water.StageUnknown.Should().BeTrue("stage 0 of an own work may be a stage left open: never read as the first stage");

        // Counted: the stage holds the work as words (no number), the stage-unknown work counts only its linked record.
        var result = Run(Schedule([.. lines]), [new RecordedWork("पाणी दिले", D(33), ForTaskKey: "first"), new RecordedWork("वेली बांधल्या", D(40))], today: 45);
        var stage2 = result.Schedules[0].Stages[1];
        stage2.Asked.Should().BeNull("a schedule of only 'after' and 'sign' works still gives a row, with no number it cannot explain (P4)");
        stage2.Activities.Should().ContainSingle(a => a.ActivityId == Id(2)).Which.Asked.Should().BeNull();
        var unknown = result.Schedules[0].StageUnknown;
        unknown.Should().NotBeNull();
        unknown!.Activities.Should().ContainSingle().Which.Done.Should().Be(1, "its linked record counts for it");
        unknown.Asked.Should().BeNull();
        result.OwnWork.Should().NotContain(o => o.RecordIndex == 0, "a linked record is never 'own work'");

        // Once the work it follows is recorded (day 33), the follower has a date: one day asked, in the stage that holds it.
        var dated = ScheduleTaskLines.Lines(
            tasks, new HashSet<string>(), Stages, Zero, new Dictionary<string, ScheduleTaskFacts> { ["first"] = new(D(33)) }, stageZeroMayBeOpen: true);
        var tieDated = dated.Single(l => l.TaskKey == "tie");
        tieDated.StartDay.Should().Be(37);
        tieDated.FrequencyMode.Should().Be(FrequencyMode.OneTime);
    }

    [Fact]
    public void SignEndedStage_IsCountedOnceSeen()
    {
        // Stage 1 ends on a sign: expected end day 10, the next stage starts on day 20. Today is day 15: the stage is held open.
        var main = new ScheduleDefinition(Id(900), "माझे", [new("फुटवा", 0, 10), new("वाढ", 20, 40)], [], [true, false]);
        var held = ScheduleDefinitionMapper.StageHolding(main, Zero, D(15));
        held.Should().NotBeNull();
        held!.Value.Window.To.Should().Be(D(15), "a stage that ends on a sign stays open until its sign");
        var windows = new[] { held.Value.Window, new StageWindow("वाढ", D(20), D(40)) };

        var spray = new ScheduleTaskSource(Id(1), Task("downy", "डाऊनी फवारणी", ScheduleTaskKind.Spray,
            new ScheduleTaskTiming { Timer = ScheduleTimerKind.Sign, SignWords = "डाऊनी दिसला" }, stage: 1));
        ScheduleDefinition Def(IReadOnlyDictionary<string, ScheduleTaskFacts> facts) =>
            main with { Activities = ScheduleTaskLines.Lines([spray], new HashSet<string>(), main.Stages, Zero, facts, stageZeroMayBeOpen: false) };
        PlotFollowResult Count(ScheduleDefinition def, params RecordedWork[] records) =>
            ScheduleFollowEngine.Follow([new FollowedSchedule(0, def, Zero)], windows, records, D(15), null);

        // Not seen: no date, no number asked (an unseen sign is never "not done").
        var unseen = Count(Def(new Dictionary<string, ScheduleTaskFacts>()));
        unseen.Schedules[0].Stages[0].Asked.Should().BeNull();
        unseen.Schedules[0].Stages[0].NotYet.Should().BeNull();

        // Seen on day 13 (past the stage's expected end, inside the held window): asked once in that stage.
        var seen = Def(new Dictionary<string, ScheduleTaskFacts> { ["downy"] = new(SignSeenOn: D(13)) });
        var before = Count(seen);
        before.Schedules[0].Stages[0].Asked.Should().Be(1);
        before.Schedules[0].Stages[0].NotYet.Should().Be(1);

        var after = Count(seen, new RecordedWork("फवारणी", D(14), ForTaskKey: "downy"));
        after.Schedules[0].Stages[0].Done.Should().Be(1);
        after.Schedules[0].Stages[0].NotYet.Should().Be(0);
    }

    // ---- लक्ष द्या ---------------------------------------------------------------------------------------------------

    [Fact]
    public void LinkedLog_ClearsItsOwnStep_OnTheAttentionBoard_AndNoOther()
    {
        ScheduledStep Step(int n, string title, int day, string? key) =>
            new(Id(n), title, D(day), "work", null, null, null, true, D(0), D(30), key);
        var steps = new[] { Step(1, "वेली बांधणी", 10, "tie"), Step(2, "खुरपणी", 10, null) };

        // Words that name the OTHER step's work, linked to the first: the first is done, the second stays open.
        var statuses = ScheduledWorkMatcher.Match(steps, [new RecordedWork("खुरपणी", D(10), ForTaskKey: "tie")], D(12));

        statuses.Single(s => s.Step.StepId == Id(1)).State.Should().Be(ScheduledWorkState.Done);
        statuses.Single(s => s.Step.StepId == Id(2)).State.Should().Be(ScheduledWorkState.Overdue, "a record linked to another work never clears this one by its words");
    }
}
