// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c / D-24e1, D-26, D-79; MU design §11.6).
namespace ShramSafal.Domain.Planning;

/// <summary>
/// One person's standing on one farm, as the task rules need it, already settled against the clock (an ended grant is not
/// held). Built by the application from the farm SEAT, never from a label (D-26): the application's
/// <c>PlannedWorkSeats.From</c>. The rules below are pure.
/// </summary>
/// <param name="UserId">The person.</param>
/// <param name="Active">His seat reads the farm (the registrant, or an Active member).</param>
/// <param name="IsPrimaryOwner">The farm's primary account holder: holds every authority.</param>
/// <param name="HoldsPlanWork">Plan work, held now.</param>
/// <param name="HoldsAssignWork">Assign work, held now.</param>
/// <param name="HoldsSeeAllTasks">See all tasks, held now.</param>
/// <param name="ChosenPlotIds">The plots a chosen-plots seat covers; <c>null</c> = every plot.</param>
/// <param name="OwnWorkScope">Lane REM-1: the seat's scope is स्वतःचं काम (his own work, read by maker, not by plot): it is never "on" a plot, so the owner's "everyone on the plot" choices do not reach it.</param>
public readonly record struct PlannedWorkSeat(
    Guid UserId,
    bool Active,
    bool IsPrimaryOwner,
    bool HoldsPlanWork,
    bool HoldsAssignWork,
    bool HoldsSeeAllTasks,
    IReadOnlySet<Guid>? ChosenPlotIds,
    bool OwnWorkScope = false);

/// <summary>
/// WHO may make, change and cancel a task (D-24 / D-24c). One place.
/// <list type="bullet">
/// <item>A personal reminder (no assignee, or himself) grants no authority: any Active member makes one.</item>
/// <item>Giving work to someone else: the primary owner or <c>AssignWork</c>.</item>
/// <item>Changing or cancelling a task someone else made: the primary owner or <c>PlanWork</c>.</item>
/// <item>The maker changes or cancels his own while he still holds what he used to make it: work he handed to another person
/// still needs <c>AssignWork</c>; his own reminder needs nothing.</item>
/// </list>
/// </summary>
public static class PlannedWorkAuthority
{
    /// <summary>May this seat make a task for <paramref name="assignee"/> (<c>null</c> = a reminder)?</summary>
    public static bool MayMake(PlannedWorkSeat seat, Guid? assignee) =>
        seat.Active && (assignee is null || assignee == seat.UserId || seat.IsPrimaryOwner || seat.HoldsAssignWork);

    /// <summary>
    /// May this seat change a task made by <paramref name="creator"/>, now given to <paramref name="currentAssignee"/>, so
    /// that it is given to <paramref name="newAssignee"/>? Changing who it is given to also needs <c>AssignWork</c>.
    /// </summary>
    public static bool MayEdit(PlannedWorkSeat seat, Guid creator, Guid? currentAssignee, Guid? newAssignee)
    {
        if (!seat.Active)
        {
            return false;
        }

        if (seat.IsPrimaryOwner)
        {
            return true;
        }

        var isCreator = seat.UserId == creator;
        if (!isCreator && !seat.HoldsPlanWork)
        {
            return false;
        }

        bool Other(Guid? person) => person is { } p && p != seat.UserId;
        var handsToOthers = isCreator
            ? Other(currentAssignee) || Other(newAssignee)
            : newAssignee != currentAssignee && (Other(newAssignee) || Other(currentAssignee));
        return !handsToOthers || seat.HoldsAssignWork;
    }

    /// <summary>May this seat cancel a task made by <paramref name="creator"/>, now given to <paramref name="currentAssignee"/>?</summary>
    public static bool MayCancel(PlannedWorkSeat seat, Guid creator, Guid? currentAssignee)
    {
        if (!seat.Active)
        {
            return false;
        }

        if (seat.IsPrimaryOwner)
        {
            return true;
        }

        if (seat.UserId != creator)
        {
            return seat.HoldsPlanWork;
        }

        return currentAssignee is not { } other || other == seat.UserId || seat.HoldsAssignWork;
    }
}

