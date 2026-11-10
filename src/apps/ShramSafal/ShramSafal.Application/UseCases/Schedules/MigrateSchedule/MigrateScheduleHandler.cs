using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Schedules.MigrateSchedule;

/// <summary>
/// Phase 3 MIS — migrates one Active <see cref="ScheduleSubscription"/> of a plot-season to a new template. Enforces invariant I-15
/// and, since lane L8b-3 (founder D-74, "3 + 1"), the places rule that replaced I-14: a plot-season follows up to 3 outside schedules
/// plus 1 of his own, each in its own place, and never the same schedule twice.
///
/// Which one is switched: the one named by <see cref="MigrateScheduleCommand.FromSubscriptionId"/>; without it the plot-season's one
/// Active schedule (P11), and several without a name are refused (<c>ScheduleChoiceNeeded</c>). The new row keeps the old row's place
/// when it is the same kind of schedule (outside or his own), else takes the lowest free place of its kind.
///
/// Atomic sequence (single EF <c>SaveChangesAsync</c> → single DB tx):
///   1. Load the plot-season's Active subscriptions and pick the one to switch (fail if none).
///   2. Validate the new template (exists, published, crop matches).
///   3. Transition prev → <see cref="ScheduleSubscriptionState.Migrated"/>.
///   4. Insert new subscription in <see cref="ScheduleSubscriptionState.Active"/>
///      with <c>MigratedFromSubscriptionId = prev.Id</c>.
///   5. Insert <see cref="ScheduleMigrationEvent"/> (I-16 append-only).
///   6. Emit audit event + <c>schedule.migrated</c> analytics event.
///
/// The DB's partial unique indexes (<c>ux_sched_sub_active_slot</c>, <c>ux_sched_sub_active_template</c>) are the ultimate safety net
/// for concurrent adoption/migration attempts: two concurrent callers cannot both hold one place of a plot-season, nor follow one
/// schedule twice.
/// </summary>
public sealed class MigrateScheduleHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
{
    public async Task<Result<ScheduleSubscriptionDto>> HandleAsync(
        MigrateScheduleCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.PlotId == Guid.Empty ||
            command.CropCycleId == Guid.Empty ||
            command.NewScheduleTemplateId == Guid.Empty ||
            command.ActorUserId == Guid.Empty)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.InvalidCommand);
        }

        if ((command.NewSubscriptionId.HasValue && command.NewSubscriptionId.Value == Guid.Empty) ||
            (command.MigrationEventId.HasValue && command.MigrationEventId.Value == Guid.Empty))
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.InvalidCommand);
        }

        var farmId = new FarmId(command.FarmId);

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.FarmNotFound);
        }

        var plot = await repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || plot.FarmId != farmId)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.PlotNotFound);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId, ct);
        if (cropCycle is null || cropCycle.PlotId != command.PlotId)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.CropCycleNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 lane L8b-1 Task 3 (founder D-73) — who may change a plot's schedule: the primary owner, or a seat the
        // owner gave "कामाचं नियोजन करणे" (PlanWork), with the MU-4 plot rule inside the gate. A change made offline before
        // the authority ended counts inside the late window and is flagged for the owner below (MU design §11.2).
        var decision = await Services.ScheduleChangeGate.DecideAsync(
            repository, command.FarmId, command.PlotId, command.ActorUserId, clock.UtcNow, command.DecidedAtUtc, ct);
        if (decision.Refusal is { } refused)
        {
            return Result.Failure<ScheduleSubscriptionDto>(refused);
        }

        var gate = await EntitlementGate.CheckAsync<ScheduleSubscriptionDto>(
            entitlementPolicy, new UserId(command.ActorUserId), farmId,
            PaidFeature.CreatePlot, ct);
        if (gate is not null) return gate;

        // spec: plr-d10 lane L8b-1 Task 1 — the new schedule comes from the library the phone lists (ScheduleLibrary), as
        // adopt does; one he may not see answers like an unknown id (E4); the crop rule is the phone's own.
        var newTemplateId = new ScheduleTemplateId(command.NewScheduleTemplateId);
        // spec: plr-d10 lane L8b-1F - what this plot's farm may follow and the check rule are decided in ScheduleLibrary.ChooseAsync, as
        // adopt does (R8: a switch to a newer Checked version is allowed; a Withdrawn one the plot follows stays Active meanwhile).
        var choice = await new Services.ScheduleLibrary(repository).ChooseAsync(
            command.NewScheduleTemplateId, command.ActorUserId, farm.OwnerUserId.Value, cropCycle.CropName, carryOver: false, ct);
        if (!choice.IsSuccess)
        {
            return Result.Failure<ScheduleSubscriptionDto>(choice.Error);
        }

        var newTemplate = choice.Value.Template;

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();

        var active = await repository.GetActiveScheduleSubscriptionsAsync(command.PlotId, command.CropCycleId, ct);
        if (active.Count == 0)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        ScheduleSubscription prev;
        if (command.FromSubscriptionId is { } from)
        {
            // spec: plr-d10 lane L8b-2 fix round 1 (B006) - the caller named the choice he is switching FROM. If it is not one of the
            // plot-season's Active ones, someone changed it first (another phone, offline): refuse, write nothing, never overwrite
            // silently. L8b-3: it may be any ONE of several followed schedules.
            var named = active.FirstOrDefault(s => s.Id == from);
            if (named is null)
            {
                return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleChangedElsewhere);
            }

            prev = named;
        }
        else if (active.Count == 1)
        {
            prev = active[0]; // P11: no phone before this lane names one
        }
        else
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleChoiceNeeded);
        }

        // spec: plr-d10 lane L8b-3 - the schedule he is switching TO is already followed in ANOTHER place: never the same one twice.
        if (active.Any(s => s.Id != prev.Id && s.ScheduleTemplateId == newTemplateId))
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
        }

        // The new row keeps the old row's place when it is the same kind of schedule; else the lowest free place of its kind (the old
        // place counted free), else the limit of that kind.
        var origin = choice.Value.Origin;
        var others = active.Where(s => s.Id != prev.Id).ToList();
        short? slot;
        if ((prev.Origin ?? ScheduleOrigin.Outside) == origin && prev.Slot is { } keptPlace)
        {
            slot = keptPlace;
        }
        else
        {
            var ofThisKind = others.Count(s => (s.Origin == ScheduleOrigin.Own) == (origin == ScheduleOrigin.Own));
            var maxOfKind = origin == ScheduleOrigin.Own ? ScheduleSlots.MaxOwnSchedulesPerPlot : ScheduleSlots.MaxOutsideSchedulesPerPlot;
            slot = ofThisKind >= maxOfKind
                ? null
                : ScheduleSlots.NextFree(origin, others.Where(s => s.Slot.HasValue).Select(s => s.Slot!.Value));
        }

        if (slot is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(
                origin == ScheduleOrigin.Own ? ShramSafalErrors.OwnScheduleLimitReached : ShramSafalErrors.ScheduleLimitReached);
        }

        var nowUtc = clock.UtcNow;
        var newSubscriptionId = new ScheduleSubscriptionId(
            command.NewSubscriptionId ?? idGenerator.New());

        // I-15: all four writes below happen inside the single EF SaveChangesAsync
        // transaction. If any step fails (including a lost race for the place, the
        // places unique index), the whole migration rolls back.
        prev.Migrate(newSubscriptionId, command.Reason, nowUtc);

        var newSubscription = ScheduleSubscription.Adopt(
            newSubscriptionId.Value,
            farmId,
            command.PlotId,
            command.CropCycleId,
            cropKey,
            newTemplateId,
            Services.ScheduleLibrary.VersionTagOf(newTemplate),
            nowUtc,
            // my call (L8b-1): a switch that names no day 0 keeps the plot's day 0 — the day is the plot's, not the
            // schedule's, so switching schedules never silently loses it (P10).
            command.ReferenceDate ?? prev.ReferenceDate,
            choice.Value.Origin,
            choice.Value.CheckStateAtAdopt,
            slot);
        newSubscription.AttachMigratedFrom(prev.SubscriptionId);

        // Phase 4 will populate this from ScheduleComplianceSnapshot rollups.
        // For now the plan (§2.6 step 2) says "0 if no snapshots yet".
        const decimal complianceAtMigrationPct = 0m;

        var migrationEvent = ScheduleMigrationEvent.Record(
            command.MigrationEventId ?? idGenerator.New(),
            prev.SubscriptionId,
            newSubscriptionId,
            prev.ScheduleTemplateId,
            newTemplateId,
            farmId,
            command.PlotId,
            command.CropCycleId,
            nowUtc,
            command.Reason,
            command.ReasonText,
            complianceAtMigrationPct,
            new UserId(command.ActorUserId));

        await repository.AddScheduleSubscriptionAsync(newSubscription, ct);
        await repository.AddScheduleMigrationEventAsync(migrationEvent, ct);

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Migration emits a single "Migrated" audit row
        // (the prev → new transition is captured atomically in the payload's
        // prevSubscriptionId / newSubscriptionId pair plus the I-16
        // ScheduleMigrationEvent record); both views share the same forensic
        // provenance from this command.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleSubscription",
                entityId: newSubscription.Id,
                action: "Migrated",
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    prevSubscriptionId = prev.Id,
                    newSubscriptionId = newSubscription.Id,
                    prevScheduleId = prev.ScheduleTemplateId.Value,
                    newScheduleId = newTemplate.Id,
                    reason = command.Reason.ToString(),
                    command.ReasonText,
                    complianceAtMigrationPct,
                    slot
                },
                farmId: command.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await Services.ScheduleChangeGate.FlagIfLateAsync(
            repository, decision, newSubscription.Id, "Migrated", command.FarmId, command.ActorUserId, command.ActorRole ?? "unknown",
            clock.UtcNow, command.ClientCommandId, command.ClientAppVersion, command.AuditDeviceId, command.AuditIpHash, ct);

        switch (await repository.TrySaveScheduleSubscriptionAsync(ct))
        {
            case ScheduleSubscriptionSave.Saved:
                break;
            case ScheduleSubscriptionSave.TemplateAlreadyFollowed:
                return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
            default:
                // A rival took the place first: the plot-season's schedules were changed from another phone. Nothing was kept.
                return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleChangedElsewhere);
        }

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.ScheduleMigrated,
            OccurredAtUtc: nowUtc,
            ActorUserId: new UserId(command.ActorUserId),
            FarmId: farmId,
            OwnerAccountId: null,
            ActorRole: (command.ActorRole ?? "unknown").ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                prevSubscriptionId = prev.Id,
                newSubscriptionId = newSubscription.Id,
                prevScheduleId = prev.ScheduleTemplateId.Value,
                newScheduleId = newTemplate.Id,
                cropKey,
                reasonCode = command.Reason.ToString(),
                complianceAtMigrationPct
            })
        ), ct);

        return Result.Success(newSubscription.ToDto(choice.Value.Origin == ScheduleOrigin.Own ? null : choice.Value.LiveCheckState.ToString()));
    }
}
