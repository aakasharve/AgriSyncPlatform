using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Schedules.AdoptSchedule;

public sealed class AdoptScheduleHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy)
{
    public async Task<Result<ScheduleSubscriptionDto>> HandleAsync(
        AdoptScheduleCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.PlotId == Guid.Empty ||
            command.CropCycleId == Guid.Empty ||
            command.ScheduleTemplateId == Guid.Empty ||
            command.ActorUserId == Guid.Empty)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.SubscriptionId.HasValue && command.SubscriptionId.Value == Guid.Empty)
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

        // Phase 5 entitlement gate — schedule adoption is a setup-level
        // operation, tiered with PaidFeature.CreatePlot.
        var gate = await EntitlementGate.CheckAsync<ScheduleSubscriptionDto>(
            entitlementPolicy, new UserId(command.ActorUserId), farmId,
            PaidFeature.CreatePlot, ct);
        if (gate is not null) return gate;

        var templateId = new ScheduleTemplateId(command.ScheduleTemplateId);
        var template = await repository.GetCropScheduleTemplateByIdAsync(templateId, ct);
        if (template is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        if (!template.IsPublished)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateUnpublished);
        }

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();
        if (!string.Equals(template.CropKey, cropKey, StringComparison.Ordinal))
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateCropMismatch);
        }

        // Invariant I-14: at most one Active subscription per (plot, cropKey, cycle).
        var existingActive = await repository.GetActiveScheduleSubscriptionAsync(
            command.PlotId, cropKey, command.CropCycleId, ct);
        if (existingActive is not null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
        }

        var nowUtc = clock.UtcNow;
        var subscription = ScheduleSubscription.Adopt(
            command.SubscriptionId ?? idGenerator.New(),
            farmId,
            command.PlotId,
            command.CropCycleId,
            cropKey,
            templateId,
            template.VersionTag,
            nowUtc);

        await repository.AddScheduleSubscriptionAsync(subscription, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "ScheduleSubscription",
                subscription.Id,
                "Adopted",
                command.ActorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    subscriptionId = subscription.Id,
                    farmId = command.FarmId,
                    plotId = command.PlotId,
                    cropCycleId = command.CropCycleId,
                    cropKey,
                    templateId = template.Id,
                    templateKey = template.TemplateKey,
                    versionTag = template.VersionTag
                },
                command.ClientCommandId,
                nowUtc),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(subscription.ToDto());
    }
}
