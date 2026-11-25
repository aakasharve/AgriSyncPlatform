namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Lane DFES-Q (founder D-B, D-G, 2026-11-21) — turns the look-line ids a phone says it used into the sources those lines carry
/// in Shram Safal's OWN published schedule (never a PDF, never a phone's claim). Implemented in Infrastructure over the embedded
/// schedule the Schedule Maker publishes.
/// </summary>
public interface IQuestionSourceResolver
{
    /// <summary>
    /// The sources of every line, or <c>null</c> when the list is empty, ANY id is unknown, or any line carries no source or is
    /// marked as the schedule's own choice. All or nothing: one unknown line rejects the question (fail closed).
    /// </summary>
    IReadOnlyList<QuestionSourceRef>? Resolve(IReadOnlyList<string> lookLineIds);
}

/// <summary>One source of one look line: the line, the document and the page.</summary>
public sealed record QuestionSourceRef(string LineId, string DocId, string Page);

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule")

/// <summary>
/// What the task format says about a stage question's lines for ONE plot. <see cref="NotTaskFormat"/>: the plot follows no schedule written in the task format and has
/// no work of its own, so the embedded schedule (<see cref="IQuestionSourceResolver"/>) is the fallback. <see cref="Resolved"/>: every line is a task of the schedule
/// the plot follows or of its own works, and stands on a source. <see cref="Refused"/>: the plot has task-format schedules and a line did not resolve (an unknown task, a
/// task with no source, words it does not have, or an embedded-schedule line asked on a plot that no longer uses it).
/// </summary>
public enum TaskQuestionGate
{
    NotTaskFormat = 0,
    Resolved = 1,
    Refused = 2,
}

public sealed record TaskQuestionResolution(TaskQuestionGate Gate, IReadOnlyList<QuestionSourceRef>? Sources = null);

/// <summary>
/// Slice 12 - reads the sources of the stage questions ShramSathi asks from the task the plot FOLLOWS (its main schedule version in the task format) or OWNS (its own
/// works of the current season). All or nothing, fail closed (P4). A phone only names a task and which of its two questions (look or ask); the server finds the
/// task and its source.
/// </summary>
public interface ITaskQuestionSources
{
    Task<TaskQuestionResolution> ResolveAsync(Guid farmId, Guid? plotId, IReadOnlyList<string> lineIds, CancellationToken ct = default);
}
