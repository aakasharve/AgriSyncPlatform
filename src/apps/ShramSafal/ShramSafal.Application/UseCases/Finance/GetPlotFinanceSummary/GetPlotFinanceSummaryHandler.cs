using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;

/// <summary>One plot's money. lane MU-3 (founder D-22 / D-26): only for a seat that sees the farm's money.</summary>
public sealed class GetPlotFinanceSummaryHandler(IShramSafalRepository repository, IClock? clock = null)
{
    public async Task<Result<PlotFinanceSummaryDto>> HandleAsync(GetPlotFinanceSummaryQuery query, CancellationToken ct = default)
    {
        if (query.ActorUserId == Guid.Empty || query.PlotId == Guid.Empty)
        {
            return Result.Failure<PlotFinanceSummaryDto>(ShramSafalErrors.InvalidCommand);
        }

        if (query.FromDate is not null && query.ToDate is not null && query.FromDate > query.ToDate)
        {
            return Result.Failure<PlotFinanceSummaryDto>(ShramSafalErrors.InvalidCommand);
        }

        var plot = await repository.GetPlotByIdAsync(query.PlotId, ct);
        if (plot is null)
        {
            return Result.Failure<PlotFinanceSummaryDto>(ShramSafalErrors.PlotNotFound);
        }

        var canReadFarm = await repository.IsUserMemberOfFarmAsync((Guid)plot.FarmId, query.ActorUserId, ct);
        if (!canReadFarm
            || !await FarmReadGate.MaySeeMoneyAsync(
                repository, (Guid)plot.FarmId, query.ActorUserId, clock?.UtcNow ?? DateTime.UtcNow, ct))
        {
            return Result.Failure<PlotFinanceSummaryDto>(ShramSafalErrors.Forbidden);
        }

        var costEntries = (await repository.GetCostEntriesAsync(query.FromDate, query.ToDate, ct))
            .Where(entry => entry.PlotId == query.PlotId)
            .ToList();
        // lane OF-M fix pass 1 (review 9) — what each entry says NOW: its latest correction, else as made (₹0 = no longer
        // spent), the rule every other money reader follows.
        var latest = (await repository.GetCorrectionsForEntriesAsync(costEntries.Select(entry => entry.Id), ct))
            .GroupBy(correction => correction.CostEntryId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(correction => correction.CorrectedAtUtc).First().CorrectedAmount);
        var directCosts = decimal.Round(
            costEntries.Sum(entry => latest.TryGetValue(entry.Id, out var now) ? now : entry.Amount),
            2,
            MidpointRounding.AwayFromZero);

        var from = query.FromDate ?? DateOnly.MinValue;
        var to = query.ToDate ?? DateOnly.MaxValue;
        var ledgers = await repository.GetDayLedgersForFarm(plot.FarmId, from, to, ct);

        var allocatedCosts = decimal.Round(
            ledgers.Sum(ledger =>
                ledger.Allocations
                    .Where(allocation => allocation.PlotId == query.PlotId)
                    .Sum(allocation => allocation.AllocatedAmount)),
            2,
            MidpointRounding.AwayFromZero);

        return Result.Success(new PlotFinanceSummaryDto(
            query.PlotId,
            query.FromDate,
            query.ToDate,
            directCosts,
            allocatedCosts,
            decimal.Round(directCosts + allocatedCosts, 2, MidpointRounding.AwayFromZero)));
    }
}
