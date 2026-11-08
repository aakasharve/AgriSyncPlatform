// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c / D-24a, D-29, D-30, D-79).
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// What the person said about one task: the words, the day, the place, the person. The same record makes a task and edits it.
/// Every field is words (D-24a, P4): <see cref="PayMode"/>, <see cref="QuantityText"/>, <see cref="CrewText"/> and
/// <see cref="ExpectedHeadcount"/> are kept as said and never become an attendance, a wage, a cost, a job card or a payment.
/// </summary>
public sealed record PlannedWorkDetails(
    string Title,
    PlannedWorkScope Scope,
    IReadOnlyList<Guid> PlotIds,
    DateOnly? PlannedDate,
    PlannedWorkLooseWhen? LooseWhen,
    TimeOnly? PlannedTime,
    Guid? AssigneeUserId,
    string? CrewText,
    int? ExpectedHeadcount,
    string? QuantityText,
    PlannedWorkPayMode? PayMode,
    string? Note);

/// <summary>
/// One task or reminder of one farm (<c>ssf.planned_work</c>): planned work someone made, for the farm or for a person. Its
/// id is minted on the phone, so a re-sent task is the same task.
///
/// <list type="bullet">
/// <item><b>Reminder or assignment.</b> No assignee (or the maker himself) is a personal reminder and grants no authority.
/// An assignee other than the maker is one accountable person (D-24c).</item>
/// <item><b>Date is optional.</b> Undated and loose work is never late (<see cref="IsLate"/>); open work stays until it is
/// done or cancelled.</item>
/// <item><b>Words only (D-24a, P4).</b> This type names no attendance, labour, cost, job-card or payment type.</item>
/// <item><b>The clock.</b> <see cref="ModifiedAtUtc"/> moves forward on every change by <see cref="AudienceStamp"/>'s rule
/// (strictly later, never exactly on a whole second), so every phone's cursor passes it once.</item>
/// <item><b>Rules about WHO (create / edit / cancel / see)</b> live in <see cref="PlannedWorkAuthority"/> and
/// <see cref="PlannedWorkVisibility"/>; this type holds what a task IS and what a step does to it.</item>
/// </list>
/// </summary>
public sealed class PlannedWork : Entity<Guid>
{
    public const int MaxTitle = 200;
    public const int MaxCrewText = 100;
    public const int MaxQuantityText = 200;
    public const int MaxNote = 1000;
    public const int MaxCancelReason = 500;
    public const int MaxHeadcount = 999;
    public const int MaxPlots = 200;

    private readonly List<PlannedWorkPlot> plots = [];

    private PlannedWork() : base(Guid.Empty) { } // EF Core

    private PlannedWork(Guid id) : base(id)
    {
    }

    public FarmId FarmId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public PlannedWorkScope Scope { get; private set; }
    public DateOnly? PlannedDate { get; private set; }
    public PlannedWorkLooseWhen? LooseWhen { get; private set; }
    public TimeOnly? PlannedTime { get; private set; }

    /// <summary>The one accountable person; <c>null</c> = a reminder (आठवण).</summary>
    public Guid? AssigneeUserId { get; private set; }

    public string? CrewText { get; private set; }
    public int? ExpectedHeadcount { get; private set; }
    public string? QuantityText { get; private set; }
    public PlannedWorkPayMode? PayMode { get; private set; }
    public string? Note { get; private set; }
    public PlannedWorkStatus Status { get; private set; }
    public PlannedWorkSource Source { get; private set; }
    public PlannedWorkSourceKind? SourceKind { get; private set; }
    public Guid? SourceDailyLogId { get; private set; }
    public Guid? SourceLogTaskId { get; private set; }
    public string? SourceVoiceRef { get; private set; }
    public Guid? SourcePlotId { get; private set; }

    /// <summary>The farm-local day the task was made (D-29). A day, not an instant.</summary>
    public DateOnly RecordedOn { get; private set; }

    public IReadOnlyList<Guid> LinkedDailyLogIds { get; private set; } = [];
    public Guid CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Bumped on every change; the pull's cursor.</summary>
    public DateTime ModifiedAtUtc { get; private set; }

