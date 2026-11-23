using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Planning.OwnSchedule;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// The three doors of a farmer's own schedule. The push door opens the farm's scope (and refuses a non-member) and the switch refuses all three for a farm it is
// not on for; each handler then opens the plot-season (the plot on that farm, the season on that plot: E4) and asks the own-schedule gate. The owner of every
// row is the farm's owner read from the farm row, never a body. Saving a work never makes it main (review focus 2); after "हेच मुख्य करा", a change moves THAT
// plot to a new version by itself (SM-8), never another plot.

/// <summary><c>ownschedule.item.save</c>: the first save of a key makes the work; every later save of it is an edit (two phones, one key = one work).</summary>
public sealed class SaveOwnScheduleItemHandler(IShramSafalRepository repository, IOwnScheduleStore store, OwnScheduleMainSwitch main, IClock clock)
{
    public async Task<Result<OwnScheduleItemResult>> HandleAsync(SaveOwnScheduleItemCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.CropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<OwnScheduleItemResult>(opened.Error);
        }

        var season = opened.Value;
        var now = clock.UtcNow;
        var works = (await main.WorksAsync(season, ct)).ToList();
        var id = OwnScheduleItem.IdFor(season.Season.Id, command.Task.TaskKey);
        var work = works.FirstOrDefault(w => w.Id == id);
        OwnScheduleItemRevision? revision;
        if (work is null)
        {
            work = OwnScheduleItem.Create(
                new FarmId(season.FarmId), season.PlotId, season.Season.Id, new UserId(season.OwnerUserId), command.Task, new UserId(command.Caller.UserId), now,
                out revision, out var problem);
            if (work is null)
            {
                return Result.Failure<OwnScheduleItemResult>(ShramSafalErrors.OwnScheduleInvalid(problem!.Code, problem.Message));
            }

            store.Stage(work);
            works.Add(work);
        }
        else if (!work.Save(command.Task, new UserId(season.OwnerUserId), new UserId(command.Caller.UserId), now, out revision, out var problem))
        {
            return Result.Failure<OwnScheduleItemResult>(ShramSafalErrors.OwnScheduleInvalid(problem!.Code, problem.Message));
        }

        return await OwnScheduleChange.FinishAsync(repository, store, main, season, work, revision, works, command.Caller, "OwnScheduleItemSaved", now, ct);
    }
}

/// <summary><c>ownschedule.item.remove</c>: takes a work out (its row and history stay). Removing a removed work changes nothing and is applied.</summary>
public sealed class RemoveOwnScheduleItemHandler(IShramSafalRepository repository, IOwnScheduleStore store, OwnScheduleMainSwitch main, IClock clock)
{
    public async Task<Result<OwnScheduleItemResult>> HandleAsync(RemoveOwnScheduleItemCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (!ScheduleTaskContent.IsValidKey(command.TaskKey))
        {
            return Result.Failure<OwnScheduleItemResult>(ShramSafalErrors.OwnScheduleInvalid("ScheduleTaskKey", "The work's key is not a key."));
        }

        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.CropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<OwnScheduleItemResult>(opened.Error);
        }

        var season = opened.Value;
        var now = clock.UtcNow;
        var works = (await main.WorksAsync(season, ct)).ToList();
        var work = works.FirstOrDefault(w => w.Id == OwnScheduleItem.IdFor(season.Season.Id, command.TaskKey));
        if (work is null)
        {
            return Result.Failure<OwnScheduleItemResult>(ShramSafalErrors.OwnScheduleInvalid("OwnScheduleItemUnknown", "No work with this key was saved on this plot's season."));
        }

        work.Remove(new UserId(season.OwnerUserId), new UserId(command.Caller.UserId), now, out var revision);
        return await OwnScheduleChange.FinishAsync(repository, store, main, season, work, revision, works, command.Caller, "OwnScheduleItemRemoved", now, ct);
    }
}

