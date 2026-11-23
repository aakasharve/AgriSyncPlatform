using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>What a person said about the sign of one "when seen" work: it is seen, not yet, or he is not sure. Travels as <c>seen</c>, <c>not_yet</c>, <c>unsure</c>.</summary>
public enum ScheduleSignAnswer
{
    Seen = 0,
    NotYet = 1,
    Unsure = 2,
}

/// <summary>The wire words of <see cref="ScheduleSignAnswer"/> (lower case with an underscore; never a number).</summary>
public static class ScheduleSignAnswers
{
    public static string ToWire(ScheduleSignAnswer answer) => answer switch
    {
        ScheduleSignAnswer.Seen => "seen",
        ScheduleSignAnswer.NotYet => "not_yet",
        _ => "unsure",
    };

    public static bool TryParse(string? word, out ScheduleSignAnswer answer)
    {
        switch (word)
        {
            case "seen":
                answer = ScheduleSignAnswer.Seen;
                return true;
            case "not_yet":
                answer = ScheduleSignAnswer.NotYet;
                return true;
            case "unsure":
                answer = ScheduleSignAnswer.Unsure;
                return true;
            default:
                answer = default;
                return false;
        }
    }
}

/// <summary>
/// One answer about the sign of one own work (<c>ssf.schedule_task_events</c>): APPEND-ONLY by privilege (the application role has SELECT and INSERT only). The
/// id is minted on the phone, so a re-sent answer is the same answer. It names the work by its STABLE identity - the own item and its task key - never by a
/// step id (a step id changes when the plot moves to a new version).
/// <para><b>What it moves.</b> Only <see cref="ScheduleSignAnswer.Seen"/> and <see cref="ScheduleSignAnswer.NotYet"/> decide anything, and the LATEST of them
/// wins (<see cref="ScheduleSignFacts"/>): "seen" makes the work due the day it was seen; a later "not yet" takes that back. "Unsure" is kept and moves
/// nothing. No answer is never "not yet" and never "not done".</para>
/// </summary>
public sealed class ScheduleTaskEvent : Entity<Guid>
{
    private ScheduleTaskEvent() : base(Guid.Empty) { } // EF Core

    private ScheduleTaskEvent(Guid id) : base(id)
    {
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public Guid OwnItemId { get; private set; }
    public string TaskKey { get; private set; } = string.Empty;
    public ScheduleSignAnswer Answer { get; private set; }

    /// <summary>The farm-local day the sign was looked at (for "seen": the day it was seen).</summary>
    public DateOnly ObservedOn { get; private set; }

    public Guid RecordedByUserId { get; private set; }
    public DateTime RecordedAtUtc { get; private set; }

    /// <summary>Makes one answer, or null with the reason when a part is missing. Whether the person may, and the day's bounds, are the handler's.</summary>
    public static ScheduleTaskEvent? Create(
        Guid id, FarmId farmId, Guid plotId, Guid cropCycleId, Guid ownItemId, string taskKey, ScheduleSignAnswer answer, DateOnly observedOn,
        Guid recordedByUserId, DateTime recordedAtUtc, out string? problem)
    {
        problem = null;
        if (id == Guid.Empty || farmId.IsEmpty || plotId == Guid.Empty || cropCycleId == Guid.Empty || ownItemId == Guid.Empty || recordedByUserId == Guid.Empty)
        {
            problem = "An answer names itself, its farm, plot, crop season, work and who gave it.";
            return null;
        }

        if (!ScheduleTaskContent.IsValidKey(taskKey))
        {
            problem = "The work's key is not a key.";
            return null;
        }

        if (!Enum.IsDefined(answer))
        {
            problem = "The answer is not one of seen, not yet, unsure.";
            return null;
        }

        return new ScheduleTaskEvent(id)
        {
            FarmId = farmId,
            PlotId = plotId,
            CropCycleId = cropCycleId,
            OwnItemId = ownItemId,
            TaskKey = taskKey,
            Answer = answer,
            ObservedOn = observedOn,
            RecordedByUserId = recordedByUserId,
            RecordedAtUtc = recordedAtUtc,
        };
    }
}

/// <summary>The pure reading of the answers about one work's sign (no clock, no I/O).</summary>
public static class ScheduleSignFacts
{
    /// <summary>The day the sign was seen, by the LATEST decisive answer (seen or not yet; unsure decides nothing), or null.</summary>
    public static DateOnly? SeenOn(IEnumerable<ScheduleTaskEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        var decisive = Ordered(events).LastOrDefault(e => e.Answer != ScheduleSignAnswer.Unsure);
        return decisive is { Answer: ScheduleSignAnswer.Seen } ? decisive.ObservedOn : null;
    }

    /// <summary>The latest answer of any kind (what the card shows), or null when nobody has answered.</summary>
    public static ScheduleSignAnswer? LatestAnswer(IEnumerable<ScheduleTaskEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        return Ordered(events).LastOrDefault()?.Answer;
    }

    private static IEnumerable<ScheduleTaskEvent> Ordered(IEnumerable<ScheduleTaskEvent> events) =>
        events.OrderBy(e => e.RecordedAtUtc).ThenBy(e => e.Id);
}

/// <summary>
/// The occurrences of a repeating work (pure). A repeating work makes ONE open plan at a time, never a flood: occurrence 1 takes the resolved date, and each
/// later occurrence is the first one moved on by the repeat's spacing (every N days; "N times a week" = every 7/N days, at least one). A once-only work has only
/// occurrence 1.
/// </summary>
public static class ScheduleOccurrences
{
    /// <summary>Days between two occurrences; 0 for a once-only work.</summary>
    public static int Spacing(ScheduleTaskTiming timing)
    {
        ArgumentNullException.ThrowIfNull(timing);
        return timing.Repeat switch
        {
            ScheduleRepeatMode.EveryNDays => Math.Max(1, timing.RepeatInterval ?? 1),
            ScheduleRepeatMode.PerWeek => Math.Max(1, 7 / Math.Max(1, timing.RepeatInterval ?? 1)),
            _ => 0,
        };
    }

    /// <summary>The resolution of occurrence <paramref name="occurrence"/> (1 = the first): both the due and the expected window, moved by the spacing.</summary>
    public static ScheduleResolution For(ScheduleResolution first, ScheduleTaskTiming timing, int occurrence)
    {
        ArgumentNullException.ThrowIfNull(first);
        if (occurrence <= 1)
        {
            return first;
        }

        var shift = Spacing(timing) * (occurrence - 1);
        return new ScheduleResolution(Shift(first.Due, shift), Shift(first.Expected, shift), first.DueSource);
    }

    /// <summary>
    /// True when occurrence <paramref name="occurrence"/> falls after the repeat's end (its end day, or a day window's last day), measured from
    /// <paramref name="anchor"/> (stored day 0). Unknown when there is no anchor or no date: false.
    /// </summary>
    public static bool IsPastEnd(ScheduleResolution resolution, ScheduleTaskTiming timing, DateOnly? anchor)
    {
        ArgumentNullException.ThrowIfNull(resolution);
        ArgumentNullException.ThrowIfNull(timing);
        var date = (resolution.Due ?? resolution.Expected)?.From;
        if (anchor is not { } start || date is not { } day)
        {
            return false;
        }

        var endDay = timing.RepeatEndDay ?? (timing.Timer == ScheduleTimerKind.Day ? timing.ToDay : null);
        return endDay is { } end && day > start.AddDays(end);
    }

    private static ScheduleWindow? Shift(ScheduleWindow? window, int days) =>
        window is null || days == 0 ? window : new ScheduleWindow(window.From.AddDays(days), window.From.AddDays(days));
}
