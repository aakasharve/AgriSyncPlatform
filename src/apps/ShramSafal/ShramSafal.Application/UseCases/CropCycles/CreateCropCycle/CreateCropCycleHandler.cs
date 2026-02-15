using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;

public sealed class CreateCropCycleHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<CropCycleDto>> HandleAsync(CreateCropCycleCommand command, CancellationToken ct = default)
    {
        var farmId = new FarmId(command.FarmId);

        if (command.FarmId == Guid.Empty ||
            command.PlotId == Guid.Empty ||
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

        var cycle = Domain.Crops.CropCycle.Create(
            command.CropCycleId ?? idGenerator.New(),
            command.FarmId,
            command.PlotId,
            command.CropName,
            command.Stage,
            command.StartDate,
            command.EndDate,
            clock.UtcNow);

        await repository.AddCropCycleAsync(cycle, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(cycle.ToDto());
    }
}