    public DateTime? SeenAtUtc { get; private set; }
    public DateTime? AcceptedAtUtc { get; private set; }
    public DateTime? DoneAtUtc { get; private set; }
    public Guid? DoneByUserId { get; private set; }
    public DateTime? CancelledAtUtc { get; private set; }
    public Guid? CancelledByUserId { get; private set; }
    public string? CancelReason { get; private set; }

    /// <summary>
    /// People the task was taken from by a reassign (P10): their phones are told to forget it. Kept so the pull can name the
    /// withdrawal to exactly them, with nothing else on the task (audit rows hold no assignee).
    /// </summary>
    public IReadOnlyList<Guid> FormerAssigneeUserIds { get; private set; } = [];

    public IReadOnlyList<PlannedWorkPlot> Plots => plots;

    public bool IsClosed => Status is PlannedWorkStatus.Done or PlannedWorkStatus.Cancelled;

    /// <summary>A reminder: nobody else is accountable. It grants no authority (D-24).</summary>
    public bool IsReminder => AssigneeUserId is null || AssigneeUserId == CreatedByUserId;

    /// <summary>
    /// Late = open work with a DATE before <paramref name="today"/> (the farm-local day). Undated and loose work is never late
    /// (D-24c), nor is closed work.
    /// </summary>
    public bool IsLate(DateOnly today) => !IsClosed && PlannedDate is { } date && date < today;

    /// <summary>The plots this task names now (a dropped row is gone from the task).</summary>
    public IEnumerable<PlannedWorkPlot> LivePlots => plots.Where(p => p.Status != PlannedWorkPlotStatus.Dropped);

