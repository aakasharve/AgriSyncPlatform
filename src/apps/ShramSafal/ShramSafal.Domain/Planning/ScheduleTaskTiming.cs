namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>Which timer a task holds. A task holds EXACTLY ONE, or none yet (a dayless task is never given a date).</summary>
public enum ScheduleTimerKind
{
    /// <summary>No timer yet: the task has no date and says so (<see cref="ScheduleTaskTiming.WhenWords"/> may still say when, in words).</summary>
    None = 0,

    /// <summary>A day window, in STORED days from the plot's start day (stored 0 = day 1 as the farmer reads it). May be negative: before the start day.</summary>
    Day = 1,

    /// <summary>After another task of the same version: its usual, earliest and latest days after what was RECORDED for that task.</summary>
    After = 2,

    /// <summary>When a sign is seen: the words, and optionally the window the sign is EXPECTED in. Nothing is due until it is seen.</summary>
    Sign = 3,
}

/// <summary>How often a task repeats.</summary>
public enum ScheduleRepeatMode
{
    Once = 0,
    EveryNDays = 1,
    PerWeek = 2,
}

/// <summary>
/// The "when" of a task: one timer, how it repeats, and the timing in the words the source writes it. An immutable value: the factories build
/// the three timers, <see cref="Repeating"/> adds a repeat, and <see cref="Check"/> says whether the parts hold together. The resolver
/// (<see cref="ScheduleTimerResolver"/>) turns it into dates; this type never does and never reads a clock.
/// <para><b>Days are STORED days</b> (the plan's day rule: stored = shown - 1; pruning, shown day 1, is stored 0; "छाटणीआधी N दिवस" is stored
/// -N). A negative day is valid here: the old import refused every one (<c>ScheduleTemplate.Import.cs</c> day checks). Printing goes through
/// <see cref="ScheduleDayNumbers"/>, never through a bare subtraction.</para>
/// </summary>
public sealed record ScheduleTaskTiming
{
    public const int MaxDay = 3650;
    public const int MaxWordsLength = 1000;

    public ScheduleTimerKind Timer { get; init; }

    // ---- Day -------------------------------------------------------------------------------------------------------
    /// <summary>Day timer: the first day of the window (stored; may be negative).</summary>
    public int? FromDay { get; init; }

    /// <summary>Day timer: the last day of the window; null = no end stated (the window is open at the end).</summary>
    public int? ToDay { get; init; }

    // ---- After -----------------------------------------------------------------------------------------------------
    /// <summary>After timer: the <see cref="ScheduleTaskContent.TaskKey"/> of the task of the SAME version this one follows (held by key, so a copy cannot orphan it).</summary>
    public string? AfterTaskKey { get; init; }

    /// <summary>After timer: the usual number of days after the recorded date of that task.</summary>
    public int? UsualDays { get; init; }

    public int? EarliestDays { get; init; }

    public int? LatestDays { get; init; }

    // ---- Sign ------------------------------------------------------------------------------------------------------
    /// <summary>Sign timer: what is to be seen, in words.</summary>
    public string? SignWords { get; init; }

    /// <summary>Sign timer: the window the sign is expected in (stored days; may be negative). An EXPECTATION: it never makes the task due.</summary>
    public int? ExpectedFromDay { get; init; }

    public int? ExpectedToDay { get; init; }

    // ---- All timers --------------------------------------------------------------------------------------------------
    /// <summary>The timing in the source's own words ("फुलोरा (दिवस ३६–५०)"), kept whatever the timer is.</summary>
    public string? WhenWords { get; init; }

    public ScheduleRepeatMode Repeat { get; init; }

    /// <summary>Every N days (1 or more), or times a week (1 to 7); null for a once-only work.</summary>
    public int? RepeatInterval { get; init; }

    /// <summary>A repeating work ends on this stored day, or...</summary>
    public int? RepeatEndDay { get; init; }

