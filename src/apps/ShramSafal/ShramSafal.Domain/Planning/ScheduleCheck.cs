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

    /// <summary>Approve: refused unless the row stores its days and the checker ticked EVERY one of its activities (R3, R4).</summary>
    public static ScheduleCheck? Approve(
        ScheduleTemplate template,
        IReadOnlyCollection<Guid> checkedActivityIds,
        UserId checkerUserId,
        string checkerDisplayName,
        DateTime atUtc,
        out ScheduleCheckProblem? problem)
    {
        if (!Common(template, checkerUserId, checkerDisplayName, out var name, out problem))
        {
            return null;
        }

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
            Guid.NewGuid(), template.Id, template.Version, decision, [], trimmed, checkerUserId, name, atUtc);
    }

    private static bool Common(
        ScheduleTemplate template, UserId checkerUserId, string? displayName, out string name, out ScheduleCheckProblem? problem)
    {
        ArgumentNullException.ThrowIfNull(template);
        name = displayName?.Trim() ?? string.Empty;
        problem = null;
        if (!template.HasStoredDays)
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
