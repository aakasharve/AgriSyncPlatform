using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.GetTodaysPlan;

public sealed class GetTodaysPlanHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<IReadOnlyList<PlannedActivityDto>>> HandleAsync(
        GetTodaysPlanQuery query,
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
        var targetDate = query.TargetDate ?? DateOnly.FromDateTime(clock.UtcNow);

        var derived = PlanDerivationEngine.DerivePlannedItemsForDay(template, cropCycle.StartDate, targetDate);
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

