// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c / D-24a, D-26, D-29, D-79; E4).
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.PlannedWork;

/// <summary>
/// <c>plannedwork.create</c> (push and any REST caller): make a task or reminder.
/// <list type="number">
/// <item>The shape of the command (ids, the words) - a broken one is <see cref="ShramSafalErrors.PlannedWorkInvalid"/>.</item>
/// <item>The farm's seat: the sender must read this farm (<see cref="ShramSafalErrors.Forbidden"/>).</item>
/// <item>A repeat of the same task id by the same maker on this farm is the task already kept (a replay is a no-op).</item>
/// <item>Who may: a personal reminder any Active member; work for someone else the primary owner or AssignWork (D-24).</item>
/// <item>Where and who: every plot is this farm's (E4: the shared gate), the sender covers every plot (MU-4), the assignee is
/// an Active member whose seat covers every plot.</item>
/// <item>The day it was made is the farm-local day (D-29). The status, the maker and the clocks are the server's.</item>
/// </list>
/// A headcount, quantity or pay choice creates nothing but these words (D-24a, P4).
/// </summary>
public sealed class CreatePlannedWorkHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<PlannedWorkDto>> HandleAsync(CreatePlannedWorkCommand command, CancellationToken ct = default)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty
            || command.Caller is null || command.Caller.ActorUserId == Guid.Empty || command.Details is null)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        var seat = await PlannedWorkSeats.OfAsync(repository, command.FarmId, actor, now, ct);
        if (!seat.Active)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        // A repeat by the same maker is the task he already made - however it has changed since.
        if (await repository.GetPlannedWorkByIdAsync(command.PlannedWorkId, ct) is { } existing)
        {
            return (Guid)existing.FarmId == command.FarmId && existing.CreatedByUserId == actor
                ? Result.Success(await PlannedWorkDoor.DtoAsync(repository, existing, seat, ct))
                : Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        // Fix round 1 (L003): every plot must be this farm's BEFORE any authority is asked (E4: the shared gate).
        if (await PlannedWorkDoor.RefuseForeignPlotsAsync(repository, command.FarmId, command.Details, ct) is { } foreignPlot)
        {
            return Result.Failure<PlannedWorkDto>(foreignPlot);
        }

        if (!PlannedWorkAuthority.MayMake(seat, command.Details.AssigneeUserId))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        if (await PlannedWorkDoor.RefuseWhereAndWhoAsync(repository, command.FarmId, actor, command.Details, true, now, ct) is { } refusal)
        {
            return Result.Failure<PlannedWorkDto>(refusal);
        }

        if (PlannedWorkDoor.ResolveRecordedOn(command.RecordedOn, now) is not { } recordedOn)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        Domain.Planning.PlannedWork work;
        try
        {
            work = Domain.Planning.PlannedWork.Create(
                command.PlannedWorkId,
                new FarmId(command.FarmId),
                command.Details,
                PlannedWorkSource.Planning,
                command.SourceKind ?? PlannedWorkSourceKind.PlanForm,
                recordedOn,
                actor,
                now);
        }
        catch (ArgumentException)
        {
            // A shape the record forbids (a date and a loose word, crew words without a person, a headcount of 0...): the bytes
            // are the bytes, never retried.
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        await repository.AddPlannedWorkAsync(work, ct);
        await PlannedWorkDoor.AuditAsync(repository, work, "Created", command.Caller, ct);
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}

/// <summary>
/// <c>plannedwork.edit</c>: change when, where, who and what - a full replace of the words, plus a reassign. A task of another
/// farm, a made-up id and a task the sender may not see are all not found (E4). Who may: the maker while he still holds what he
/// used to make it, or the primary owner / PlanWork for someone else's task; moving it to another person also needs
/// AssignWork (<see cref="PlannedWorkAuthority.MayEdit"/>). A reassign sends the task to the new assignee and names a
/// withdrawal to the old one (the pull). A closed task takes no edit.
/// </summary>
public sealed class EditPlannedWorkHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<PlannedWorkDto>> HandleAsync(EditPlannedWorkCommand command, CancellationToken ct = default)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty
            || command.Caller is null || command.Caller.ActorUserId == Guid.Empty || command.Details is null)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        var (work, seat, refusal) = await PlannedWorkDoor.OpenAsync(
            repository, command.PlannedWorkId, command.FarmId, actor, now, mustSee: true, ct);
        if (refusal is not null || work is null)
        {
            return Result.Failure<PlannedWorkDto>(refusal ?? ShramSafalErrors.PlannedWorkNotFound);
        }

        if (work.IsClosed)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
        }

        // Fix round 1 (L003): the plots must be this farm's BEFORE any authority is asked.
        if (await PlannedWorkDoor.RefuseForeignPlotsAsync(repository, command.FarmId, command.Details, ct) is { } foreignPlot)
        {
            return Result.Failure<PlannedWorkDto>(foreignPlot);
        }

        if (!PlannedWorkAuthority.MayEdit(seat, work.CreatedByUserId, work.AssigneeUserId, command.Details.AssigneeUserId))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        var assigneeChanged = command.Details.AssigneeUserId != work.AssigneeUserId;
        var plotsChanged = !command.Details.PlotIds.OrderBy(p => p).SequenceEqual(work.LivePlots.Select(p => p.PlotId).OrderBy(p => p));
        if (await PlannedWorkDoor.RefuseWhereAndWhoAsync(
                repository, command.FarmId, actor, command.Details, assigneeChanged || plotsChanged, now, ct) is { } refused)
        {
            return Result.Failure<PlannedWorkDto>(refused);
        }

        // Lane L8c-3: a plot already Done on a half-done task stays on it; an edit cannot take it off (the work was done there).
        if (work.LivePlots.Any(p => p.Status == PlannedWorkPlotStatus.Done && !command.Details.PlotIds.Contains(p.PlotId)))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
        }

        try
        {
            work.Edit(command.Details, now);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        await PlannedWorkDoor.AuditAsync(repository, work, assigneeChanged ? "Reassigned" : "Edited", command.Caller, ct);
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}

