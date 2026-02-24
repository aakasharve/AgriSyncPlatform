using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;

public sealed class GetPlotFinanceSummaryHandler(IShramSafalRepository repository)
{
    public async Task<Result<PlotFinanceSummaryDto>> HandleAsync(GetPlotFinanceSummaryQuery query, CancellationToken ct = default)
    {
        if (query.PlotId == Guid.Empty)
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

        var costEntries = await repository.GetCostEntriesAsync(query.FromDate, query.ToDate, ct);
        var directCosts = decimal.Round(
            costEntries
                .Where(entry => entry.PlotId == query.PlotId)
                .Sum(entry => entry.Amount),
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
