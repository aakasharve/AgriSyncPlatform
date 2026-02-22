using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;

public sealed class AllocateGlobalExpenseHandler(
    IShramSafalRepository repository,
    IAuthorizationEnforcer authorizationEnforcer,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<DayLedgerDto>> HandleAsync(AllocateGlobalExpenseCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.RequestedByUserId == Guid.Empty ||
            command.CostEntryIds is null ||
            command.CostEntryIds.Count == 0 ||
            command.CostEntryIds.Any(id => id == Guid.Empty))
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.InvalidCommand);
        }

        var farmId = new FarmId(command.FarmId);
        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.FarmNotFound);
        }

        await authorizationEnforcer.EnsureIsOwner(new UserId(command.RequestedByUserId), farmId);

        var plots = await repository.GetPlotsByFarmIdAsync(command.FarmId, ct);
        if (plots.Count == 0)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.PlotNotFound);
        }

        var distinctCostEntryIds = command.CostEntryIds.Distinct().ToList();
        var costEntries = await repository.GetCostEntriesByIdsAsync(distinctCostEntryIds, ct);
        if (costEntries.Count != distinctCostEntryIds.Count || costEntries.Any(entry => entry.FarmId != farmId))
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.CostEntryNotFound);
        }

        var totalCost = decimal.Round(costEntries.Sum(x => x.Amount), 2, MidpointRounding.AwayFromZero);
        var allocations = ExpenseAllocationPolicy.CalculateAllocations(
            plots.Select(p => (p.Id, p.AreaInAcres)).ToList(),
            totalCost,
            command.Strategy,
            command.CustomAllocations is null ? null : new Dictionary<Guid, decimal>(command.CustomAllocations));

        var ledger = await repository.GetDayLedger(farmId, command.DateKey, ct);
        if (ledger is null)
        {
            ledger = DayLedger.Create(
                command.DayLedgerId ?? idGenerator.New(),
                farmId,
                command.DateKey,
                command.Strategy,
                clock.UtcNow);

            await repository.AddDayLedgerAsync(ledger, ct);
        }

        ledger.ReplaceAllocations(distinctCostEntryIds, allocations, totalCost);
        await repository.SaveChangesAsync(ct);

        return Result.Success(ledger.ToDto());
    }
}
