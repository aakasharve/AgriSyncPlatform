namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>A span of dates. <see cref="To"/> is null when no end is stated (the window is open at the end). A window is a window: never read only its first date.</summary>
public sealed record ScheduleWindow(DateOnly From, DateOnly? To);

/// <summary>Where a due date comes from.</summary>
public enum ScheduleDueSource
{
    /// <summary>Nothing is due: there is no date to act on.</summary>
    None = 0,

    /// <summary>A stated day (the day timer): the plan itself.</summary>
    StatedDay = 1,

    /// <summary>Something that actually happened: the work this one follows was recorded, or the sign was seen.</summary>
    Record = 2,
}

/// <summary>
/// What the resolver says about one task: the window it is DUE in (null = nothing is due), the window it is EXPECTED in (null = no expectation), and where the
/// due date comes from. Expected and actual are both kept (the approved spec); a reminder is made from <see cref="Due"/> only.
/// </summary>
public sealed record ScheduleResolution(ScheduleWindow? Due, ScheduleWindow? Expected, ScheduleDueSource DueSource)
{
    /// <summary>True when something is due.</summary>
    public bool HasDate => Due is not null;

    /// <summary>No date and no expectation.</summary>
    public static ScheduleResolution NoDate { get; } = new(null, null, ScheduleDueSource.None);
}

/// <summary>What is recorded for one task: the day its work was actually done, and the day its sign was actually seen. Either may be absent.</summary>
public sealed record ScheduleTaskFacts(DateOnly? ActualDate = null, DateOnly? SignSeenOn = null);

/// <summary>
/// The pure resolver of the three timers. It is a static function of (the timings of one version, the plot's start date, what was recorded): no clock
/// (the Domain has none), no weather (weather never moves a date), no database. The same inputs always give the same answer.
/// <list type="bullet">
/// <item><b>Day</b>: the window is the start date plus the stored days (negative days are before it). Without a start date there is no date.</item>
/// <item><b>After</b>: follows the date the earlier work was RECORDED, never the date it was expected. With no record it is only EXPECTED (from the earlier
/// work's own expectation, if it has one) and nothing is due. A loop of works has no expectation and never hangs.</item>
/// <item><b>Sign</b>: nothing is due until the sign is seen; then it is due the day it was seen. An expected window, if given, is kept as the expectation only.</item>
/// <item><b>None</b>: no date.</item>
/// </list>
/// </summary>
public static class ScheduleTimerResolver
{
    /// <param name="taskKey">The task to resolve.</param>
    /// <param name="timings">The timing of every task of the version, by task key.</param>
    /// <param name="anchor">The date of stored day 0 for this plot (null = not known yet).</param>
    /// <param name="facts">What was recorded for tasks, by task key (null = nothing).</param>
    public static ScheduleResolution Resolve(
        string taskKey,
        IReadOnlyDictionary<string, ScheduleTaskTiming> timings,
        DateOnly? anchor,
        IReadOnlyDictionary<string, ScheduleTaskFacts>? facts = null)
    {
        ArgumentNullException.ThrowIfNull(timings);
        return ResolveCore(taskKey, timings, anchor, facts ?? EmptyFacts, []);
    }

    private static readonly IReadOnlyDictionary<string, ScheduleTaskFacts> EmptyFacts = new Dictionary<string, ScheduleTaskFacts>();

    private static ScheduleResolution ResolveCore(
        string taskKey,
        IReadOnlyDictionary<string, ScheduleTaskTiming> timings,
        DateOnly? anchor,
        IReadOnlyDictionary<string, ScheduleTaskFacts> facts,
        HashSet<string> visiting)
    {
        if (taskKey is null || !timings.TryGetValue(taskKey, out var timing) || timing is null)
        {
            return ScheduleResolution.NoDate;
        }

        switch (timing.Timer)
        {
            case ScheduleTimerKind.Day:
                {
                    var window = DayWindow(anchor, timing.FromDay, timing.ToDay);
                    return window is null
                        ? ScheduleResolution.NoDate
                        : new ScheduleResolution(window, window, ScheduleDueSource.StatedDay);
                }

            case ScheduleTimerKind.Sign:
                {
                    var expected = DayWindow(anchor, timing.ExpectedFromDay, timing.ExpectedToDay);
                    if (facts.TryGetValue(taskKey, out var own) && own?.SignSeenOn is { } seen)
                    {
                        return new ScheduleResolution(new ScheduleWindow(seen, seen), expected, ScheduleDueSource.Record);
                    }

                    return new ScheduleResolution(null, expected, ScheduleDueSource.None);
                }

            case ScheduleTimerKind.After:
                {
                    var predecessor = timing.AfterTaskKey;
                    if (predecessor is null || !visiting.Add(taskKey))
                    {
                        return ScheduleResolution.NoDate;
                    }

                    try
                    {
                        ScheduleWindow? due = null;
                        if (facts.TryGetValue(predecessor, out var recorded) && recorded?.ActualDate is { } actual)
                        {
                            due = Offset(actual, actual, timing);
                        }

                        ScheduleWindow? expected = null;
                        var before = ResolveCore(predecessor, timings, anchor, facts, visiting);
                        if (before.Expected is { } planned)
                        {
                            expected = Offset(planned.From, planned.To ?? planned.From, timing);
                        }

                        return new ScheduleResolution(due, expected, due is null ? ScheduleDueSource.None : ScheduleDueSource.Record);
                    }
                    finally
                    {
                        visiting.Remove(taskKey);
                    }
                }

            default:
                return ScheduleResolution.NoDate;
        }
    }

