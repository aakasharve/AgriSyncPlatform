using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

public sealed class AddCostEntryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<CostEntryDto>> HandleAsync(AddCostEntryCommand command, CancellationToken ct = default)
    {
        var farmId = new FarmId(command.FarmId);

        if (command.FarmId == Guid.Empty ||
            command.CreatedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Category) ||
            command.Amount <= 0)
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.CostEntryId.HasValue && command.CostEntryId.Value == Guid.Empty)
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<CostEntryDto>(ShramSafalErrors.FarmNotFound);
        }

        if (command.PlotId is not null)
        {
            var plot = await repository.GetPlotByIdAsync(command.PlotId.Value, ct);
            if (plot is null || plot.FarmId != farmId)
            {
                return Result.Failure<CostEntryDto>(ShramSafalErrors.PlotNotFound);
            }
        }

        if (command.CropCycleId is not null)
        {
            var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId.Value, ct);
            if (cropCycle is null || cropCycle.FarmId != farmId)
            {
                return Result.Failure<CostEntryDto>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        var entry = Domain.Finance.CostEntry.Create(
            command.CostEntryId ?? idGenerator.New(),
            command.FarmId,
            command.PlotId,
            command.CropCycleId,
            command.Category,
            command.Description,
            command.Amount,
            command.CurrencyCode,
            command.EntryDate,
            command.CreatedByUserId,
            clock.UtcNow);

        await repository.AddCostEntryAsync(entry, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(entry.ToDto());
    }
}