    /// <summary>...when this sign is seen (one end, not two); neither = it repeats to the end of its window.</summary>
    public string? RepeatEndSign { get; init; }

    /// <summary>No timer yet.</summary>
    public static ScheduleTaskTiming None(string? whenWords = null) =>
        new() { Timer = ScheduleTimerKind.None, WhenWords = whenWords };

    /// <summary>A day window in stored days (<paramref name="toDay"/> null = no end stated).</summary>
    public static ScheduleTaskTiming OnDays(int fromDay, int? toDay = null, string? whenWords = null) =>
        new() { Timer = ScheduleTimerKind.Day, FromDay = fromDay, ToDay = toDay, WhenWords = whenWords };

    /// <summary>After the task <paramref name="taskKey"/>: its usual, earliest and latest days after what was recorded for it.</summary>
    public static ScheduleTaskTiming AfterTask(
        string taskKey, int? usualDays = null, int? earliestDays = null, int? latestDays = null, string? whenWords = null) =>
        new()
        {
            Timer = ScheduleTimerKind.After,
            AfterTaskKey = taskKey,
            UsualDays = usualDays,
            EarliestDays = earliestDays,
            LatestDays = latestDays,
            WhenWords = whenWords,
        };

    /// <summary>When the sign <paramref name="words"/> is seen, optionally expected between two stored days.</summary>
    public static ScheduleTaskTiming WhenSeen(
        string words, int? expectedFromDay = null, int? expectedToDay = null, string? whenWords = null) =>
        new()
        {
            Timer = ScheduleTimerKind.Sign,
            SignWords = words,
            ExpectedFromDay = expectedFromDay,
            ExpectedToDay = expectedToDay,
            WhenWords = whenWords,
        };

    /// <summary>The same timing, repeating every N days or per week, optionally until a stored day or a sign.</summary>
    public ScheduleTaskTiming Repeating(ScheduleRepeatMode mode, int interval, int? endDay = null, string? endSign = null) =>
        this with { Repeat = mode, RepeatInterval = interval, RepeatEndDay = endDay, RepeatEndSign = endSign };

    /// <summary>Whether the parts hold together: exactly one timer's fields, its own rules, and a repeat that makes sense. <c>null</c> = fine.</summary>
    /// <param name="selfKey">The task's own key (a task cannot follow itself).</param>
    public ScheduleTaskProblem? Check(string selfKey)
    {
        var timer = CheckTimer(selfKey);
        return timer ?? CheckRepeat();
    }

    private static ScheduleTaskProblem TimerProblem(string message) => new("ScheduleTaskTimer", message);

    private static bool InDays(int? day) => day is null or >= -MaxDay and <= MaxDay;