/// <summary>
/// <c>ownschedule.make_main</c>: "हेच मुख्य करा" - the only act that makes the farmer's own schedule main (SM-6). Needs the right to change the plot's schedule
/// (<see cref="ScheduleChangeGate"/>) as well as the own-schedule gate, and at least one work.
/// </summary>
public sealed class MakeOwnScheduleMainHandler(
    IShramSafalRepository repository, OwnScheduleMainSwitch main, IEntitlementPolicy entitlementPolicy, IClock clock)
{
    public async Task<Result<OwnScheduleMainResult>> HandleAsync(MakeOwnScheduleMainCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var opened = await main.OpenAsync(command.FarmId, command.PlotId, command.CropCycleId, command.Caller.UserId, ct);
        if (!opened.IsSuccess)
        {
            return Result.Failure<OwnScheduleMainResult>(opened.Error);
        }

        var season = opened.Value;
        if (await ScheduleChangeGate.RefuseAsync(repository, season.FarmId, season.PlotId, command.Caller.UserId, clock.UtcNow, ct) is { } refused)
        {
            return Result.Failure<OwnScheduleMainResult>(refused);
        }

        // Making a schedule main is a setup act, tiered as adopting one is.
        var gate = await EntitlementGate.CheckAsync<OwnScheduleMainResult>(
            entitlementPolicy, new UserId(command.Caller.UserId), new FarmId(season.FarmId), PaidFeature.CreatePlot, ct);
        if (gate is not null)
        {
            return gate;
        }

        var works = await main.WorksAsync(season, ct);
        if (!works.Any(w => w.State == OwnScheduleItemState.Active))
        {
            return Result.Failure<OwnScheduleMainResult>(ShramSafalErrors.OwnScheduleInvalid("OwnScheduleEmpty", "Making it main needs at least one work."));
        }

        var made = await main.FreezeAndSwitchAsync(season, works, command.Name, command.Stages, command.Caller, ct);
        if (!made.IsSuccess)
        {
            return made;
        }

        return await repository.TrySaveScheduleSubscriptionAsync(ct) == ScheduleSubscriptionSave.Saved
            ? made
            : Result.Failure<OwnScheduleMainResult>(ShramSafalErrors.ScheduleChangedElsewhere);
    }
}

/// <summary>The end every save and removal share: stage the revision, move THAT plot when its own schedule is main, audit, save once.</summary>
internal static class OwnScheduleChange
{
    internal static async Task<Result<OwnScheduleItemResult>> FinishAsync(
        IShramSafalRepository repository,
        IOwnScheduleStore store,
        OwnScheduleMainSwitch main,
        OwnScheduleSeason season,
        OwnScheduleItem work,
        OwnScheduleItemRevision? revision,
        IReadOnlyList<OwnScheduleItem> works,
        OwnScheduleCaller caller,
        string action,
        DateTime now,
        CancellationToken ct)
    {
        if (revision is null)
        {
            // Nothing changed (the same content again, or a removed work removed again): applied, nothing written.
            return Result.Success(ResultOf(work, null, null, null));
        }

        store.Stage(revision);

        // SM-8: after "हेच मुख्य करा" a change moves THIS plot to a new version by itself. The work is saved whether or not the plot can move (P9): a rule that
        // refuses the version (a safety gap shortened, a stage the version lacks) or a person who may not change the plot's schedule leaves it where it is, and says so.
        Guid? movedTo = null;
        string? notMoved = null;
        var (_, frozenFrom) = await main.CurrentAsync(season, works, ct);
        if (frozenFrom is not null)
        {
            if (await ScheduleChangeGate.RefuseAsync(repository, season.FarmId, season.PlotId, caller.UserId, now, ct) is { } refusal)
            {
                notMoved = refusal.Code;
            }
            else
            {
                var moved = await main.FreezeAndSwitchAsync(season, works, null, null, caller, ct);
                if (moved.IsSuccess)
                {
                    movedTo = moved.Value.ScheduleTemplateId;
                }
                else
                {
                    notMoved = moved.Error.Description;
                }
            }
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "OwnScheduleItem",
                entityId: work.Id,
                action: action,
                actorUserId: caller.UserId,
                actorRole: caller.ActorRole,
                payload: new
                {
                    plotId = work.PlotId,
                    cropCycleId = work.CropCycleId,
                    taskKey = work.TaskKey,
                    revision = work.Revision,
                    contentHash = work.ContentHash,
                    movedToVersionId = movedTo,
                    notMoved,
                },
                farmId: season.FarmId,
                clientCommandId: caller.ClientCommandId,
                appVersion: caller.ClientAppVersion,
                deviceId: caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);

        if (movedTo is not null)
        {
            if (await repository.TrySaveScheduleSubscriptionAsync(ct) != ScheduleSubscriptionSave.Saved)
            {
                // A rival changed the plot's places first: nothing of this change was kept; the phone sends it again.
                return Result.Failure<OwnScheduleItemResult>(ShramSafalErrors.ScheduleChangedElsewhere);
            }
        }
        else
        {
            await repository.SaveChangesAsync(ct);
        }

        return Result.Success(ResultOf(work, revision.Id, movedTo, notMoved));
    }

    private static OwnScheduleItemResult ResultOf(OwnScheduleItem work, Guid? revisionId, Guid? movedTo, string? notMoved) =>
        new(
            work.Id,
            work.TaskKey,
            work.Revision,
            work.State == OwnScheduleItemState.Active ? "active" : "removed",
            work.ContentHash,
            revisionId,
            work.MainVersionId,
            movedTo,
            notMoved);
}
