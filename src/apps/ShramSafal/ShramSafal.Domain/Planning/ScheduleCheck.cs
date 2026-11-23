using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

/// <summary>What a schedule's check currently says (the latest decision for that row).</summary>
public enum ScheduleCheckState
{
    /// <summary>ShramSafal has checked every row of this version.</summary>
    Checked = 0,

    /// <summary>No decision for this row (every row made before the lane, every edited copy, every built-in sample).</summary>
    NotChecked = 1,

    /// <summary>The checker sent it back with a note.</summary>
    Returned = 2,

    /// <summary>The checker took his approval back, with a note.</summary>
    Withdrawn = 3,
}

public enum ScheduleCheckDecision
{
    Approved = 0,
    Returned = 1,
    Withdrawn = 2,
}

/// <summary>A refused check: a stable code and the words that say why.</summary>
public sealed record ScheduleCheckProblem(string Code, string Message);

/// <summary>
/// spec: plr-d10 schedule slice 7 - what the checker ticked: the activities of a row in the old form, or - for a version in the task format - every task key and
/// challenge key, and the content hash of the version he ticked them on.
/// </summary>
public sealed record ScheduleCheckTicks(
    IReadOnlyCollection<Guid>? ActivityIds,
    IReadOnlyCollection<string>? TaskKeys,
    IReadOnlyCollection<string>? ChallengeKeys,
    string? ContentHash);

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 2; founder D-74, L8-R) - a schedule check is a ShramSafal PLATFORM act: an APPEND-ONLY
/// server record of who checked, when, and which version of which library row. It is never a farm seat's act and never a flag
/// the client sends; the farm role <c>AppRole.Agronomist</c> grants nothing here. A row is never edited: a later decision is a
/// new record, and the LATEST decision for a row is its state (<see cref="StateOf"/>). A row that is edited later is a NEW row
/// (copy-on-write): it starts <see cref="ScheduleCheckState.NotChecked"/> and the old row keeps its check (Review Focus 6).
/// <para>R3 / P4: only a row whose days are STORED can be checked (<see cref="ScheduleTemplate.HasStoredDays"/>). R4: the
/// checker ticks EVERY activity row; Approve needs all of them.</para>
/// </summary>
public sealed class ScheduleCheck : Entity<Guid>
{
    public const int MaxNoteLength = 1000;
    public const int MaxDisplayNameLength = 120;

    private ScheduleCheck() : base(Guid.Empty) { } // EF Core

    private ScheduleCheck(
        Guid id,
        Guid scheduleTemplateId,
        int templateVersion,
        ScheduleCheckDecision decision,
        IReadOnlyList<Guid> checkedActivityIds,
        string? note,
        UserId checkerUserId,
        string checkerDisplayName,
        DateTime checkedAtUtc)
        : base(id)
    {
        ScheduleTemplateId = scheduleTemplateId;
        TemplateVersion = templateVersion;
        Decision = decision;
        CheckedActivityIds = checkedActivityIds.ToArray();
        Note = note;
        CheckerUserId = checkerUserId;
        CheckerDisplayName = checkerDisplayName;
        CheckedAtUtc = checkedAtUtc;
    }

    public Guid ScheduleTemplateId { get; private set; }
    public int TemplateVersion { get; private set; }
    public ScheduleCheckDecision Decision { get; private set; }
    public Guid[] CheckedActivityIds { get; private set; } = [];
    public string? Note { get; private set; }
    public UserId CheckerUserId { get; private set; }
    public string CheckerDisplayName { get; private set; } = string.Empty;
    public DateTime CheckedAtUtc { get; private set; }

    /// <summary>
    /// spec: plr-d10 schedule slice 7 - for a version in the task format: EVERY task key the checker ticked (an approval holds all of them; a return or a
    /// withdrawal none). Null on every check of a row that is not in the task format, and on every check made before the slice.
    /// </summary>
    public string[]? CheckedTaskKeys { get; private set; }

    /// <summary>slice 7 - every challenge key the checker ticked (as <see cref="CheckedTaskKeys"/>).</summary>
    public string[]? CheckedChallengeKeys { get; private set; }

    /// <summary>slice 7 - the content hash of the version (<see cref="ScheduleTemplate.TaskFormatHash"/>) the decision was made on; null when not in the task format.</summary>
    public string? ContentHash { get; private set; }

    /// <summary>
    /// slice 7 - "a maker cannot approve their own schedule": the person who made THIS version (its <see cref="ScheduleTemplate.CreatedByUserId"/>) never approves it;
    /// another checker does. A return or a withdrawal by the maker is not an approval and stays possible.
    /// </summary>
    public const string OwnScheduleCode = "ScheduleCheckOwnSchedule";

