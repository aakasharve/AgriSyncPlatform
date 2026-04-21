using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.GetStagePlan;

public sealed class GetStagePlanHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<IReadOnlyList<PlannedActivityDto>>> HandleAsync(
        GetStagePlanQuery query,
        CancellationToken ct = default)
    {
        if (query.ActorUserId == Guid.Empty || query.CropCycleId == Guid.Empty)
        {
            return Result.Failure<IReadOnlyList<PlannedActivityDto>>(ShramSafalErrors.InvalidCommand);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(query.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure<IReadOnlyList<PlannedActivityDto>>(ShramSafalErrors.CropCycleNotFound);
        }

        var canReadFarm = await repository.IsUserMemberOfFarmAsync((Guid)cropCycle.FarmId, query.ActorUserId, ct);
        if (!canReadFarm)
        {
            return Result.Failure<IReadOnlyList<PlannedActivityDto>>(ShramSafalErrors.Forbidden);
        }

        var plannedActivities = await repository.GetPlannedActivitiesByCropCycleIdAsync(query.CropCycleId, ct);
        var template = PlanTemplateFactory.BuildProjectedTemplate(cropCycle, plannedActivities, clock.UtcNow);

        var stageName = string.IsNullOrWhiteSpace(query.StageFilter)
            ? PlanDerivationEngine.GetCurrentStage(
                template,
                DateOnly.FromDateTime(clock.UtcNow).DayNumber - cropCycle.StartDate.DayNumber)
            : query.StageFilter.Trim();

        var derived = PlanDerivationEngine.DerivePlannedItemsForStage(
            template,
            cropCycle.StartDate,
            stageName);

        var result = derived
            .Select(x => new PlannedActivityDto(
                x.Id,
                query.CropCycleId,
                x.ActivityName,
                x.Stage,
                x.PlannedDate,
                x.CreatedAtUtc,
                x.ModifiedAtUtc,
                SourceTemplateActivityId: null,
                OverrideMarkers: null))
            .ToList();

        return Result.Success<IReadOnlyList<PlannedActivityDto>>(result);
    }
}

