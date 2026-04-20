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
/// Phase 3 MIS — migrates the Active <see cref="ScheduleSubscription"/> for a
/// (plot, crop, cycle) to a new template. Enforces invariants I-14 and I-15.
///
/// Atomic sequence (single EF <c>SaveChangesAsync</c> → single DB tx):
///   1. Load current Active subscription (fail if none).
///   2. Validate the new template (exists, published, crop matches).
///   3. Transition prev → <see cref="ScheduleSubscriptionState.Migrated"/>.
///   4. Insert new subscription in <see cref="ScheduleSubscriptionState.Active"/>
///      with <c>MigratedFromSubscriptionId = prev.Id</c>.
///   5. Insert <see cref="ScheduleMigrationEvent"/> (I-16 append-only).
///   6. Emit audit event + <c>schedule.migrated</c> analytics event.
///
/// The DB's partial unique index (I-14) is the ultimate safety net for
/// concurrent adoption/migration attempts: two concurrent callers cannot
/// both leave an Active row on the same (plotId, cropKey, cropCycleId).
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

        var gate = await EntitlementGate.CheckAsync<ScheduleSubscriptionDto>(
            entitlementPolicy, new UserId(command.ActorUserId), farmId,
            PaidFeature.CreatePlot, ct);
        if (gate is not null) return gate;

        var newTemplateId = new ScheduleTemplateId(command.NewScheduleTemplateId);
        var newTemplate = await repository.GetCropScheduleTemplateByIdAsync(newTemplateId, ct);
        if (newTemplate is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        if (!newTemplate.IsPublished)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateUnpublished);
        }

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();
        if (!string.Equals(newTemplate.CropKey, cropKey, StringComparison.Ordinal))
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateCropMismatch);
        }

        var prev = await repository.GetActiveScheduleSubscriptionAsync(
            command.PlotId, cropKey, command.CropCycleId, ct);
        if (prev is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        if (prev.State != ScheduleSubscriptionState.Active)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleNotActive);
        }

        var nowUtc = clock.UtcNow;
        var newSubscriptionId = new ScheduleSubscriptionId(
            command.NewSubscriptionId ?? idGenerator.New());

        // I-15: all four writes below happen inside the single EF SaveChangesAsync
        // transaction. If any step fails (including the I-14 partial unique index
        // race), the whole migration rolls back.
        prev.Migrate(newSubscriptionId, command.Reason, nowUtc);

        var newSubscription = ScheduleSubscription.Adopt(
            newSubscriptionId.Value,
            farmId,
            command.PlotId,
            command.CropCycleId,
            cropKey,
            newTemplateId,
            newTemplate.VersionTag,
            nowUtc);
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

        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "ScheduleSubscription",
                newSubscription.Id,
                "Migrated",
                command.ActorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    prevSubscriptionId = prev.Id,
                    newSubscriptionId = newSubscription.Id,
                    prevScheduleId = prev.ScheduleTemplateId.Value,
                    newScheduleId = newTemplate.Id,
                    reason = command.Reason.ToString(),
                    command.ReasonText,
                    complianceAtMigrationPct
                },
                command.ClientCommandId,
                nowUtc),
            ct);

        await repository.SaveChangesAsync(ct);

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

        return Result.Success(newSubscription.ToDto());
    }
}
