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
                ? Result.Success(PlannedWorkDoor.Dto(existing, seat))
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
                return Result.Success(PlannedWorkDoor.Dto(work, seat));
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
                return Result.Success(PlannedWorkDoor.Dto(work, seat));
        }

        await PlannedWorkDoor.AuditAsync(repository, work, "Cancelled", command.Caller, ct);
        return await PlannedWorkDoor.SaveAsync(repository, work, seat, ct);
    }
}
