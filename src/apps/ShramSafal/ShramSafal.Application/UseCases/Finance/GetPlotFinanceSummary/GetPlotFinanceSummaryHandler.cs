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

        // spec: plr-d10 lane MU-4 (§11.6) — a plot he does not cover is not his to total (Forbidden, never a 0).
        var readScope = await FarmReadGate.ScopeAsync(
            repository, (Guid)plot.FarmId, query.ActorUserId, clock?.UtcNow ?? DateTime.UtcNow, ct);
        if (readScope is null || !readScope.CoversPlot(query.PlotId))
        {
            return Result.Failure<PlotFinanceSummaryDto>(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 lane PRV (founder D-26) — only the money records he may see; the rest are counted out loud (W4).
        var visibility = await RecordVisibility.ForFarmAsync(
            repository, (Guid)plot.FarmId, query.ActorUserId, clock?.UtcNow ?? DateTime.UtcNow, ct);
        var plotEntries = (await repository.GetCostEntriesAsync(query.FromDate, query.ToDate, ct))
            .Where(entry => entry.PlotId == query.PlotId)
            .ToList();
        var costEntries = plotEntries.Where(entry => visibility.MaySeeCost(entry.Id)).ToList();
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
        var farmLedgers = await repository.GetDayLedgersForFarm(plot.FarmId, from, to, ct);
        // lane MU-4 (D-39) — a bill split across plots counts here by ITS SHARE on this plot (RecordVisibility.Ledger): the
        // share lines he may see, never the whole bill; a bill kept by its audience not at all (PRV).
        var ledgers = farmLedgers
            .Select(ledger => visibility.Ledger(ledger.ToDto()))
            .Where(ledger => ledger is not null)
            .ToList();

        var allocatedCosts = decimal.Round(
            ledgers.Sum(ledger =>
                ledger!.Allocations
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
            decimal.Round(directCosts + allocatedCosts, 2, MidpointRounding.AwayFromZero),
            // lane MU-4 — "not counted by rule" (W4) is the AUDIENCE's alone; this plot is his, so nothing of it is out of place.
            RecordsNotCounted: plotEntries.Count(entry => visibility.HiddenByAudience(Domain.RecordPrivacy.RecordKinds.CostEntry, entry.Id))
                + farmLedgers.Count(ledger => visibility.HiddenByAudience(Domain.RecordPrivacy.RecordKinds.CostEntry, ledger.SourceCostEntryId)
                    && ledger.Allocations.Any(allocation => allocation.PlotId == query.PlotId))));
    }
}