/// <summary>
/// <c>plannedwork.seen</c> and <c>plannedwork.accept</c>: the assignee's answers, stamped once. Someone who is not the
/// assignee - the old one after a reassign included - is <see cref="ShramSafalErrors.Forbidden"/>, kept by his phone, visibly
/// (P10); a closed task is <see cref="ShramSafalErrors.PlannedWorkStateChanged"/>; a second answer is the same task, unchanged.
/// A task of another farm or a made-up id is not found (E4). A seat that reads nothing of the farm is Forbidden.
/// </summary>
public sealed class AnswerPlannedWorkHandler(IShramSafalRepository repository, IClock clock)
{
    public Task<Result<PlannedWorkDto>> SeenAsync(AnswerPlannedWorkCommand command, CancellationToken ct = default) =>
        AnswerAsync(command, accept: false, ct);

    public Task<Result<PlannedWorkDto>> AcceptAsync(AnswerPlannedWorkCommand command, CancellationToken ct = default) =>
        AnswerAsync(command, accept: true, ct);

    private async Task<Result<PlannedWorkDto>> AnswerAsync(AnswerPlannedWorkCommand command, bool accept, CancellationToken ct)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty
            || command.Caller is null || command.Caller.ActorUserId == Guid.Empty)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        // He needs no view of the task to be told "not yours": an old assignee is refused visibly (P10). A task of another
        // farm or a made-up id is still not found.
        var (work, seat, refusal) = await PlannedWorkDoor.OpenAsync(
            repository, command.PlannedWorkId, command.FarmId, actor, now, mustSee: false, ct);
        if (refusal is not null || work is null)
        {
            return Result.Failure<PlannedWorkDto>(refusal ?? ShramSafalErrors.PlannedWorkNotFound);
        }

        var step = accept ? work.Accept(actor, now) : work.MarkSeen(actor, now);
        switch (step)
        {
            case PlannedWorkStep.NotAssignee:
                return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
            case PlannedWorkStep.Closed:
                return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
            case PlannedWorkStep.AlreadyDone:
                return Result.Success(await PlannedWorkDoor.DtoAsync(repository, work, seat, ct));
        }

        await PlannedWorkDoor.AuditAsync(repository, work, accept ? "Accepted" : "Seen", command.Caller, ct);
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}

