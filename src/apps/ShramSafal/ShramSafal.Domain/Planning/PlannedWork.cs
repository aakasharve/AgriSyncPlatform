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

    /// <summary>Most logs one complete step may link (lane L8c-3).</summary>
    public const int MaxLinkedLogs = 100;

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

    /// <summary>
    /// Lane L8c-3 (D-24d): who may say the work is done. The assignee; for a personal reminder (nobody else is accountable) the
    /// maker. Everyone else - the old assignee after a reassign, a holder of PlanWork, the primary owner - may not: only the
    /// person who did the work says it was done. One place.
    /// </summary>
    public bool MayComplete(Guid userId) =>
        userId != Guid.Empty && (AssigneeUserId is { } assignee ? assignee == userId : CreatedByUserId == userId);

    /// <summary>
    /// Lane L8c-3 (D-24d, D-30): the assignee (or a reminder's maker) says the work was done on these plots, with these logs.
    /// <list type="bullet">
    /// <item>Each named plot row that is still pending becomes Done (stamped once, its own logs appended). A row already Done
    /// is left exactly as it was: a second complete never un-does or re-stamps anything (replay-safe).</item>
    /// <item>The task becomes Done only when <paramref name="somethingLeft"/> is false and every live plot row is Done (a task
    /// with no plot rows: when <paramref name="somethingLeft"/> is false). Otherwise it stays pending: it is Accepted (the
    /// assignee is doing it), never Done.</item>
    /// <item>The task keeps every log ever linked to it (each once).</item>
    /// </list>
    /// Whether the logs exist, are this farm's, are on the named plots, and whether handed-out work has one at all is the
    /// handler's rule (it reads the logs); this type holds what the step does. Throws <see cref="ArgumentException"/> for a plot
    /// that is not a live plot of this task, so the door refuses the bytes.
    /// </summary>
    /// <param name="logIdsByPlot">For each named plot, the logs of this step that are on it (may be empty).</param>
    public PlannedWorkStep Complete(
        Guid byUserId,
        IReadOnlyCollection<Guid> plotIds,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> logIdsByPlot,
        IReadOnlyCollection<Guid> dailyLogIds,
        bool somethingLeft,
        DateTime nowUtc)
    {
        // The person comes before the state (the L8c-1 L005 lesson): a non-assignee is "not yours" on a closed task too.
        if (!MayComplete(byUserId))
        {
            return PlannedWorkStep.NotAssignee;
        }

        if (Status == PlannedWorkStatus.Cancelled)
        {
            return PlannedWorkStep.Closed;
        }

        if (Status == PlannedWorkStatus.Done)
        {
            return PlannedWorkStep.AlreadyDone;
        }

        ArgumentNullException.ThrowIfNull(plotIds);
        ArgumentNullException.ThrowIfNull(logIdsByPlot);
        ArgumentNullException.ThrowIfNull(dailyLogIds);
        var named = plotIds.Distinct().ToList();
        if (named.Count != plotIds.Count || named.Count > MaxPlots || named.Any(id => id == Guid.Empty))
        {
            throw new ArgumentException("The plots must be real, each named once.", nameof(plotIds));
        }

        var live = LivePlots.ToList();
        if (named.Any(id => live.All(p => p.PlotId != id)))
        {
            throw new ArgumentException("A plot named here is not a plot of this task.", nameof(plotIds));
        }

        if (dailyLogIds.Any(id => id == Guid.Empty) || dailyLogIds.Distinct().Count() != dailyLogIds.Count || dailyLogIds.Count > MaxLinkedLogs)
        {
            throw new ArgumentException("The logs must be real, each named once.", nameof(dailyLogIds));
        }

        var changed = false;
        foreach (var row in live.Where(p => named.Contains(p.PlotId) && p.Status == PlannedWorkPlotStatus.Pending))
        {
            row.MarkDone(byUserId, nowUtc, logIdsByPlot.TryGetValue(row.PlotId, out var own) ? own : []);
            changed = true;
        }

        var newLogs = dailyLogIds.Where(id => !LinkedDailyLogIds.Contains(id)).ToList();
        if (newLogs.Count > 0)
        {
            LinkedDailyLogIds = [.. LinkedDailyLogIds, .. newLogs];
            changed = true;
        }

        var becomesDone = !somethingLeft && live.All(p => p.Status == PlannedWorkPlotStatus.Done);
        if (AssigneeUserId is not null && AcceptedAtUtc is null)
        {
            // Doing the work is accepting it: the card never shows "done" over a task nobody accepted.
            SeenAtUtc ??= nowUtc;
            AcceptedAtUtc = nowUtc;
            Status = PlannedWorkStatus.Accepted;
            changed = true;
        }

        if (becomesDone)
        {
            Status = PlannedWorkStatus.Done;
            DoneAtUtc = nowUtc;
            DoneByUserId = byUserId;
            changed = true;
        }

        if (!changed)
        {
            return PlannedWorkStep.AlreadyDone;
        }

        Touch(nowUtc);
        return PlannedWorkStep.Applied;
    }

    /// <summary>
    /// Lane L8c-3 (D-24d, P3): the owner says "this was not done". A Done task goes back to pending (Accepted when its
    /// assignee had accepted it, otherwise as it was before) and every plot row that was Done goes back to Pending; the done
    /// stamps and the links to the logs that were taken for the work are cleared (the work is to be done again, and logs that
    /// did not satisfy the owner must not keep showing a confirmation on it). The history is the audit row: the step, and the
    /// reason. Whether the caller may (the primary owner) is the door's rule. The reason is required, at most
    /// <see cref="MaxCancelReason"/> characters; <see cref="ArgumentException"/> otherwise.
    /// </summary>
    public PlannedWorkStep Reopen(string? reason, DateTime nowUtc)
    {
        var trimmed = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (trimmed is null || trimmed.Length > MaxCancelReason)
        {
            throw new ArgumentException("A reopen needs a reason of at most 500 characters.", nameof(reason));
        }

        if (Status == PlannedWorkStatus.Cancelled)
        {
            return PlannedWorkStep.Closed;
        }

        if (Status != PlannedWorkStatus.Done)
        {
            return PlannedWorkStep.NotDone;
        }

        foreach (var row in plots.Where(p => p.Status == PlannedWorkPlotStatus.Done))
        {
            row.Reopen();
        }

        LinkedDailyLogIds = [];
        DoneAtUtc = null;
        DoneByUserId = null;
        Status = AcceptedAtUtc is not null ? PlannedWorkStatus.Accepted
            : AssigneeUserId is null ? PlannedWorkStatus.Open
            : PlannedWorkStatus.Assigned;
        Touch(nowUtc);
        return PlannedWorkStep.Applied;
    }

    /// <summary>
    /// Lane L8c-3: a log this task links to changed its standing (the owner confirmed it, or doubted it). Moves the task past
    /// every phone's cursor and nothing else - what it says and where it stands are untouched - so the next pull resends it
    /// with its new confirmation state. The state itself is never stored here: it is read from the logs.
    /// </summary>
    public void NoteLinkedLogChanged(DateTime nowUtc) => Touch(nowUtc);

    /// <summary>True when <paramref name="dailyLogId"/> is linked to this task or to one of its plot rows.</summary>
    public bool Links(Guid dailyLogId) =>
        LinkedDailyLogIds.Contains(dailyLogId) || plots.Any(p => p.LinkedDailyLogIds.Contains(dailyLogId));

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

    internal void MarkDone(Guid byUserId, DateTime nowUtc, IReadOnlyList<Guid> logIds)
    {
        Status = PlannedWorkPlotStatus.Done;
        DoneAtUtc = nowUtc;
        DoneByUserId = byUserId;
        LinkedDailyLogIds = [.. LinkedDailyLogIds, .. logIds.Where(id => !LinkedDailyLogIds.Contains(id))];
    }

    internal void Reopen()
    {
        Status = PlannedWorkPlotStatus.Pending;
        DoneAtUtc = null;
        DoneByUserId = null;
        LinkedDailyLogIds = [];
    }

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
