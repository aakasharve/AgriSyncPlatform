using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Schedules.CompleteSchedule;

/// <summary>
/// Phase 3 MIS — transitions the single Active <see cref="ScheduleSubscription"/>
/// for (plot, cropKey, cycle) to <see cref="ScheduleSubscriptionState.Completed"/>
/// when the crop cycle reaches its end. Emits <c>schedule.completed</c> analytics.
/// </summary>
public sealed class CompleteScheduleHandler(
    IShramSafalRepository repository,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
{
    public async Task<Result<ScheduleSubscriptionDto>> HandleAsync(
        CompleteScheduleCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.PlotId == Guid.Empty ||
            command.CropCycleId == Guid.Empty ||
            command.ActorUserId == Guid.Empty)
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

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();
        var subscription = await repository.GetActiveScheduleSubscriptionAsync(
            command.PlotId, cropKey, command.CropCycleId, ct);
        if (subscription is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        if (subscription.State != ScheduleSubscriptionState.Active)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleNotActive);
        }

        var nowUtc = clock.UtcNow;
        subscription.Complete(nowUtc);

        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "ScheduleSubscription",
                subscription.Id,
                "Completed",
                command.ActorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    subscriptionId = subscription.Id,
                    plotId = command.PlotId,
                    cropCycleId = command.CropCycleId,
                    cropKey,
                    templateId = subscription.ScheduleTemplateId.Value
                },
                command.ClientCommandId,
                nowUtc),
            ct);

        await repository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.ScheduleCompleted,
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
                subscriptionId = subscription.Id,
                plotId = command.PlotId,
                cropCycleId = command.CropCycleId,
                cropKey,
                templateId = subscription.ScheduleTemplateId.Value
            })
        ), ct);

        return Result.Success(subscription.ToDto());
    }
}
