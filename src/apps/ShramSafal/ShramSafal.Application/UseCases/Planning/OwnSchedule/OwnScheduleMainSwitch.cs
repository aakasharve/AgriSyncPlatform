using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Planning.OwnSchedule;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>The plot-season an own-schedule change names, read and checked under the farm's scope, and the farm owner the gate trusted.</summary>
public sealed record OwnScheduleSeason(Guid FarmId, Guid PlotId, CropCycle Season, Guid OwnerUserId);

/// <summary>
/// The two things every own-schedule change shares: OPEN the plot-season (<see cref="OpenAsync"/>: the farm, the plot ON that farm, the crop season ON that plot,
/// then the own-schedule gate - E4, the child is checked, not only the parent) and MAKE MAIN (<see cref="FreezeAndSwitchAsync"/>: freeze a version from the
/// season's active works, write its day works for old phones, switch the plot's OWN place to it, carry the reminders he moved, mark the works - all STAGED in the
/// request's one unit of work, saved by the caller's one save inside the push's one transaction, so it all happens or none of it does).
/// </summary>
public sealed class OwnScheduleMainSwitch(
    IShramSafalRepository repository,
    IOwnScheduleStore store,
    IScheduleStepMoveStore moves,
    IIdGenerator idGenerator,
    IClock clock)
{
    /// <summary>The name a first make-main uses when the phone sends none.</summary>
    public const string DefaultName = "माझे वेळापत्रक";

    /// <summary>Opens the plot-season for <paramref name="callerUserId"/>; a plot or season that is not that farm's answers like one that does not exist.</summary>
    public async Task<Result<OwnScheduleSeason>> OpenAsync(Guid farmId, Guid plotId, Guid cropCycleId, Guid callerUserId, CancellationToken ct)
    {
        if (farmId == Guid.Empty || plotId == Guid.Empty || cropCycleId == Guid.Empty || callerUserId == Guid.Empty)
        {
            return Result.Failure<OwnScheduleSeason>(ShramSafalErrors.InvalidCommand);
        }

        if (await repository.GetPlotByIdAsync(plotId, ct) is not { } plot || (Guid)plot.FarmId != farmId)
        {
            return Result.Failure<OwnScheduleSeason>(ShramSafalErrors.PlotNotFound);
        }

        if (await repository.GetCropCycleByIdAsync(cropCycleId, ct) is not { } season || season.PlotId != plotId || (Guid)season.FarmId != farmId)
        {
            return Result.Failure<OwnScheduleSeason>(ShramSafalErrors.CropCycleNotFound);
        }

        // Who may write the farm's own schedule (the owner, or a seat holding "पीक वेळापत्रकाचे नमुने"); the owner id comes from the SAME farm row, never a body.
        var owner = await OwnScheduleGate.OwnerIfAllowedAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
        return owner is { } ownerId
            ? Result.Success(new OwnScheduleSeason(farmId, plotId, season, ownerId))
            : Result.Failure<OwnScheduleSeason>(ShramSafalErrors.Forbidden);
    }

    /// <summary>
    /// The own place (0) of this plot-season and the version it follows when that version was frozen from these works (else null: the plot follows something
    /// else in its own place - an own schedule made the old way, never converted by itself - or nothing).
    /// </summary>
    public async Task<(ScheduleSubscription? OwnPlace, ScheduleTemplate? FrozenFromWorks)> CurrentAsync(
        OwnScheduleSeason season, IReadOnlyList<OwnScheduleItem> works, CancellationToken ct)
    {
        var active = await repository.GetActiveScheduleSubscriptionsAsync(season.PlotId, season.Season.Id, ct);
        var ownPlace = active.FirstOrDefault(s => s.Origin == ScheduleOrigin.Own);
        if (ownPlace is null || !works.Any(w => w.MainVersionId == ownPlace.ScheduleTemplateId.Value))
        {
            return (ownPlace, null);
        }

        var version = await repository.GetScheduleTemplateWithTasksByIdAsync(ownPlace.ScheduleTemplateId.Value, ct);
        return (ownPlace, version);
    }

    /// <summary>
    /// Stages "make main" for <paramref name="season"/> from its <paramref name="works"/>. Returns the staged result, or the refusal; on a refusal NOTHING has been
    /// staged. The caller saves (<see cref="IShramSafalRepository.TrySaveScheduleSubscriptionAsync"/>) and answers a lost race.
    /// </summary>
    public async Task<Result<OwnScheduleMainResult>> FreezeAndSwitchAsync(
        OwnScheduleSeason season,
        IReadOnlyList<OwnScheduleItem> works,
        string? name,
        IReadOnlyList<OwnScheduleStage>? stages,
        OwnScheduleCaller caller,
        CancellationToken ct)
    {
        var now = clock.UtcNow;
        var (ownPlace, previous) = await CurrentAsync(season, works, ct);

        var newId = idGenerator.New();
        var frozen = ScheduleTemplate.FreezeOwn(
            newId,
            previous,
            name ?? (previous is null ? DefaultName : null),
            season.Season.CropName,
            new UserId(season.OwnerUserId),
            new UserId(caller.UserId),
            now,
            stages,
            works.Where(w => w.State == OwnScheduleItemState.Active).Select(w => w.Content).ToList(),
            out var problem);
        if (frozen is null)
        {
            return Result.Failure<OwnScheduleMainResult>(ShramSafalErrors.OwnScheduleInvalid(problem!.Code, problem.Message));
        }

        await repository.AddScheduleTemplateAsync(frozen, ct);

        // The plot's OWN place moves to the frozen version: the place it held is ended (Migrated) and a new one is taken in place 0, keeping its day 0.
        var newSubscriptionId = idGenerator.New();
        var cropKey = (season.Season.CropName ?? string.Empty).Trim().ToLowerInvariant();
        var place = ScheduleSubscription.Adopt(
            newSubscriptionId,
            new FarmId(season.FarmId),
            season.PlotId,
            season.Season.Id,
            cropKey,
            new ScheduleTemplateId(newId),
            $"v{frozen.Version}",
            now,
            ownPlace?.ReferenceDate,
            ScheduleOrigin.Own,
            checkStateAtAdopt: null,
            ScheduleSlots.OwnSlot);
        var carried = 0;
        if (ownPlace is not null)
        {
            ownPlace.Migrate(place.SubscriptionId, ScheduleMigrationReason.OwnerDirective, now);
            place.AttachMigratedFrom(ownPlace.SubscriptionId);
            await repository.AddScheduleMigrationEventAsync(
                ScheduleMigrationEvent.Record(
                    idGenerator.New(), ownPlace.SubscriptionId, place.SubscriptionId, ownPlace.ScheduleTemplateId, new ScheduleTemplateId(newId),
                    new FarmId(season.FarmId), season.PlotId, season.Season.Id, now, ScheduleMigrationReason.OwnerDirective, "ownschedule.make_main", 0m,
                    new UserId(caller.UserId)),
                ct);
            if (previous is not null)
            {
                carried = await CarryMovesAsync(ownPlace.Id, previous, place.Id, frozen, season.FarmId, ct);
            }
        }

        await repository.AddScheduleSubscriptionAsync(place, ct);

        foreach (var work in works)
        {
            work.MarkMainVersion(newId, now);
        }

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleSubscription",
                entityId: place.Id,
                action: "OwnScheduleMadeMain",
                actorUserId: caller.UserId,
                actorRole: caller.ActorRole,
                payload: new
                {
                    plotId = season.PlotId,
                    cropCycleId = season.Season.Id,
                    scheduleTemplateId = newId,
                    version = frozen.Version,
                    previousVersionId = previous?.Id,
                    previousSubscriptionId = ownPlace?.Id,
                    tasks = frozen.Tasks.Count,
                    storedActivities = frozen.Activities.Count,
                    remindersCarried = carried,
                },
                farmId: season.FarmId,
                clientCommandId: caller.ClientCommandId,
                appVersion: caller.ClientAppVersion,
                deviceId: caller.AuditDeviceId,
                ipHash: "sha256:unknown"),
            ct);

        return Result.Success(new OwnScheduleMainResult(
            newId, frozen.Version, place.Id, ownPlace?.Id, frozen.Tasks.Count, frozen.Activities.Count, carried));
    }

    /// <summary>
    /// The reminders he moved on the place being left ("पुढे ठरवा") travel to the new place: for each step (activity, schedule day) the LATEST move is written again
    /// for the new place and the activity of the SAME task (by its permanent key) in the new version. The old rows stay (history, P3). A step whose task is gone,
    /// or whose day changed, has nothing to carry.
    /// </summary>
    private async Task<int> CarryMovesAsync(
        Guid fromSubscriptionId, ScheduleTemplate from, Guid toSubscriptionId, ScheduleTemplate to, Guid farmId, CancellationToken ct)
    {
        var moved = await moves.GetForSubscriptionsAsync([fromSubscriptionId], ct);
        if (moved.Count == 0)
        {
            return 0;
        }

        var keyOfOld = from.ProjectedTaskKeyByActivity();
        var newOfKey = to.ProjectedTaskKeyByActivity().ToDictionary(p => p.Value, p => p.Key, StringComparer.Ordinal);
        var carried = 0;
        foreach (var latest in moved
                     .GroupBy(m => (m.TemplateActivityId, m.OriginalDate))
                     .Select(g => g.OrderBy(m => m.MovedAtUtc).ThenBy(m => m.Id).Last()))
        {
            if (keyOfOld.TryGetValue(latest.TemplateActivityId, out var key) && newOfKey.TryGetValue(key, out var newActivity))
            {
                moves.Stage(ScheduleStepMove.Create(
                    idGenerator.New(), new FarmId(farmId), toSubscriptionId, newActivity, latest.OriginalDate, latest.NewDate, latest.MovedByUserId, latest.MovedAtUtc));
                carried++;
            }
        }

        return carried;
    }

    /// <summary>The works of the season (tracked).</summary>
    public Task<IReadOnlyList<OwnScheduleItem>> WorksAsync(OwnScheduleSeason season, CancellationToken ct) =>
        store.GetSeasonAsync(season.PlotId, season.Season.Id, ct);
}
