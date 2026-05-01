using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;

/// <summary>
/// Creates a <see cref="Domain.Crops.CropCycle"/> on a (Farm, Plot) pair
/// with start/end dates and crop metadata.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateCropCycle): caller-shape validation
/// lives in <see cref="CreateCropCycleValidator"/>; farm-existence +
/// plot-existence-on-farm + farm-membership authorization lives in
/// <see cref="CreateCropCycleAuthorizer"/>. When this handler is
/// resolved via the pipeline, both run before the body. The body keeps
/// its inline gates (farm + plot lookup, membership, entitlement, cycle
/// overlap) as defense-in-depth for direct callers; those checks remain
/// the only gate when the pipeline is bypassed.
/// </para>
/// </summary>
public sealed class CreateCropCycleHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy)
    : IHandler<CreateCropCycleCommand, CropCycleDto>
{
    public async Task<Result<CropCycleDto>> HandleAsync(CreateCropCycleCommand command, CancellationToken ct = default)
    {
        var farmId = new FarmId(command.FarmId);

        if (command.FarmId == Guid.Empty ||
            command.PlotId == Guid.Empty ||
            command.ActorUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.CropName) ||
            string.IsNullOrWhiteSpace(command.Stage))
        {
            return Result.Failure<CropCycleDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.CropCycleId.HasValue && command.CropCycleId.Value == Guid.Empty)
        {
            return Result.Failure<CropCycleDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<CropCycleDto>(ShramSafalErrors.FarmNotFound);
        }

        var plot = await repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || plot.FarmId != farmId)
        {
            return Result.Failure<CropCycleDto>(ShramSafalErrors.PlotNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<CropCycleDto>(ShramSafalErrors.Forbidden);
        }

        // Phase 5 entitlement gate (PaidFeature.CreatePlot tier — crop
        // cycles live in the same setup-level entitlement as plots).
        var gate = await EntitlementGate.CheckAsync<CropCycleDto>(
            entitlementPolicy, new UserId(command.ActorUserId), farmId,
            PaidFeature.CreatePlot, ct);
        if (gate is not null) return gate;

        var requestedEndDate = command.EndDate ?? DateOnly.MaxValue;
        var overlappingCycleExists = (await repository.GetCropCyclesByPlotIdAsync(command.PlotId, ct))
            .Where(existing => !command.CropCycleId.HasValue || existing.Id != command.CropCycleId.Value)
            .Any(existing =>
            {
                var existingEndDate = existing.EndDate ?? DateOnly.MaxValue;
                return command.StartDate <= existingEndDate && existing.StartDate <= requestedEndDate;
            });

        if (overlappingCycleExists)
        {
            return Result.Failure<CropCycleDto>(ShramSafalErrors.CropCycleOverlap);
        }

        var nowUtc = clock.UtcNow;
        var cycle = Domain.Crops.CropCycle.Create(
            command.CropCycleId ?? idGenerator.New(),
            command.FarmId,
            command.PlotId,
            command.CropName,
            command.Stage,
            command.StartDate,
            command.EndDate,
            nowUtc);

        await repository.AddCropCycleAsync(cycle, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                command.FarmId,
                "CropCycle",
                cycle.Id,
                "Created",
                command.ActorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    cycle.Id,
                    command.FarmId,
                    command.PlotId,
                    cycle.CropName,
                    cycle.Stage,
                    cycle.StartDate,
                    cycle.EndDate
                },
                command.ClientCommandId,
                nowUtc),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(cycle.ToDto());
    }
}