    private static ScheduleWindow? DayWindow(DateOnly? anchor, int? fromDay, int? toDay)
    {
        if (anchor is not { } start || fromDay is not { } from)
        {
            return null;
        }

        return new ScheduleWindow(start.AddDays(from), toDay is { } to ? start.AddDays(to) : null);
    }

    /// <summary>The window an 'after' makes from the date of the work it follows (<paramref name="from"/> .. <paramref name="to"/> when that work was itself a window).</summary>
    private static ScheduleWindow Offset(DateOnly from, DateOnly to, ScheduleTaskTiming timing)
    {
        var startOffset = timing.EarliestDays ?? timing.UsualDays ?? 0;
        var endOffset = timing.LatestDays ?? timing.UsualDays;
        return new ScheduleWindow(from.AddDays(startOffset), endOffset is { } end ? to.AddDays(end) : null);
    }
}

/// <summary>
/// The one place the server knows the farmer's day numbering (the plan's day rule; the phone's twin is <c>scheduleDates.ts</c>). A schedule day is STORED from
/// 0 (the start day: pruning for grapes) and SHOWN from 1; a day before the start day is stored negative and is never printed as a negative day or as day 0 but
/// as "N days before" (<see cref="DaysBeforeStart"/>). A count of days (every N days, the days between two dates) is not a day number and is never shifted.
/// </summary>
public static class ScheduleDayNumbers
{
    /// <summary>
    /// The grape year counts from the fruit pruning (stored 0); the April foundation pruning day 1 is stored 177, so an April-season day D is stored 176 + D.
    /// (The plan's Global Constraints: this is the sample year's gap, 15 Oct 2026 to 10 Apr 2027, the grape year file's own convention.)
    /// </summary>
    public const int AprilSeasonOffset = 176;

    /// <summary>The stored day for a day a farmer reads or types (shown = stored + 1).</summary>
    public static int StoredFromShown(int shown) => shown - 1;

    /// <summary>The day number a farmer reads for a stored day. For a negative stored day print <see cref="DaysBeforeStart"/> instead.</summary>
    public static int ShownFromStored(int stored) => stored + 1;

    /// <summary>The stored day of an April-season day (April day 1 = stored 177).</summary>
    public static int StoredFromAprilDay(int aprilDay) => AprilSeasonOffset + aprilDay;

    /// <summary>"छाटणीआधी N दिवस": N for a stored day before the start day (stored -N), else null.</summary>
    public static int? DaysBeforeStart(int stored) => stored < 0 ? -stored : null;
}

/// <summary>
/// Safety and pre-harvest gaps never shrink (the plan's Global Constraints). A later version of a task may keep a gap or lengthen it; it may not shorten it,
/// and may not drop a gap that was stated. Weather, a follow-up, a postponement or a farmer's own edit is never a reason to shorten one.
/// </summary>
public static class ScheduleSafetyGaps
{
    /// <summary>Checks one task against the version of the SAME task it replaces. <c>null</c> = no gap was shortened.</summary>
    public static ScheduleTaskProblem? Check(ScheduleTaskContent previous, ScheduleTaskContent next)
    {
        ArgumentNullException.ThrowIfNull(previous);
        ArgumentNullException.ThrowIfNull(next);
        if (!string.Equals(previous.TaskKey, next.TaskKey, StringComparison.Ordinal))
        {
            return new("ScheduleTaskGapKey", $"Gaps are compared for the same task: '{previous.TaskKey}' is not '{next.TaskKey}'.");
        }

        return Shortened(previous.TaskKey, "re-entry gap (hours)", previous.ReEntryHours, next.ReEntryHours)
            ?? Shortened(previous.TaskKey, "pre-harvest gap (days)", previous.PreHarvestDays, next.PreHarvestDays);
    }

    /// <summary>Checks a whole next version against the one before it: every task that is in both keeps its gaps. A task left out has no gap to shrink.</summary>
    public static ScheduleTaskProblem? CheckVersion(IEnumerable<ScheduleTaskContent> previous, IEnumerable<ScheduleTaskContent> next)
    {
        ArgumentNullException.ThrowIfNull(previous);
        ArgumentNullException.ThrowIfNull(next);
        var nextByKey = next.ToDictionary(t => t.TaskKey, StringComparer.Ordinal);
        foreach (var before in previous)
        {
            if (nextByKey.TryGetValue(before.TaskKey, out var after) && Check(before, after) is { } problem)
            {
                return problem;
            }
        }

        return null;
    }

    private static ScheduleTaskProblem? Shortened(string taskKey, string what, int? before, int? after) =>
        before is { } was && (after is null || after < was)
            ? new("ScheduleTaskGapShortened", $"Task '{taskKey}': the {what} was {was} and may not be shortened or dropped (it is {(after is null ? "absent" : after.ToString())}).")
            : null;
}