/// <summary>
/// WHO sees a task, and which of its plot rows (D-24e1, D-26, D-79; MU design §11.6). One place; the pull, the REST reads
/// and the audit read all ask it.
/// <list type="number">
/// <item>A seat that does not read the farm sees nothing.</item>
/// <item>The primary owner sees every task and every row.</item>
/// <item>The maker sees his own task with every row (it is his own statement). A reminder is therefore seen by him and the
/// primary owner (D-79), and by the assignee and a SeeAllTasks holder by the same rules below.</item>
/// <item>The assignee sees it. A chosen-plots seat sees a plot task only with one of his plots, and only his plots' rows
/// (a task on another plot is not his, even when it is given to him).</item>
/// <item>A SeeAllTasks holder sees every task of a seat that covers every plot; a chosen-plots seat sees a plot task with one
/// of his plots and only his rows, and a Farm / Unspecified task only as its maker or assignee. An explicit grant widens
/// every seat that holds it, a कामगार's and a स्वतःचं काम seat's included, exactly as lab records and confirm records do
/// (<c>FarmReadScope.Of</c>): the owner switched it on for that person.</item>
/// <item>A crew headcount gives nobody else access.</item>
/// <item>Lane L8c-4 (D-26, D-31): a task made from a SPOKEN log is no more visible than the log itself. When the log is kept
/// from this reader by its audience ("फक्त मी"), a SeeAllTasks grant no longer widens his view of it - only its maker and the
/// primary owner (and an assignee, if the work was later handed to him by their act) still see it.</item>
/// </list>
/// REM-1 may later WIDEN who sees each kind of reminder; nothing narrows this base (except the line above, which is the
/// log's own privacy, not a narrowing of the task's).
/// </summary>
public static class PlannedWorkVisibility
{
    /// <summary>
    /// The plot rows of <paramref name="task"/> this seat sees (possibly none, for a task with no plots), or <c>null</c> when
    /// he does not see the task at all.
    /// </summary>
    /// <param name="seat">The reader's seat.</param>
    /// <param name="task">The task.</param>
    /// <param name="sourceLogHidden">True when the log this task was made from is kept from this reader by its audience.</param>
    public static IReadOnlyList<Guid>? VisiblePlots(PlannedWorkSeat seat, PlannedWork task, bool sourceLogHidden = false)
    {
        ArgumentNullException.ThrowIfNull(task);
        if (!seat.Active)
        {
            return null;
        }

        var live = task.LivePlots.Select(p => p.PlotId).ToList();
        if (seat.IsPrimaryOwner || task.CreatedByUserId == seat.UserId)
        {
            return live;
        }

        var isAssignee = task.AssigneeUserId == seat.UserId;
        var seesAll = seat.HoldsSeeAllTasks && !sourceLogHidden;
        if (!isAssignee && !seesAll)
        {
            return null;
        }

        var plotTask = task.Scope is PlannedWorkScope.Plot or PlannedWorkScope.MultiPlot;
        if (seat.ChosenPlotIds is not { } chosen)
        {
            return live;
        }

        if (!plotTask)
        {
            return isAssignee ? live : null;
        }

        var mine = live.Where(chosen.Contains).ToList();
        return mine.Count > 0 ? mine : null;
    }

    /// <summary>
    /// Must this seat's phone be told to forget the task? True when it once gave him the task (he was its assignee before a
    /// reassign) and he no longer sees it. A person who never held it is told nothing (P10, D-26).
    /// </summary>
    public static bool MustForget(PlannedWorkSeat seat, PlannedWork task)
    {
        ArgumentNullException.ThrowIfNull(task);
        return task.FormerAssigneeUserIds.Contains(seat.UserId) && VisiblePlots(seat, task) is null;
    }
}

/// <summary>
/// Lane L8c-3 (D-24d): what the owner has said about the log(s) a task or one of its plots was done with, as ONE word. Read from
/// the logs' own standing, never stored on the task: no linked log is <c>null</c> (no word - not "Waiting"); every linked log
/// Verified is <see cref="Confirmed"/>; any Disputed is <see cref="Disputed"/>; anything else (a draft, a confirmed-by-speaker
/// log, a log with a correction pending, a log this reader's database does not return) is <see cref="Waiting"/>. A correction
/// to a log never reopens the task (that is the owner's act alone).
/// </summary>
public static class PlannedWorkConfirmation
{
    public const string Confirmed = "Confirmed";
    public const string Disputed = "Disputed";
    public const string Waiting = "Waiting";

    /// <param name="linkedLogIds">The logs the work was done with.</param>
    /// <param name="statusOf">A log's current standing; <c>null</c> when it cannot be found.</param>
    public static string? Of(IReadOnlyCollection<Guid> linkedLogIds, Func<Guid, ShramSafal.Domain.Logs.VerificationStatus?> statusOf)
    {
        ArgumentNullException.ThrowIfNull(linkedLogIds);
        ArgumentNullException.ThrowIfNull(statusOf);
        if (linkedLogIds.Count == 0)
        {
            return null;
        }

        var states = linkedLogIds.Select(statusOf).ToList();
        if (states.Any(s => s == ShramSafal.Domain.Logs.VerificationStatus.Disputed))
        {
            return Disputed;
        }

        return states.All(s => s == ShramSafal.Domain.Logs.VerificationStatus.Verified) ? Confirmed : Waiting;
    }
}
