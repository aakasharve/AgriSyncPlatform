// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c, D-29, D-30): the closed word lists of a task.
// Each is stored as its NAME (varchar, CHECK-constrained) and travels as its name — never an ordinal.
using System.Text.Json.Serialization;

namespace ShramSafal.Domain.Planning;

/// <summary>Where a task stands. <c>Open</c> = a reminder nobody else has been given; <c>Done</c> is set by lane L8c-3.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkStatus>))]
public enum PlannedWorkStatus
{
    Open = 0,
    Assigned = 1,
    Seen = 2,
    Accepted = 3,
    Done = 4,
    Cancelled = 5,
}

/// <summary>Where the work is (D-30): one plot, several plots of one farm, the whole farm, or not said.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkScope>))]
public enum PlannedWorkScope
{
    Plot = 0,
    MultiPlot = 1,
    Farm = 2,
    Unspecified = 3,
}

/// <summary>A loose "when" in place of a date (D-24c: the date is optional).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkLooseWhen>))]
public enum PlannedWorkLooseWhen
{
    Week = 0,
    Month = 1,
    Anytime = 2,
}

/// <summary>How the work is paid, in words only (D-24a, P4): it never creates a wage, a cost or a payment.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkPayMode>))]
public enum PlannedWorkPayMode
{
    Cash = 0,
    Daily = 1,
    Contract = 2,
    Later = 3,
}

/// <summary>
/// Which door made the task (D-29: source is kept apart from scope). <c>Schedule</c> has no creating door (D-24e2 / D-75);
/// <c>VoiceLog</c> and <c>LogLeftover</c> are made by lane REM-1.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkSource>))]
public enum PlannedWorkSource
{
    Planning = 0,
    VoiceLog = 1,
    LogLeftover = 2,
    Schedule = 3,
}

/// <summary>How it was made, shown as the reminder's source line (D-78).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkSourceKind>))]
public enum PlannedWorkSourceKind
{
    Typed = 0,
    PlanForm = 1,
    Spoken = 2,
    Leftover = 3,
}

/// <summary>One plot row of a task. <c>Dropped</c> = taken off the task by an edit (no row is ever deleted).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PlannedWorkPlotStatus>))]
public enum PlannedWorkPlotStatus
{
    Pending = 0,
    Done = 1,
    Dropped = 2,
}

/// <summary>What a step did to the task (a step is seen, accept, cancel or edit).</summary>
public enum PlannedWorkStep
{
    /// <summary>The step changed the task.</summary>
    Applied,

    /// <summary>The step had already happened: nothing changed (a replay, or a second tap).</summary>
    AlreadyDone,

    /// <summary>Seen or accept by someone who is not the assignee.</summary>
    NotAssignee,

    /// <summary>The task is Done or Cancelled: it takes no more steps.</summary>
    Closed,
}

/// <summary>The wire words of the lists above: a name, any case, never a number.</summary>
public static class PlannedWorkWords
{
    public static bool TryParse<TEnum>(string? word, out TEnum value) where TEnum : struct, Enum
    {
        value = default;
        var trimmed = word?.Trim();
        return !string.IsNullOrEmpty(trimmed)
            && !int.TryParse(trimmed, out _)
            && Enum.TryParse(trimmed, ignoreCase: true, out value)
            && Enum.IsDefined(value);
    }
}
