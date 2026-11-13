// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-79, D-84 = 1, D-24e1, D-26; R13, R16, R17).
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// One farm's reminder settings and its always-show list, read together. A farm with no stored row has the defaults (D-79)
/// and nobody marked.
/// </summary>
public sealed record ReminderAudiences(ReminderSettings Settings, IReadOnlySet<Guid> AlwaysShow)
{
    /// <summary>What a farm has before its owner chooses anything.</summary>
    public static ReminderAudiences Defaults(Guid farmId) =>
        new(ReminderSettings.Defaults(new FarmId(farmId)), new HashSet<Guid>());
}

/// <summary>
/// WHO sees a reminder once the owner's settings are in (lane REM-1). ONE rule, asked by the pull, the REST reads, the single
/// read, the audit read and the attention board's schedule steps, so they cannot disagree (founder: "privacy must apply
/// everywhere the information travels").
///
/// <para><b>The union.</b> A reader sees a task when ANY of these holds:</para>
/// <list type="number">
/// <item><b>The base, never narrowed</b> (D-24e1): <see cref="PlannedWorkVisibility"/> - the primary owner, the maker, the
/// assignee, a SeeAllTasks holder. No setting takes any of these away.</item>
/// <item><b>The category's audience is the plot team</b>, the task is a REMINDER (no assignee but the maker; assigned work is never
/// widened by a setting), and the reader is Active and covers a plot of it.</item>
/// <item><b>The maker is on the always-show list</b> (D-84 = 1), the task is a reminder, and the reader is Active and covers a
/// plot of it. The maker cannot hide such a reminder: there is no per-reminder "private" choice for him
/// (<see cref="OffersPrivateChoice"/>).</item>
/// </list>
///
/// <para><b>The one exception, for every setting and for the always-show list.</b> A reminder made from a log is no more visible
/// than that log: when the log is kept from the reader by its audience ("फक्त मी", or chosen people he is not among) the reader
/// gets nothing from 2 or 3. His base seat still counts: the maker and the primary owner always see their log's reminder.
/// (Item 1 keeps its own log rule: a SeeAllTasks holder is not widened over a hidden log, lane L8c-4.)</para>
///
/// <para><b>Plot.</b> "Covers a plot" is the seat's own cover (the same plots <see cref="PlotScopeGate"/> answers for a chosen-plots
/// seat; every plot for the rest). A reminder with plot rows needs one of them; one with none (a spoken reminder or a whole-farm
/// one) takes the plot its log was made on (<c>SourcePlotId</c>); one with no plot at all is the whole farm's and reaches only a seat
/// that covers every plot. A seat on स्वतःचं काम is never on a plot (it reads by maker), so these two widenings do not reach it.</para>
/// </summary>
public static class ReminderVisibility
{
    /// <summary>
    /// The plot rows of <paramref name="task"/> this seat sees (possibly none: a whole-farm reminder), or <c>null</c> when he does not
    /// see it. Pure.
    /// </summary>
    public static IReadOnlyList<Guid>? VisiblePlots(
        PlannedWorkSeat seat,
        PlannedWork task,
        ReminderSettings settings,
        IReadOnlySet<Guid> alwaysShow,
        bool sourceLogHidden = false)
    {
        ArgumentNullException.ThrowIfNull(task);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(alwaysShow);
        return PlannedWorkVisibility.VisiblePlots(seat, task, sourceLogHidden)
            ?? Widened(seat, task, settings, alwaysShow, sourceLogHidden);
    }

    /// <summary>
    /// Items 2 and 3 above on their own: the rows the owner's choices let this seat see, or <c>null</c>. Never narrows anything.
    /// </summary>
    public static IReadOnlyList<Guid>? Widened(
        PlannedWorkSeat seat,
        PlannedWork task,
        ReminderSettings settings,
        IReadOnlySet<Guid> alwaysShow,
        bool sourceLogHidden)
    {
        if (!seat.Active || seat.OwnWorkScope || sourceLogHidden || !task.IsReminder)
        {
            return null;
        }

        var teamChosen = AudienceAllows(seat, settings.AudienceOf(ReminderCategories.Of(task)));
        var marked = alwaysShow.Contains(task.CreatedByUserId);
        return teamChosen || marked ? CoveredRows(seat, task) : null;
    }

    /// <summary>
    /// May this seat see a schedule step of the farm (the attention board's steps, R13: never copied into <c>planned_work</c>)? The
    /// plot test is the caller's (the board already narrows by plot). <c>PlotTeam</c> = every Active seat; <c>Planners</c> = the
    /// primary owner and the holders of PlanWork or AssignWork.
    /// </summary>
    public static bool MaySeeScheduleStep(PlannedWorkSeat seat, ReminderSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return seat.Active && AudienceAllows(seat, settings.ScheduleRemindersAudience, planners: seat.IsPrimaryOwner || seat.HoldsPlanWork || seat.HoldsAssignWork);
    }