    /// <summary>Approve: refused unless the row stores its days and the checker ticked EVERY one of its activities (R3, R4).</summary>
    public static ScheduleCheck? Approve(
        ScheduleTemplate template,
        IReadOnlyCollection<Guid> checkedActivityIds,
        UserId checkerUserId,
        string checkerDisplayName,
        DateTime atUtc,
        out ScheduleCheckProblem? problem)
        => Approve(template, new ScheduleCheckTicks(checkedActivityIds, null, null, null), checkerUserId, checkerDisplayName, atUtc, out problem);

    /// <summary>
    /// Approve (slice 7 form). A version in the task format is approved by its TASKS: every task key and every challenge key ticked, on the SAME content hash
    /// the checker saw (<see cref="ScheduleTemplate.TaskFormatHash"/>); its stored activities are written from those tasks and are recorded whole. Any other row
    /// keeps the old rule: every activity ticked. Either way the maker of the version never approves it (<see cref="OwnScheduleCode"/>).
    /// </summary>
    public static ScheduleCheck? Approve(
        ScheduleTemplate template,
        ScheduleCheckTicks ticks,
        UserId checkerUserId,
        string checkerDisplayName,
        DateTime atUtc,
        out ScheduleCheckProblem? problem)
    {
        ArgumentNullException.ThrowIfNull(ticks);
        if (!Common(template, checkerUserId, checkerDisplayName, out var name, out problem))
        {
            return null;
        }

        if (template.CreatedByUserId is { } maker && maker == checkerUserId)
        {
            problem = new(OwnScheduleCode, "The person who made this version cannot approve it; another checker approves it.");
            return null;
        }

        if (template.IsInTaskFormat)
        {
            return ApproveTasks(template, ticks, checkerUserId, name, atUtc, out problem);
        }

        var checkedActivityIds = ticks.ActivityIds ?? [];
        var rowIds = template.Activities.Select(a => a.Id).ToHashSet();
        var ticked = (checkedActivityIds ?? []).ToList();
        if (ticked.Distinct().Count() != ticked.Count || !rowIds.SetEquals(ticked))
        {
            var missing = rowIds.Count(id => !ticked.Contains(id));
            problem = new("ScheduleCheckNotAllRows",
                missing > 0
                    ? $"Approve needs every activity ticked; {missing} of {rowIds.Count} are not."
                    : "The ticked activities are not the activities of this schedule.");
            return null;
        }

        return new ScheduleCheck(
            Guid.NewGuid(), template.Id, template.Version, ScheduleCheckDecision.Approved,
            rowIds.OrderBy(i => i).ToList(), note: null, checkerUserId, name, atUtc);
    }

    private static ScheduleCheck? ApproveTasks(
        ScheduleTemplate template, ScheduleCheckTicks ticks, UserId checkerUserId, string name, DateTime atUtc, out ScheduleCheckProblem? problem)
    {
        problem = null;
        var hash = template.TaskFormatHash();
        if (string.IsNullOrWhiteSpace(ticks.ContentHash) || !string.Equals(ticks.ContentHash.Trim(), hash, StringComparison.Ordinal))
        {
            problem = new("ScheduleCheckHashChanged",
                "The ticks were made on other content than this version holds; open the schedule again and tick it as it is now.");
            return null;
        }

        var taskKeys = template.Tasks.Select(t => t.TaskKey).ToHashSet(StringComparer.Ordinal);
        var challengeKeys = template.Challenges.Select(c => c.ChallengeKey).ToHashSet(StringComparer.Ordinal);
        var tickedTasks = (ticks.TaskKeys ?? []).ToList();
        var tickedChallenges = (ticks.ChallengeKeys ?? []).ToList();
        var tasksOk = tickedTasks.Distinct(StringComparer.Ordinal).Count() == tickedTasks.Count && taskKeys.SetEquals(tickedTasks);
        var challengesOk = tickedChallenges.Distinct(StringComparer.Ordinal).Count() == tickedChallenges.Count && challengeKeys.SetEquals(tickedChallenges);
        if (!tasksOk || !challengesOk)
        {
            var missing = taskKeys.Count(k => !tickedTasks.Contains(k, StringComparer.Ordinal))
                + challengeKeys.Count(k => !tickedChallenges.Contains(k, StringComparer.Ordinal));
            problem = new("ScheduleCheckNotAllTasks",
                missing > 0
                    ? $"Approve needs every task and every challenge ticked; {missing} of {taskKeys.Count + challengeKeys.Count} are not."
                    : "The ticked tasks are not the tasks of this version.");
            return null;
        }

        return new ScheduleCheck(
            Guid.NewGuid(), template.Id, template.Version, ScheduleCheckDecision.Approved,
            template.Activities.Select(a => a.Id).OrderBy(i => i).ToList(), note: null, checkerUserId, name, atUtc)
        {
            CheckedTaskKeys = taskKeys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
            CheckedChallengeKeys = challengeKeys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
            ContentHash = hash,
        };
    }