/// <summary>
/// <c>plannedwork.cancel</c>: stop the work. Not found for a task the sender may not see (E4). Who may: the maker while he
/// still holds what he used to make it, or the primary owner / PlanWork for someone else's task
/// (<see cref="PlannedWorkAuthority.MayCancel"/>). A task already cancelled stays as it was (a second cancel is the same
/// task); a done task cannot be cancelled. A cancel that loses a race with an answer is
/// <see cref="ShramSafalErrors.PlannedWorkStateChanged"/> and keeps nothing.
/// </summary>
public sealed class CancelPlannedWorkHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<PlannedWorkDto>> HandleAsync(CancelPlannedWorkCommand command, CancellationToken ct = default)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty
            || command.Caller is null || command.Caller.ActorUserId == Guid.Empty)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        var (work, seat, refusal) = await PlannedWorkDoor.OpenAsync(
            repository, command.PlannedWorkId, command.FarmId, actor, now, mustSee: true, ct);
        if (refusal is not null || work is null)
        {
            return Result.Failure<PlannedWorkDto>(refusal ?? ShramSafalErrors.PlannedWorkNotFound);
        }

        if (!PlannedWorkAuthority.MayCancel(seat, work.CreatedByUserId, work.AssigneeUserId))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        PlannedWorkStep step;
        try
        {
            step = work.Cancel(actor, command.Reason, now);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        switch (step)
        {
            case PlannedWorkStep.Closed:
                return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
            case PlannedWorkStep.AlreadyDone:
                return Result.Success(await PlannedWorkDoor.DtoAsync(repository, work, seat, ct));
        }

        await PlannedWorkDoor.AuditAsync(repository, work, "Cancelled", command.Caller, ct);
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}

/// <summary>
/// <c>plannedwork.complete</c> (lane L8c-3, founder D-24d / D-30 / D-1): the work was done, through the real log, plot by plot.
/// <list type="number">
/// <item>The seat reads the farm (<see cref="ShramSafalErrors.Forbidden"/>); a task of another farm or a made-up id is not found (E4).</item>
/// <item>WHO, before anything about the task's state: the assignee, or a reminder's maker
/// (<see cref="Domain.Planning.PlannedWork.MayComplete"/>); anyone else - the old assignee after a reassign included - is
/// <see cref="ShramSafalErrors.Forbidden"/>, kept by his phone, visibly (P10).</item>
/// <item>A cancelled task is <see cref="ShramSafalErrors.PlannedWorkStateChanged"/>; a task already Done answers as it stands
/// (a replay is a no-op, nothing is un-done).</item>
/// <item>Every plot named is a live plot of the task. Every log named exists on THIS farm and is one this person may see (else
/// it answers like a made-up log: <see cref="ShramSafalErrors.DailyLogNotFound"/>, which the phone waits on while the log is
/// still on its way), and is on one of the named plots (a task with no plots takes any log of the farm).</item>
/// <item>Handed-out work (an assignee other than its maker) needs at least one log, and every plot named needs a log on it. A
/// personal reminder may be done with no log (D-1).</item>
/// </list>
/// Nothing here creates or touches a job card, a cost entry, an attendance or a labour row (D-24a, P4): the step moves the
/// task's own rows and writes one audit row.
/// </summary>
public sealed class CompletePlannedWorkHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<PlannedWorkDto>> HandleAsync(CompletePlannedWorkCommand command, CancellationToken ct = default)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty
            || command.Caller is null || command.Caller.ActorUserId == Guid.Empty
            || command.PlotIds is null || command.DailyLogIds is null)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        if (command.DailyLogIds.Any(id => id == Guid.Empty)
            || command.DailyLogIds.Distinct().Count() != command.DailyLogIds.Count
            || command.DailyLogIds.Count > Domain.Planning.PlannedWork.MaxLinkedLogs)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        // He needs no view of the task to be told "not yours" (an old assignee, P10); another farm's task is still not found.
        var (work, seat, refusal) = await PlannedWorkDoor.OpenAsync(
            repository, command.PlannedWorkId, command.FarmId, actor, now, mustSee: false, ct);
        if (refusal is not null || work is null)
        {
            return Result.Failure<PlannedWorkDto>(refusal ?? ShramSafalErrors.PlannedWorkNotFound);
        }

        // WHO comes before the state of the task (the L8c-1 L005 lesson).
        if (!work.MayComplete(actor))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        if (work.Status == PlannedWorkStatus.Cancelled)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
        }

        if (work.Status == PlannedWorkStatus.Done)
        {
            return Result.Success(await PlannedWorkDoor.DtoAsync(repository, work, seat, ct));
        }

        var plotIds = command.PlotIds;
        var live = work.LivePlots.ToList();
        if (plotIds.Any(id => id == Guid.Empty)
            || plotIds.Distinct().Count() != plotIds.Count
            || plotIds.Any(id => live.All(p => p.PlotId != id))
            || (plotIds.Count == 0 && live.Any(p => p.Status == PlannedWorkPlotStatus.Pending)))
        {
            // A plot of another farm and a made-up plot are the same answer (E4).
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkPlotsInvalid);
        }

        var handedOut = !work.IsReminder;
        if (handedOut && command.DailyLogIds.Count == 0)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkLogInvalid);
        }

        var logsByPlot = plotIds.ToDictionary(id => id, _ => (IReadOnlyList<Guid>)[]);
        if (command.DailyLogIds.Count > 0)
        {
            var logs = (await repository.GetDailyLogsForFarmByIdsAsync(new FarmId(command.FarmId), command.DailyLogIds.ToList(), ct))
                .Where(l => (Guid)l.FarmId == command.FarmId)
                .ToDictionary(l => l.Id);
            var onPlots = new Dictionary<Guid, List<Guid>>();
            foreach (var logId in command.DailyLogIds)
            {
                if (!logs.TryGetValue(logId, out var log)
                    || !await RecordAudienceGate.MaySeeLogAsync(repository, log, actor, now, ct))
                {
                    // Not on this farm, made up, or one he may not see: all the same answer (E4, D-26).
                    return Result.Failure<PlannedWorkDto>(ShramSafalErrors.DailyLogNotFound);
                }

                if (live.Count == 0)
                {
                    continue;
                }

                var logPlots = log.PlotIds.Concat(log.PlotId is { } single ? [single] : []).ToHashSet();
                // The plots this step is about: the ones named, or - when none are (closing a task whose plots are all done) - its own.
                var named = (plotIds.Count > 0 ? plotIds : live.Select(p => p.PlotId).ToList()).Where(logPlots.Contains).ToList();
                if (named.Count == 0)
                {
                    return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkLogInvalid);
                }

                foreach (var plot in named)
                {
                    if (!onPlots.TryGetValue(plot, out var ids))
                    {
                        onPlots[plot] = ids = [];
                    }

                    ids.Add(logId);
                }
            }

            foreach (var (plot, ids) in onPlots)
            {
                logsByPlot[plot] = ids;
            }
        }

        if (handedOut && plotIds.Any(id => logsByPlot[id].Count == 0))
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkLogInvalid);
        }

        PlannedWorkStep step;
        try
        {
            step = work.Complete(actor, plotIds, logsByPlot, command.DailyLogIds, command.SomethingLeft, now);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkPlotsInvalid);
        }

        switch (step)
        {
            case PlannedWorkStep.NotAssignee:
                return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
            case PlannedWorkStep.Closed:
                return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
            case PlannedWorkStep.AlreadyDone:
                return Result.Success(await PlannedWorkDoor.DtoAsync(repository, work, seat, ct));
        }

        await PlannedWorkDoor.AuditAsync(repository, work, "Completed", command.Caller, ct);
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}