    /// <summary>Makes a task. Throws <see cref="ArgumentException"/> for a shape the record forbids; the doors turn that into a refusal.</summary>
    public static PlannedWork Create(
        Guid id,
        FarmId farmId,
        PlannedWorkDetails details,
        PlannedWorkSource source,
        PlannedWorkSourceKind? sourceKind,
        DateOnly recordedOn,
        Guid createdByUserId,
        DateTime nowUtc,
        Guid? sourceDailyLogId = null,
        Guid? sourceLogTaskId = null,
        string? sourceVoiceRef = null,
        Guid? sourcePlotId = null)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("A task needs its own id.", nameof(id));
        }

        if (farmId.Value == Guid.Empty)
        {
            throw new ArgumentException("A task belongs to a farm.", nameof(farmId));
        }

        if (createdByUserId == Guid.Empty)
        {
            throw new ArgumentException("A task has a maker.", nameof(createdByUserId));
        }

        if (!Enum.IsDefined(source) || (sourceKind is { } kind && !Enum.IsDefined(kind)))
        {
            throw new ArgumentException("Unknown source.", nameof(source));
        }

        if (sourceVoiceRef is { Length: > 80 })
        {
            throw new ArgumentException("The recording reference is too long.", nameof(sourceVoiceRef));
        }

        var task = new PlannedWork(id)
        {
            FarmId = farmId,
            Source = source,
            SourceKind = sourceKind,
            SourceDailyLogId = sourceDailyLogId,
            SourceLogTaskId = sourceLogTaskId,
            SourceVoiceRef = sourceVoiceRef,
            SourcePlotId = sourcePlotId,
            RecordedOn = recordedOn,
            CreatedByUserId = createdByUserId,
            CreatedAtUtc = nowUtc,
            ModifiedAtUtc = AudienceStamp.NextModified(nowUtc.AddTicks(-1), nowUtc),
        };
        task.Apply(details, nowUtc);
        task.Status = task.AssigneeUserId is null ? PlannedWorkStatus.Open : PlannedWorkStatus.Assigned;
        return task;
    }

    /// <summary>
    /// Changes when, where, who and what. Whether the caller MAY is <see cref="PlannedWorkAuthority"/>'s. A new assignee
    /// resets the answers (seen, accepted) and remembers the old one for the withdrawal (P10); the same assignee keeps them.
    /// </summary>
    public PlannedWorkStep Edit(PlannedWorkDetails details, DateTime nowUtc)
    {
        if (IsClosed)
        {
            return PlannedWorkStep.Closed;
        }

        var before = AssigneeUserId;
        Apply(details, nowUtc);
        if (AssigneeUserId != before)
        {
            if (before is { } old && old != CreatedByUserId && !FormerAssigneeUserIds.Contains(old))
            {
                FormerAssigneeUserIds = [.. FormerAssigneeUserIds, old];
            }

            SeenAtUtc = null;
            AcceptedAtUtc = null;
            Status = AssigneeUserId is null ? PlannedWorkStatus.Open : PlannedWorkStatus.Assigned;
        }

        return PlannedWorkStep.Applied;
    }

    /// <summary>The assignee has seen it. Stamped once; a task already accepted stays accepted.</summary>
    public PlannedWorkStep MarkSeen(Guid byUserId, DateTime nowUtc)
    {
        // Fix round 1 (L005): the assignee is asked BEFORE the state, so a non-assignee is "not yours" on a closed task too.
        if (AssigneeUserId is not { } assignee || assignee != byUserId)
        {
            return PlannedWorkStep.NotAssignee;
        }

        if (IsClosed)
        {
            return PlannedWorkStep.Closed;
        }

        if (SeenAtUtc is not null)
        {
            return PlannedWorkStep.AlreadyDone;
        }

        SeenAtUtc = nowUtc;
        Status = Status == PlannedWorkStatus.Accepted ? Status : PlannedWorkStatus.Seen;
        Touch(nowUtc);
        return PlannedWorkStep.Applied;
    }

    /// <summary>The assignee accepts it. Stamped once; accepting also stamps "seen" if he had not.</summary>
    public PlannedWorkStep Accept(Guid byUserId, DateTime nowUtc)
    {
        if (AssigneeUserId is not { } assignee || assignee != byUserId)
        {
            return PlannedWorkStep.NotAssignee;
        }

        if (IsClosed)
        {
            return PlannedWorkStep.Closed;
        }

        if (AcceptedAtUtc is not null)
        {
            return PlannedWorkStep.AlreadyDone;
        }

        SeenAtUtc ??= nowUtc;
        AcceptedAtUtc = nowUtc;
        Status = PlannedWorkStatus.Accepted;
        Touch(nowUtc);
        return PlannedWorkStep.Applied;
    }

    /// <summary>Cancels the work. Whether the caller may is <see cref="PlannedWorkAuthority"/>'s. Stamped once.</summary>
    public PlannedWorkStep Cancel(Guid byUserId, string? reason, DateTime nowUtc)
    {
        if (Status == PlannedWorkStatus.Cancelled)
        {
            return PlannedWorkStep.AlreadyDone;
        }

        if (Status == PlannedWorkStatus.Done)
        {
            return PlannedWorkStep.Closed;
        }

        var trimmed = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (trimmed is { Length: > MaxCancelReason })
        {
            throw new ArgumentException("The reason is too long.", nameof(reason));
        }

        Status = PlannedWorkStatus.Cancelled;
        CancelledAtUtc = nowUtc;
        CancelledByUserId = byUserId;
        CancelReason = trimmed;
        Touch(nowUtc);
        return PlannedWorkStep.Applied;
    }

    private void Touch(DateTime nowUtc) => ModifiedAtUtc = AudienceStamp.NextModified(ModifiedAtUtc, nowUtc);

    private void Apply(PlannedWorkDetails details, DateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(details);
        var title = details.Title?.Trim();
        if (string.IsNullOrEmpty(title) || title.Length > MaxTitle)
        {
            throw new ArgumentException($"The task needs words, at most {MaxTitle} characters.", nameof(details));
        }

        if (!Enum.IsDefined(details.Scope))
        {
            throw new ArgumentException("Unknown scope.", nameof(details));
        }

        var plotIds = (details.PlotIds ?? []).ToList();
        if (plotIds.Any(p => p == Guid.Empty) || plotIds.Distinct().Count() != plotIds.Count || plotIds.Count > MaxPlots)
        {
            throw new ArgumentException("The plots must be real, each named once.", nameof(details));
        }

        var expected = details.Scope switch
        {
            PlannedWorkScope.Plot => plotIds.Count == 1,
            PlannedWorkScope.MultiPlot => plotIds.Count >= 2,
            _ => plotIds.Count == 0,
        };
        if (!expected)
        {
            throw new ArgumentException($"A {details.Scope} task cannot name {plotIds.Count} plots.", nameof(details));
        }

        if (details.PlannedDate is not null && details.LooseWhen is not null)
        {
            throw new ArgumentException("A task has a date or a loose word, not both.", nameof(details));
        }

        if (details.LooseWhen is { } loose && !Enum.IsDefined(loose))
        {
            throw new ArgumentException("Unknown loose word.", nameof(details));
        }

        if (details.PlannedTime is not null && details.PlannedDate is null)
        {
            throw new ArgumentException("A time needs a date.", nameof(details));
        }

        if (details.PayMode is { } pay && !Enum.IsDefined(pay))
        {
            throw new ArgumentException("Unknown pay word.", nameof(details));
        }

        var crew = Clean(details.CrewText, MaxCrewText, "crew words");
        var quantity = Clean(details.QuantityText, MaxQuantityText, "quantity words");
        var note = Clean(details.Note, MaxNote, "note");
        if (details.AssigneeUserId is null && (crew is not null || details.ExpectedHeadcount is not null))
        {
            throw new ArgumentException("Crew words and a headcount need a person to give the work to.", nameof(details));
        }

        if (details.AssigneeUserId == Guid.Empty)
        {
            throw new ArgumentException("The assignee must be a real person.", nameof(details));
        }

        if (details.ExpectedHeadcount is { } headcount && (headcount < 1 || headcount > MaxHeadcount))
        {
            throw new ArgumentException($"The expected headcount is 1 to {MaxHeadcount}.", nameof(details));
        }

        Title = title;
        Scope = details.Scope;
        PlannedDate = details.PlannedDate;
        LooseWhen = details.LooseWhen;
        PlannedTime = details.PlannedTime;
        AssigneeUserId = details.AssigneeUserId;
        CrewText = crew;
        ExpectedHeadcount = details.ExpectedHeadcount;
        QuantityText = quantity;
        PayMode = details.PayMode;
        Note = note;
        SetPlots(plotIds);
        Touch(nowUtc);
    }

    private void SetPlots(IReadOnlyList<Guid> plotIds)
    {
        foreach (var row in plots)
        {
            if (!plotIds.Contains(row.PlotId))
            {
                row.Drop();
            }
        }

        foreach (var plotId in plotIds)
        {
            if (plots.FirstOrDefault(p => p.PlotId == plotId) is { } existing)
            {
                existing.Restore();
            }
            else
            {
                plots.Add(new PlannedWorkPlot(Id, FarmId, plotId));
            }
        }
    }

    private static string? Clean(string? text, int max, string what)
    {
        var trimmed = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        return trimmed is { } t && t.Length > max ? throw new ArgumentException($"The {what} are too long.") : trimmed;
    }
}