    /// <summary>Return: the schedule goes back to its maker with a note (required).</summary>
    public static ScheduleCheck? Return(
        ScheduleTemplate template, string? note, UserId checkerUserId, string checkerDisplayName, DateTime atUtc,
        out ScheduleCheckProblem? problem)
        => WithNote(ScheduleCheckDecision.Returned, template, note, checkerUserId, checkerDisplayName, atUtc, out problem);

    /// <summary>Withdraw: ShramSafal takes its approval back, with a note (required).</summary>
    public static ScheduleCheck? Withdraw(
        ScheduleTemplate template, string? note, UserId checkerUserId, string checkerDisplayName, DateTime atUtc,
        out ScheduleCheckProblem? problem)
        => WithNote(ScheduleCheckDecision.Withdrawn, template, note, checkerUserId, checkerDisplayName, atUtc, out problem);

    /// <summary>The state of one library row: its LATEST decision (ties go to the one given last), else NotChecked.</summary>
    public static ScheduleCheckState StateOf(IEnumerable<ScheduleCheck> checksOfThatRow)
    {
        ArgumentNullException.ThrowIfNull(checksOfThatRow);
        var latest = Latest(checksOfThatRow);
        return latest?.Decision switch
        {
            ScheduleCheckDecision.Approved => ScheduleCheckState.Checked,
            ScheduleCheckDecision.Returned => ScheduleCheckState.Returned,
            ScheduleCheckDecision.Withdrawn => ScheduleCheckState.Withdrawn,
            _ => ScheduleCheckState.NotChecked,
        };
    }

    public static ScheduleCheck? Latest(IEnumerable<ScheduleCheck> checksOfThatRow)
    {
        ScheduleCheck? latest = null;
        foreach (var c in checksOfThatRow)
        {
            if (latest is null || c.CheckedAtUtc >= latest.CheckedAtUtc)
            {
                latest = c;
            }
        }

        return latest;
    }

    private static ScheduleCheck? WithNote(
        ScheduleCheckDecision decision, ScheduleTemplate template, string? note, UserId checkerUserId,
        string checkerDisplayName, DateTime atUtc, out ScheduleCheckProblem? problem)
    {
        if (!Common(template, checkerUserId, checkerDisplayName, out var name, out problem))
        {
            return null;
        }

        var trimmed = note?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            problem = new("ScheduleCheckNoteRequired", $"{decision} needs a reason.");
            return null;
        }

        if (trimmed.Length > MaxNoteLength)
        {
            problem = new("ScheduleCheckNoteTooLong", $"The reason may be at most {MaxNoteLength} characters.");
            return null;
        }

        return new ScheduleCheck(
            Guid.NewGuid(), template.Id, template.Version, decision, [], trimmed, checkerUserId, name, atUtc)
        {
            ContentHash = template.TaskFormatHash(),
        };
    }

    private static bool Common(
        ScheduleTemplate template, UserId checkerUserId, string? displayName, out string name, out ScheduleCheckProblem? problem)
    {
        ArgumentNullException.ThrowIfNull(template);
        name = displayName?.Trim() ?? string.Empty;
        problem = null;
        // slice 7: a version in the task format is checked by its stage line and its tasks (some of which have no stored day, and are never given one).
        if (template.IsInTaskFormat ? !template.HasStageLine : !template.HasStoredDays)
        {
            problem = new("ScheduleCheckDaysNotStored",
                "Only a schedule whose days are stored can be checked; the days of this one are not.");
            return false;
        }

        if (checkerUserId.Value == Guid.Empty)
        {
            problem = new("ScheduleCheckChecker", "A check needs the person who checked.");
            return false;
        }

        if (name.Length == 0 || name.Length > MaxDisplayNameLength)
        {
            problem = new("ScheduleCheckDisplayName", $"A check needs the name farmers read, of at most {MaxDisplayNameLength} characters.");
            return false;
        }

        return true;
    }
}