/// <summary>
/// <c>plannedwork.reopen</c> (lane L8c-3, founder D-24d, P3): the PRIMARY OWNER says the work was not done. Not found for a task
/// he may not see (E4); anyone but the primary owner is <see cref="ShramSafalErrors.Forbidden"/>. The reason is required
/// (<see cref="ShramSafalErrors.PlannedWorkInvalid"/> without one). A task that is not Done has nothing to reopen
/// (<see cref="ShramSafalErrors.PlannedWorkStateChanged"/>). The history is the audit row: the step and the reason.
/// </summary>
public sealed class ReopenPlannedWorkHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<PlannedWorkDto>> HandleAsync(ReopenPlannedWorkCommand command, CancellationToken ct = default)
    {
        if (command is null || command.PlannedWorkId == Guid.Empty || command.FarmId == Guid.Empty
            || command.Caller is null || command.Caller.ActorUserId == Guid.Empty)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        var now = clock.UtcNow;
        var actor = command.Caller.ActorUserId;
        var (work, seat, refusal) = await PlannedWorkDoor.OpenAsync(
            repository, command.PlannedWorkId, command.FarmId, actor, now, mustSee: true, ct);
        if (refusal is not null || work is null)
        {
            return Result.Failure<PlannedWorkDto>(refusal ?? ShramSafalErrors.PlannedWorkNotFound);
        }

        if (!seat.IsPrimaryOwner)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.Forbidden);
        }

        PlannedWorkStep step;
        try
        {
            step = work.Reopen(command.Reason, now);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkInvalid);
        }

        if (step != PlannedWorkStep.Applied)
        {
            return Result.Failure<PlannedWorkDto>(ShramSafalErrors.PlannedWorkStateChanged);
        }

        await PlannedWorkDoor.AuditAsync(repository, work, "Reopened", command.Caller, ct, command.Reason!.Trim());
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}
