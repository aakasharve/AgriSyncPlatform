using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Schedules.AbandonSchedule;

/// <summary>
/// Phase 3 MIS — transitions one Active <see cref="ScheduleSubscription"/> of a plot-season to
/// <see cref="ScheduleSubscriptionState.Abandoned"/>. No new subscription is created. Emits <c>schedule.abandoned</c> analytics.
/// spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - a plot-season may follow several schedules, so the request says which
/// (<see cref="AbandonScheduleCommand.SubscriptionId"/>); without it the plot-season's one Active schedule is meant (P11), and
/// several without a name are refused (<c>ScheduleChoiceNeeded</c>), never an arbitrary row. See <see cref="Services.FollowedScheduleChoice"/>.
/// </summary>
public sealed class AbandonScheduleHandler(
    IShramSafalRepository repository,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
{
    public async Task<Result<ScheduleSubscriptionDto>> HandleAsync(
        AbandonScheduleCommand command,
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

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();
        var active = await repository.GetActiveScheduleSubscriptionsAsync(command.PlotId, command.CropCycleId, ct);
        var picked = await Services.FollowedScheduleChoice.PickAsync(
            repository, active, command.SubscriptionId, farmId, command.PlotId, command.CropCycleId, ct);
        if (!picked.IsSuccess)
        {
            return Result.Failure<ScheduleSubscriptionDto>(picked.Error);
        }

        var subscription = picked.Value;

        if (subscription.State != ScheduleSubscriptionState.Active)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleNotActive);
        }

        var nowUtc = clock.UtcNow;
        subscription.Abandon(nowUtc);

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleSubscription",
                entityId: subscription.Id,
                action: "Abandoned",
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    subscriptionId = subscription.Id,
                    plotId = command.PlotId,
                    cropCycleId = command.CropCycleId,
                    cropKey,
                    templateId = subscription.ScheduleTemplateId.Value,
                    command.ReasonText
                },
                farmId: command.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await Services.ScheduleChangeGate.FlagIfLateAsync(
            repository, decision, subscription.Id, "Abandoned", command.FarmId, command.ActorUserId, command.ActorRole ?? "unknown",
            clock.UtcNow, command.ClientCommandId, command.ClientAppVersion, command.AuditDeviceId, command.AuditIpHash, ct);

        await repository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.ScheduleAbandoned,
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
                templateId = subscription.ScheduleTemplateId.Value,
                hasReasonText = !string.IsNullOrWhiteSpace(command.ReasonText)
            })
        ), ct);

        return Result.Success(subscription.ToDto());
    }
}
