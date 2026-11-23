// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
// The pure timer resolver: the three timers (a day window, "after a work", "when seen") and what each one may say about a date. No clock,
// no weather, no database - the anchor day (the plot's stored day 0) and the records that happened are INPUTS. A day window is a window, never
// its first day (the trap in ScheduleFollowEngine.StoredDates); "after" follows what ACTUALLY happened; a sign nobody has seen has no due date.
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleTimerResolverTests
{
    /// <summary>The sample fruit pruning of the grape year file (stored day 0).</summary>
    private static readonly DateOnly Pruning = new(2026, 10, 15);

    private static IReadOnlyDictionary<string, ScheduleTaskTiming> Timings(params (string Key, ScheduleTaskTiming Timing)[] rows) =>
        rows.ToDictionary(r => r.Key, r => r.Timing, StringComparer.Ordinal);

    private static IReadOnlyDictionary<string, ScheduleTaskFacts> Facts(params (string Key, ScheduleTaskFacts Facts)[] rows) =>
        rows.ToDictionary(r => r.Key, r => r.Facts, StringComparer.Ordinal);

    // ---- the day timer ------------------------------------------------------------------------------------------

    [Fact]
    public void Day_Stored0_IsPruningDate()
    {
        var result = ScheduleTimerResolver.Resolve("prune", Timings(("prune", ScheduleTaskTiming.OnDays(0, 0))), Pruning);

        result.HasDate.Should().BeTrue();
        result.Due.Should().Be(new ScheduleWindow(Pruning, Pruning), "stored day 0 is the pruning day itself (shown as day 1)");
        result.Expected.Should().Be(result.Due, "a stated day is both the plan and the expectation");
        result.DueSource.Should().Be(ScheduleDueSource.StatedDay);
    }

    [Fact]
    public void Day_StoredMinus15_Is15DaysBefore()
    {
        var result = ScheduleTimerResolver.Resolve("soil", Timings(("soil", ScheduleTaskTiming.OnDays(-15, -15))), Pruning);

        result.Due!.From.Should().Be(Pruning.AddDays(-15), "a negative stored day is that many days BEFORE the start day, never refused");
        ScheduleDayNumbers.DaysBeforeStart(-15).Should().Be(15, "the farmer reads it as 'छाटणीआधी १५ दिवस', never as a negative day");
        ScheduleDayNumbers.DaysBeforeStart(0).Should().BeNull("the start day itself is day 1, not 'before'");
        ScheduleDayNumbers.DaysBeforeStart(7).Should().BeNull();
    }

    [Fact]
    public void April_Day1_IsStored177()
    {
        // The plan's day rule: the grape year counts from the fruit pruning (stored 0); the April foundation pruning day 1 is stored 177.
        ScheduleDayNumbers.StoredFromAprilDay(1).Should().Be(177);
        ScheduleDayNumbers.StoredFromAprilDay(41).Should().Be(176 + 41);
        ScheduleDayNumbers.StoredFromAprilDay(-2).Should().Be(174, "two days before the April pruning");

        var april = ScheduleTimerResolver.Resolve(
            "found", Timings(("found", ScheduleTaskTiming.OnDays(ScheduleDayNumbers.StoredFromAprilDay(1)))), Pruning);
        april.Due!.From.Should().Be(new DateOnly(2027, 4, 10), "177 days after 15 Oct 2026 is 10 Apr 2027, the file's sample April pruning");
    }

    [Fact]
    public void Shown_and_stored_days_are_one_apart_and_exact_inverses()
    {
        ScheduleDayNumbers.StoredFromShown(1).Should().Be(0);
        ScheduleDayNumbers.ShownFromStored(0).Should().Be(1);
        for (var n = -30; n <= 400; n++)
        {
            ScheduleDayNumbers.StoredFromShown(ScheduleDayNumbers.ShownFromStored(n)).Should().Be(n);
        }
    }

    [Fact]
    public void Day_Window_IsAWindow_NotItsFirstDate()
    {
        var result = ScheduleTimerResolver.Resolve("spray", Timings(("spray", ScheduleTaskTiming.OnDays(3, 7))), Pruning);

        result.Due.Should().Be(new ScheduleWindow(Pruning.AddDays(3), Pruning.AddDays(7)));
        result.Due!.To.Should().NotBe(result.Due.From, "a one-time work with a window is due somewhere in it, not only on its first date");
    }

    [Fact]
    public void Day_OpenEnd_KeepsTheStartAndSaysNothingAboutTheEnd()
    {
        var result = ScheduleTimerResolver.Resolve("mite", Timings(("mite", ScheduleTaskTiming.OnDays(60))), Pruning);

        result.Due.Should().Be(new ScheduleWindow(Pruning.AddDays(60), null));
    }

    [Fact]
    public void Day_WithoutAnAnchor_HasNoDate()
    {
        var result = ScheduleTimerResolver.Resolve("prune", Timings(("prune", ScheduleTaskTiming.OnDays(0, 0))), anchor: null);

        result.HasDate.Should().BeFalse("no start day is known for this plot yet, so no date is invented");
        result.Expected.Should().BeNull();
        result.DueSource.Should().Be(ScheduleDueSource.None);
    }

    [Fact]
    public void None_And_UnknownKey_HaveNoDate()
    {
        ScheduleTimerResolver.Resolve("x", Timings(("x", ScheduleTaskTiming.None("मणी ३–४ मि.मी. झाल्यावर"))), Pruning)
            .HasDate.Should().BeFalse("a dayless task is not given a date");
        ScheduleTimerResolver.Resolve("missing", Timings(), Pruning).HasDate.Should().BeFalse();
    }

    // ---- the after timer ----------------------------------------------------------------------------------------

    [Fact]
    public void After_FollowsActualRecord_NotExpected()
    {
        // The first GA3 spray was PLANNED for stored day 22 but really done on stored day 26; "4 to 5 days after" counts from the real one.
        var timings = Timings(
            ("ga3-first", ScheduleTaskTiming.OnDays(22, 22)),
            ("ga3-second", ScheduleTaskTiming.AfterTask("ga3-first", usualDays: 4, earliestDays: 4, latestDays: 5)));
        var actual = Pruning.AddDays(26);

        var result = ScheduleTimerResolver.Resolve("ga3-second", timings, Pruning, Facts(("ga3-first", new ScheduleTaskFacts(ActualDate: actual))));

        result.Due.Should().Be(new ScheduleWindow(actual.AddDays(4), actual.AddDays(5)), "after follows the date the first work was RECORDED");
        result.DueSource.Should().Be(ScheduleDueSource.Record);
        result.Expected.Should().Be(
            new ScheduleWindow(Pruning.AddDays(22 + 4), Pruning.AddDays(22 + 5)),
            "the expectation is kept beside the actual one (expected and actual are both kept)");
    }

    [Fact]
    public void After_PredecessorUnknown_HasNoDate()
    {
        // Nothing is recorded for the work it follows, and that work has no date of its own (dayless): the follower has none either.
        var timings = Timings(
            ("first", ScheduleTaskTiming.None("फुटवा वाढीनंतर")),
            ("second", ScheduleTaskTiming.AfterTask("first", usualDays: 5)));

        var result = ScheduleTimerResolver.Resolve("second", timings, Pruning, Facts());

        result.HasDate.Should().BeFalse();
        result.Expected.Should().BeNull();
        result.DueSource.Should().Be(ScheduleDueSource.None);
    }

    [Fact]
    public void After_NotYetDone_IsOnlyExpected_NeverDue()
    {
        var timings = Timings(
            ("first", ScheduleTaskTiming.OnDays(10, 10)),
            ("second", ScheduleTaskTiming.AfterTask("first", usualDays: 7)));

        var result = ScheduleTimerResolver.Resolve("second", timings, Pruning, Facts());

        result.Due.Should().BeNull("a date taken from a plan, not from something that happened, is only an expectation");
        result.Expected.Should().Be(new ScheduleWindow(Pruning.AddDays(17), Pruning.AddDays(17)));
        result.DueSource.Should().Be(ScheduleDueSource.None);
    }

    [Fact]
    public void After_KeepsTheWindow_UsualEarliestLatest()
    {
        var timings = Timings(
            ("first", ScheduleTaskTiming.OnDays(0, 0)),
            ("only-earliest", ScheduleTaskTiming.AfterTask("first", earliestDays: 3)),
            ("only-usual", ScheduleTaskTiming.AfterTask("first", usualDays: 5)),
            ("both", ScheduleTaskTiming.AfterTask("first", usualDays: 5, earliestDays: 3, latestDays: 9)));
        var actual = Facts(("first", new ScheduleTaskFacts(ActualDate: Pruning)));

        ScheduleTimerResolver.Resolve("only-earliest", timings, Pruning, actual).Due
            .Should().Be(new ScheduleWindow(Pruning.AddDays(3), null), "an earliest with no latest is open at the end");
        ScheduleTimerResolver.Resolve("only-usual", timings, Pruning, actual).Due
            .Should().Be(new ScheduleWindow(Pruning.AddDays(5), Pruning.AddDays(5)));
        ScheduleTimerResolver.Resolve("both", timings, Pruning, actual).Due
            .Should().Be(new ScheduleWindow(Pruning.AddDays(3), Pruning.AddDays(9)));
    }

    [Fact]
    public void After_ALoopOfWorks_HasNoDate_AndDoesNotHang()
    {
        var timings = Timings(
            ("a", ScheduleTaskTiming.AfterTask("b", usualDays: 1)),
            ("b", ScheduleTaskTiming.AfterTask("a", usualDays: 1)));
        var facts = Facts(("a", new ScheduleTaskFacts(ActualDate: Pruning)), ("b", new ScheduleTaskFacts(ActualDate: Pruning)));

        ScheduleTimerResolver.Resolve("a", timings, Pruning, facts).Expected.Should().BeNull();
        ScheduleTimerResolver.Resolve("a", timings, Pruning, facts).Due.Should().NotBeNull("a record of the work it follows is still a record");
    }

    // ---- the sign timer -----------------------------------------------------------------------------------------

    [Fact]
    public void Sign_Unseen_HasNoDate()
    {
        var timings = Timings(("kooj", ScheduleTaskTiming.WhenSeen("फुलोऱ्याच्या अगदी आधी, पाकळ्या फुगलेल्या दिसल्यावर")));

        var result = ScheduleTimerResolver.Resolve("kooj", timings, Pruning, Facts());

        result.HasDate.Should().BeFalse("a sign nobody has seen gives no date, whatever the calendar says");
        result.Expected.Should().BeNull();
    }

    [Fact]
    public void Sign_Unseen_WithAnExpectedWindow_IsOnlyExpected()
    {
        var timings = Timings(("bloom", ScheduleTaskTiming.WhenSeen("फुलोरा सुरू झाल्यावर", expectedFromDay: 36, expectedToDay: 50)));

        var result = ScheduleTimerResolver.Resolve("bloom", timings, Pruning, Facts());

        result.Due.Should().BeNull("the expected window is a guess to plan around, never a due date");
        result.Expected.Should().Be(new ScheduleWindow(Pruning.AddDays(36), Pruning.AddDays(50)));
    }

    [Fact]
    public void Sign_Seen_IsDueOnTheDayItWasSeen()
    {
        var seen = Pruning.AddDays(41);
        var timings = Timings(("bloom", ScheduleTaskTiming.WhenSeen("फुलोरा सुरू झाल्यावर", expectedFromDay: 36, expectedToDay: 50)));

        var result = ScheduleTimerResolver.Resolve("bloom", timings, Pruning, Facts(("bloom", new ScheduleTaskFacts(SignSeenOn: seen))));

        result.Due.Should().Be(new ScheduleWindow(seen, seen));
        result.DueSource.Should().Be(ScheduleDueSource.Record);
        result.Expected.Should().Be(new ScheduleWindow(Pruning.AddDays(36), Pruning.AddDays(50)), "the expectation stays beside what was seen");
    }

    [Fact]
    public void A_task_after_a_sign_task_follows_the_work_that_was_done_not_the_sighting()
    {
        var seen = Pruning.AddDays(41);
        var done = Pruning.AddDays(43);
        var timings = Timings(
            ("bloom", ScheduleTaskTiming.WhenSeen("फुलोरा सुरू झाल्यावर")),
            ("after-bloom", ScheduleTaskTiming.AfterTask("bloom", usualDays: 10)));

        ScheduleTimerResolver.Resolve("after-bloom", timings, Pruning, Facts()).HasDate.Should().BeFalse();
        ScheduleTimerResolver.Resolve("after-bloom", timings, Pruning, Facts(("bloom", new ScheduleTaskFacts(SignSeenOn: seen)))).Due
            .Should().BeNull("the sign was seen but the work it asks for is not recorded, so what follows that work is not due yet");
        ScheduleTimerResolver.Resolve("after-bloom", timings, Pruning, Facts(("bloom", new ScheduleTaskFacts(ActualDate: done, SignSeenOn: seen)))).Due
            .Should().Be(new ScheduleWindow(done.AddDays(10), done.AddDays(10)));
    }

    // ---- nothing but days and records move a date ---------------------------------------------------------------

    [Fact]
    public void The_resolver_takes_no_weather_and_no_clock()
    {
        // Weather never moves a date and the Domain has no clock: the resolver is a static function of (timings, anchor, facts) only.
        var method = typeof(ScheduleTimerResolver).GetMethod(nameof(ScheduleTimerResolver.Resolve))!;
        method.IsStatic.Should().BeTrue();
        method.GetParameters().Select(p => p.ParameterType).Should().NotContain(typeof(DateTime))
            .And.NotContain(typeof(DateTimeOffset)).And.NotContain(typeof(TimeProvider));
        var again = ScheduleTimerResolver.Resolve("p", Timings(("p", ScheduleTaskTiming.OnDays(5, 6))), Pruning);
        ScheduleTimerResolver.Resolve("p", Timings(("p", ScheduleTaskTiming.OnDays(5, 6))), Pruning).Should().Be(again, "the same inputs always give the same answer");
    }
}
