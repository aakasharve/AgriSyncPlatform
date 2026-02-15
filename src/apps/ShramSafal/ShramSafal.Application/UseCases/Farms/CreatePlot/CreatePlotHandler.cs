using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

public sealed class CreatePlotHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<PlotDto>> HandleAsync(CreatePlotCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty || string.IsNullOrWhiteSpace(command.Name) || command.AreaInAcres <= 0)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.PlotId.HasValue && command.PlotId.Value == Guid.Empty)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<PlotDto>(ShramSafalErrors.FarmNotFound);
        }

        var plot = Domain.Farms.Plot.Create(
            command.PlotId ?? idGenerator.New(),
            command.FarmId,
            command.Name,
            command.AreaInAcres,
            clock.UtcNow);

        await repository.AddPlotAsync(plot, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(plot.ToDto());
    }
}
