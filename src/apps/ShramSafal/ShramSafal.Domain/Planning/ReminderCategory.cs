// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-79: three sources, shown clearly).
using System.Text.Json.Serialization;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// The three sources of a reminder (D-79): the work a person planned or was given (<see cref="FromPlanning"/>), the crop
/// schedule's own steps (<see cref="FromSchedule"/>) and the unfinished or spoken work of a daily log
/// (<see cref="FromLogs"/>). Read from a task's <see cref="PlannedWorkSource"/>; never stored. A schedule step is never copied
/// into <c>planned_work</c> (R13), so <see cref="FromSchedule"/> names the board's steps and a task whose source is
/// <see cref="PlannedWorkSource.Schedule"/>. The wire carries the NAME.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ReminderCategory>))]
public enum ReminderCategory
{
    FromPlanning = 0,
    FromSchedule = 1,
    FromLogs = 2,
}

/// <summary>
/// Who sees a category of reminders besides the people the base rule always shows it to (<c>PlannedWorkVisibility</c>:
/// the primary owner, the maker, the assignee, a SeeAllTasks holder). Stored as the NAME. <see cref="MakerAndOwner"/> and
/// <see cref="PlotTeam"/> are the choices for log and own reminders; <see cref="PlotTeam"/> and <see cref="Planners"/> for
/// the schedule's steps.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ReminderAudience>))]
public enum ReminderAudience
{
    /// <summary>Only the maker and the primary owner (D-79's base for a log reminder and for his own).</summary>
    MakerAndOwner = 0,

    /// <summary>Everyone on the plot: every Active seat that covers a plot of the reminder.</summary>
    PlotTeam = 1,

    /// <summary>Schedule steps only: the primary owner and the people who hold PlanWork or AssignWork.</summary>
    Planners = 2,
}

/// <summary>The pure mapping of the task record's words to a category.</summary>
public static class ReminderCategories
{
    /// <summary>The category of a task by the door that made it (D-29: the source).</summary>
    public static ReminderCategory Of(PlannedWorkSource source) => source switch
    {
        PlannedWorkSource.VoiceLog or PlannedWorkSource.LogLeftover => ReminderCategory.FromLogs,
        PlannedWorkSource.Schedule => ReminderCategory.FromSchedule,
        _ => ReminderCategory.FromPlanning,
    };

    /// <summary>The category of <paramref name="task"/>.</summary>
    public static ReminderCategory Of(PlannedWork task)
    {
        ArgumentNullException.ThrowIfNull(task);
        return Of(task.Source);
    }
}
