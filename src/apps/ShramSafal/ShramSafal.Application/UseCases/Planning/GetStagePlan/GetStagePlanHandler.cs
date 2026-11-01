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

        // lane MU-3 fix 1 (review item 12) — the farm's plan is its overview: a कामगार seat (his own records only)
        // is not shown it, exactly as the pull withholds planned work (FarmReadScope.SeeFarmOverview).
        var scope = await Services.FarmReadGate.ScopeAsync(
            repository, (Guid)cropCycle.FarmId, query.ActorUserId, clock.UtcNow, ct);
        if (scope is not { SeeFarmOverview: true })
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