    private ScheduleTaskProblem? CheckTimer(string selfKey)
    {
        if (!Enum.IsDefined(Timer))
        {
            return TimerProblem("The timer is not one of none, day, after, sign.");
        }

        if (WhenWords is { } words && words.Length > MaxWordsLength)
        {
            return new("ScheduleTaskBounds", $"The timing words may be at most {MaxWordsLength} characters.");
        }

        var day = FromDay is not null || ToDay is not null;
        var after = AfterTaskKey is not null || UsualDays is not null || EarliestDays is not null || LatestDays is not null;
        var sign = SignWords is not null || ExpectedFromDay is not null || ExpectedToDay is not null;
        var held = (day ? 1 : 0) + (after ? 1 : 0) + (sign ? 1 : 0);

        switch (Timer)
        {
            case ScheduleTimerKind.None:
                return held == 0 ? null : TimerProblem("A task with no timer yet holds no day, no 'after' and no sign.");

            case ScheduleTimerKind.Day:
                if (after || sign)
                {
                    return TimerProblem("A task holds exactly one timer: a day window cannot also hold an 'after' or a sign.");
                }

                if (FromDay is null || !InDays(FromDay) || !InDays(ToDay))
                {
                    return TimerProblem($"A day window needs a first day within {MaxDay} days either way.");
                }

                return ToDay is { } to && to < FromDay
                    ? TimerProblem($"The window ends ({to}) before it starts ({FromDay}).")
                    : null;

            case ScheduleTimerKind.After:
                if (day || sign)
                {
                    return TimerProblem("A task holds exactly one timer: an 'after' cannot also hold a day window or a sign.");
                }

                if (!ScheduleTaskContent.IsValidKey(AfterTaskKey))
                {
                    return TimerProblem("An 'after' names the key of the task it follows.");
                }

                if (string.Equals(AfterTaskKey, selfKey, StringComparison.Ordinal))
                {
                    return TimerProblem("A task cannot follow itself.");
                }

                if (!Within0(UsualDays) || !Within0(EarliestDays) || !Within0(LatestDays))
                {
                    return TimerProblem($"The days after a task are 0 to {MaxDay}: a work that follows another is never before it.");
                }

                if (EarliestDays is { } e && LatestDays is { } l && e > l)
                {
                    return TimerProblem($"The earliest day ({e}) is after the latest ({l}).");
                }

                if (UsualDays is { } u && ((EarliestDays is { } e2 && u < e2) || (LatestDays is { } l2 && u > l2)))
                {
                    return TimerProblem("The usual day lies between the earliest and the latest.");
                }

                return null;

            default: // Sign
                if (day || after)
                {
                    return TimerProblem("A task holds exactly one timer: a sign cannot also hold a day window or an 'after'.");
                }

                if (string.IsNullOrWhiteSpace(SignWords) || SignWords.Length > MaxWordsLength)
                {
                    return TimerProblem($"A sign needs its words (1 to {MaxWordsLength} characters).");
                }

                if (!InDays(ExpectedFromDay) || !InDays(ExpectedToDay))
                {
                    return TimerProblem($"The expected window stays within {MaxDay} days either way.");
                }

                if (ExpectedToDay is not null && ExpectedFromDay is null)
                {
                    return TimerProblem("An expected end needs an expected start.");
                }

                return ExpectedToDay is { } et && ExpectedFromDay is { } ef && et < ef
                    ? TimerProblem($"The expected window ends ({et}) before it starts ({ef}).")
                    : null;
        }
    }

    private static bool Within0(int? days) => days is null or >= 0 and <= MaxDay;

    private ScheduleTaskProblem? CheckRepeat()
    {
        static ScheduleTaskProblem RepeatProblem(string message) => new("ScheduleTaskRepeat", message);

        if (!Enum.IsDefined(Repeat))
        {
            return RepeatProblem("The repeat is not one of once, every N days, per week.");
        }

        if (Repeat == ScheduleRepeatMode.Once)
        {
            return RepeatInterval is not null || RepeatEndDay is not null || RepeatEndSign is not null
                ? RepeatProblem("A once-only work has no interval and no end of its repeat.")
                : null;
        }

        var intervalOk = Repeat == ScheduleRepeatMode.PerWeek
            ? RepeatInterval is >= 1 and <= 7
            : RepeatInterval is >= 1 and <= MaxDay;
        if (!intervalOk)
        {
            return RepeatProblem("A repeat needs its number: every N days (1 or more), or times a week (1 to 7).");
        }

        if (RepeatEndDay is not null && RepeatEndSign is not null)
        {
            return RepeatProblem("A repeat ends on a day or on a sign: one end, not two.");
        }

        if (!InDays(RepeatEndDay))
        {
            return RepeatProblem($"The end of the repeat stays within {MaxDay} days either way.");
        }

        return RepeatEndSign is { } s && (string.IsNullOrWhiteSpace(s) || s.Length > MaxWordsLength)
            ? RepeatProblem($"The end sign is words (1 to {MaxWordsLength} characters).")
            : null;
    }
}
