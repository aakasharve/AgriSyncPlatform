using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Dfes;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule"; approved spec plr-d10-schedule-approved-spec-2026-11-23:
// "one question per card: what, when, how, look, ask"; "look" and "ask" are questions of their own)

/// <summary>Which of a task's two questions a line is: what to look at (<see cref="ScheduleTaskContent.Look"/>) or the one question it asks (<see cref="ScheduleTaskContent.Ask"/>).</summary>
public enum TaskQuestionPart
{
    Look = 0,
    Ask = 1,
}

/// <summary>Where the work a question is about comes from: a reference schedule the plot follows, the farmer's own work made by hand, or his own work taken from a schedule.</summary>
public enum TaskWorkKind
{
    Reference = 0,
    OwnByHand = 1,
    OwnTaken = 2,
}

/// <summary>One source a task question stands on: the document and where in it (empty for the farmer's own experience).</summary>
public sealed record TaskQuestionSource(string Document, string Page);

/// <summary>
/// The line a question names, and the sources it stands on (pure, no clock, no I/O). A line is <c>task:{taskKey}:look</c> or <c>task:{taskKey}:ask</c>: the phone names the
/// task and which of its two questions it asked, never a document. The server finds the task itself (the schedule the plot follows, or the plot's own works) and decides
/// the source, so a phone cannot claim one.
/// <list type="bullet">
/// <item><b>A reference task that names no source document is never asked</b> (<c>askOnlyWithSource</c>); nor one whose basis is our own choice or an assumption.</item>
/// <item><b>A work the farmer made by hand</b> (basis experience, no document) may be asked, and its source is labelled as his own experience
/// (<see cref="OwnExperienceDocument"/>), never a book, an institution or ShramSafal (<c>ownExperienceIsLabelled</c>).</item>
/// <item><b>A work taken into his schedule</b> keeps the source of the task it was taken from; it is never relabelled as his own experience.</item>
/// </list>
/// </summary>
public static class TaskQuestionLines
{
    /// <summary>The prefix of every task line id.</summary>
    public const string Prefix = "task:";

    /// <summary>The document of a source that is the farmer's own experience (the phone words it "स्रोत: तुमचा अनुभव"). Never a real document id.</summary>
    public const string OwnExperienceDocument = "own-experience";

    private const string LookSuffix = ":look";
    private const string AskSuffix = ":ask";

    public static string LineId(string taskKey, TaskQuestionPart part) =>
        Prefix + taskKey + (part == TaskQuestionPart.Look ? LookSuffix : AskSuffix);

    public static bool IsTaskLine(string? lineId) => lineId is not null && lineId.StartsWith(Prefix, StringComparison.Ordinal);

    /// <summary>Reads a line id; false for anything that is not exactly <c>task:{valid key}:look</c> or <c>:ask</c>.</summary>
    public static bool TryParse(string? lineId, out string taskKey, out TaskQuestionPart part)
    {
        taskKey = string.Empty;
        part = default;
        if (!IsTaskLine(lineId))
        {
            return false;
        }

        var rest = lineId![Prefix.Length..];
        if (rest.EndsWith(LookSuffix, StringComparison.Ordinal))
        {
            part = TaskQuestionPart.Look;
            rest = rest[..^LookSuffix.Length];
        }
        else if (rest.EndsWith(AskSuffix, StringComparison.Ordinal))
        {
            part = TaskQuestionPart.Ask;
            rest = rest[..^AskSuffix.Length];
        }
        else
        {
            return false;
        }

        if (!ScheduleTaskContent.IsValidKey(rest))
        {
            return false;
        }

        taskKey = rest;
        return true;
    }

    /// <summary>Whether the task has words for this question: a sign to look for, or the question it asks. A task with neither has nothing to ask.</summary>
    public static bool HasWords(ScheduleTaskContent task, TaskQuestionPart part)
    {
        ArgumentNullException.ThrowIfNull(task);
        return part == TaskQuestionPart.Look
            ? !string.IsNullOrWhiteSpace(task.Look?.Sign)
            : !string.IsNullOrWhiteSpace(task.Ask?.Question);
    }

    /// <summary>
    /// The sources a question about <paramref name="task"/> stands on, or <c>null</c> = not asked. <paramref name="originSources"/> are the sources of the task a taken work was
    /// taken from, used only when the copy itself carries none (a take copies the task whole, so this is the rare case).
    /// </summary>
    public static IReadOnlyList<TaskQuestionSource>? SourcesOf(
        ScheduleTaskContent task, TaskWorkKind kind, IReadOnlyList<ScheduleSource>? originSources = null)
    {
        ArgumentNullException.ThrowIfNull(task);

        // Our own choice and an assumption are not a source's word: a question that states agronomy does not stand on them.
        if (task.Basis is ScheduleBasis.OurChoice or ScheduleBasis.Assumed)
        {
            return null;
        }

        var documents = Named(task.Sources);
        if (documents.Count == 0 && kind == TaskWorkKind.OwnTaken)
        {
            documents = Named(originSources);
        }

        if (documents.Count > 0)
        {
            return documents;
        }

        // No document. Only the farmer's own work, made by hand and written as his own experience, may be asked: it says so. A reference task, and a taken work, never.
        return kind == TaskWorkKind.OwnByHand && task.Basis == ScheduleBasis.Experience
            ? [new TaskQuestionSource(OwnExperienceDocument, string.Empty)]
            : null;
    }

    private static List<TaskQuestionSource> Named(IReadOnlyList<ScheduleSource>? sources) =>
        (sources ?? [])
            .Where(s => s is not null && !string.IsNullOrWhiteSpace(s.Document))
            .Select(s => new TaskQuestionSource(s.Document.Trim(), s.Page?.Trim() ?? string.Empty))
            .ToList();
}
