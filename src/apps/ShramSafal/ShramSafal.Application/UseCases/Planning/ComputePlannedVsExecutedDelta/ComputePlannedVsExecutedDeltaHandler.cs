using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;

namespace ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;

public sealed class ComputePlannedVsExecutedDeltaHandler(IShramSafalRepository repository)
{
    public async Task<Result<StageComparisonResult>> HandleAsync(
        ComputePlannedVsExecutedDeltaQuery query,
        CancellationToken ct = default)
    {
        if (query.CropCycleId == Guid.Empty)
        {
            return Result.Failure<StageComparisonResult>(ShramSafalErrors.InvalidCommand);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(query.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure<StageComparisonResult>(ShramSafalErrors.CropCycleNotFound);
        }

        var planned = await repository.GetPlannedActivitiesByCropCycleIdAsync(query.CropCycleId, ct);
        var executedTasks = await repository.GetExecutedTasksByCropCycleIdAsync(query.CropCycleId, ct);

        var stageName = ResolveStageName(query.Stage, cropCycle.Stage, planned);
        var stagePlanned = planned
            .Where(p => string.Equals(p.Stage, stageName, StringComparison.OrdinalIgnoreCase))
            .ToList();

        DateOnly? stageStartDate = null;
        DateOnly? stageEndDate = null;
        if (stagePlanned.Count > 0)
        {
            stageStartDate = stagePlanned.Min(p => p.PlannedDate);
            stageEndDate = stagePlanned.Max(p => p.PlannedDate);
        }

        var stageExecuted = executedTasks;
        if (stageStartDate is not null && stageEndDate is not null)
        {
            stageExecuted = executedTasks
                .Where(t =>
                {
                    var taskDate = DateOnly.FromDateTime(t.OccurredAtUtc);
                    return taskDate >= stageStartDate.Value && taskDate <= stageEndDate.Value;
                })
                .ToList();
        }

        var stageComparison = CompareEngine.ComputeStageComparison(stagePlanned, stageExecuted, stageName);

        var startDay = stageStartDate is null
            ? 0
            : stageStartDate.Value.DayNumber - cropCycle.StartDate.DayNumber;

        var endDay = stageEndDate is null
            ? 0
            : stageEndDate.Value.DayNumber - cropCycle.StartDate.DayNumber;

        return Result.Success(stageComparison with
        {
            StartDay = startDay,
            EndDay = endDay
        });
    }

    private static string ResolveStageName(
        string? requestedStage,
        string cropCycleStage,
        IReadOnlyCollection<Domain.Planning.PlannedActivity> planned)
    {
        if (!string.IsNullOrWhiteSpace(requestedStage))
        {
            return requestedStage.Trim();
        }

        var cropStageMatch = planned
            .FirstOrDefault(p => string.Equals(p.Stage, cropCycleStage, StringComparison.OrdinalIgnoreCase));
        if (cropStageMatch is not null)
        {
            return cropStageMatch.Stage;
        }

        return planned
            .OrderBy(p => p.PlannedDate)
            .Select(p => p.Stage)
            .FirstOrDefault(s => !string.IsNullOrWhiteSpace(s))
            ?? cropCycleStage;
    }
}