    /// <summary>
    /// The one-line answer the plan names: may this reader see this task? Reads the source log's audience (only when the task has a
    /// source log) and asks <see cref="VisiblePlots"/>.
    /// </summary>
    public static async Task<bool> MaySeeAsync(
        IShramSafalRepository repository,
        PlannedWorkSeat viewer,
        PlannedWork item,
        ReminderSettings settings,
        IReadOnlySet<Guid> alwaysShow,
        DateTime atUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(item);
        var hidden = item.SourceDailyLogId is not null
            && PlannedWorkSourceLog.HiddenFrom(
                await RecordVisibility.ForFarmAsync(repository, (Guid)item.FarmId, viewer.UserId, atUtc, ct), item);
        return VisiblePlots(viewer, item, settings, alwaysShow, hidden) is not null;
    }

    /// <summary>
    /// Must this seat's phone be told to forget the reminder? Asked only of a reader who does not see it now. The rule, in full:
    /// <list type="number">
    /// <item>the task carries <see cref="PlannedWork.ReminderAudienceChangedAtUtc"/> (a settings change, or it was given to someone
    /// else or moved to other plots) - and the CALLER names it by that time, so each reader is told once (the delivered-once rule), never
    /// again by a later edit and never to a member who joined after it;</item>
    /// <item>the log it was made from is not kept from him (<paramref name="sourceLogHidden"/>): a reader a log is kept from never held
    /// it (P10, D-26);</item>
    /// <item>he COULD have held it under the widest choice: an Active seat that is not on his own work and covers a plot of every
    /// place the reminder ever had (a dropped row counts; the plot of its record when it never had one; a whole-farm reminder only
    /// a seat on every plot). Judged on those places, not on whether it is a reminder now - it may just have been given away.</item>
    /// </list>
    /// A reader who could not have held it is told nothing. A reader who could have, but never pulled it, is named once with a kind and
    /// an id and nothing else - the bounded over-naming this rule accepts.
    /// </summary>
    public static bool MustForget(PlannedWorkSeat seat, PlannedWork task, bool sourceLogHidden = false)
    {
        ArgumentNullException.ThrowIfNull(task);
        if (task.ReminderAudienceChangedAtUtc is null || sourceLogHidden || !seat.Active || seat.OwnWorkScope)
        {
            return false;
        }

        var places = task.Plots.Select(p => p.PlotId).ToList();
        if (task.SourcePlotId is { } source && !places.Contains(source))
        {
            places.Add(source);
        }

        return seat.ChosenPlotIds is not { } chosen || (places.Count > 0 && places.Any(chosen.Contains));
    }

    /// <summary>
    /// D-84 = 1: a maker on the always-show list is offered NO private choice for a reminder - its visibility to everyone on the
    /// plot is the owner's setting, not his. (A record he hides "फक्त मी" or keeps for chosen people is the one exception, and its
    /// reminder goes with it.)
    /// </summary>
    public static bool OffersPrivateChoice(Guid makerUserId, IReadOnlySet<Guid> alwaysShow)
    {
        ArgumentNullException.ThrowIfNull(alwaysShow);
        return !alwaysShow.Contains(makerUserId);
    }

    private static bool AudienceAllows(PlannedWorkSeat seat, ReminderAudience audience, bool? planners = null) => audience switch
    {
        ReminderAudience.PlotTeam => true,
        ReminderAudience.Planners => planners ?? (seat.IsPrimaryOwner || seat.HoldsPlanWork || seat.HoldsAssignWork),
        _ => false,
    };

    /// <summary>The plot rows of <paramref name="task"/> a covering seat sees, or <c>null</c> when he covers none of its place.</summary>
    private static IReadOnlyList<Guid>? CoveredRows(PlannedWorkSeat seat, PlannedWork task)
    {
        var live = task.LivePlots.Select(p => p.PlotId).ToList();
        if (live.Count > 0)
        {
            var mine = seat.ChosenPlotIds is { } chosen ? live.Where(chosen.Contains).ToList() : live;
            return mine.Count > 0 ? mine : null;
        }

        if (task.SourcePlotId is { } plot)
        {
            return seat.ChosenPlotIds is null || seat.ChosenPlotIds.Contains(plot) ? [] : null;
        }

        return seat.ChosenPlotIds is null ? [] : null;
    }
}