/// <summary>
/// One plot of a task (<c>ssf.planned_work_plots</c>). Carries its own farm (a direct tenant column, F8). Completion is per
/// plot (D-30; lane L8c-3 sets it): a combined quantity is never split across plots.
/// </summary>
public sealed class PlannedWorkPlot
{
    private PlannedWorkPlot()
    {
    } // EF Core

    internal PlannedWorkPlot(Guid plannedWorkId, FarmId farmId, Guid plotId)
    {
        PlannedWorkId = plannedWorkId;
        FarmId = farmId;
        PlotId = plotId;
        Status = PlannedWorkPlotStatus.Pending;
    }

    public Guid PlannedWorkId { get; private set; }
    public Guid PlotId { get; private set; }
    public FarmId FarmId { get; private set; }
    public PlannedWorkPlotStatus Status { get; private set; }
    public DateTime? DoneAtUtc { get; private set; }
    public Guid? DoneByUserId { get; private set; }
    public IReadOnlyList<Guid> LinkedDailyLogIds { get; private set; } = [];

    internal void Drop()
    {
        if (Status == PlannedWorkPlotStatus.Pending)
        {
            Status = PlannedWorkPlotStatus.Dropped;
        }
    }

    internal void Restore()
    {
        if (Status == PlannedWorkPlotStatus.Dropped)
        {
            Status = PlannedWorkPlotStatus.Pending;
        }
    }
}
