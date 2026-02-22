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
        if (query.CropCycleId == Guid.Empty)
        {
            return Result.Failure<IReadOnlyList<PlannedActivityDto>>(ShramSafalErrors.InvalidCommand);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(query.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure<IReadOnlyList<PlannedActivityDto>>(ShramSafalErrors.CropCycleNotFound);
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
                x.CreatedAtUtc))
            .ToList();

        return Result.Success<IReadOnlyList<PlannedActivityDto>>(result);
    }
}

