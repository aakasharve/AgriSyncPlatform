using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;

public sealed class ComputePlannedVsExecutedDeltaHandler(IShramSafalRepository repository)
{
    public async Task<Result<PlannedVsExecutedDeltaDto>> HandleAsync(
        ComputePlannedVsExecutedDeltaQuery query,
        CancellationToken ct = default)
    {
        if (query.CropCycleId == Guid.Empty)
        {
            return Result.Failure<PlannedVsExecutedDeltaDto>(ShramSafalErrors.InvalidCommand);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(query.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure<PlannedVsExecutedDeltaDto>(ShramSafalErrors.CropCycleNotFound);
        }

        var planned = await repository.GetPlannedActivitiesByCropCycleIdAsync(query.CropCycleId, ct);
        var executedTasks = await repository.GetExecutedTasksByCropCycleIdAsync(query.CropCycleId, ct);

        var plannedNames = planned
            .Select(p => p.ActivityName.Trim())
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var executedNames = executedTasks
            .Select(t => t.ActivityType.Trim())
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var executedSet = new HashSet<string>(executedNames, StringComparer.OrdinalIgnoreCase);
        var missing = plannedNames
            .Where(p => !executedSet.Contains(p))
            .OrderBy(x => x)
            .ToList();

        return Result.Success(new PlannedVsExecutedDeltaDto(
            query.CropCycleId,
            plannedNames,
            executedNames,
            missing));
    }
}

