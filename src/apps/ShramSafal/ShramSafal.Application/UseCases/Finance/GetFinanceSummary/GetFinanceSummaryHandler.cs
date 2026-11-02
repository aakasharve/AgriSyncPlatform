using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.GetFinanceSummary;

/// <summary>
/// The caller's money summary across his farms. lane MU-3 (founder D-22 / D-26): only the farms where he
/// sees money (<see cref="FarmReadScope.SeeMoney"/>) are counted; none at all = Forbidden, never a ₹0.
/// </summary>
public sealed class GetFinanceSummaryHandler(IShramSafalRepository repository, IClock? clock = null)
{
    public async Task<Result<FinanceSummaryDto>> HandleAsync(GetFinanceSummaryQuery query, CancellationToken ct = default)
    {
        if (query.ActorUserId == Guid.Empty)
        {
            return Result.Failure<FinanceSummaryDto>(ShramSafalErrors.InvalidCommand);
        }

        var normalizedGroupBy = NormalizeGroupBy(query.GroupBy);
        if (normalizedGroupBy is null)
        {
            return Result.Failure<FinanceSummaryDto>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock?.UtcNow ?? DateTime.UtcNow;
        var memberFarmIds = await repository.GetFarmIdsForUserAsync(query.ActorUserId, ct);
        var accesses = await repository.GetFarmAccessesForUserAsync(query.ActorUserId, memberFarmIds, ct);
        var farmIds = memberFarmIds
            .Where(id => FarmReadScope.Of(id, accesses.GetValueOrDefault(id), now)?.SeeMoney == true)
            .ToList();

        if (farmIds.Count == 0)
        {
            return Result.Failure<FinanceSummaryDto>(ShramSafalErrors.Forbidden);
        }

        var farmEntries = (await repository.GetCostEntriesAsync(query.FromDate, query.ToDate, ct))
            .Where(entry => farmIds.Contains((Guid)entry.FarmId))
            .ToList();
        // spec: plr-d10 lane PRV (founder D-26) — a total counts only the money records he may see; how many it left out
        // is said (W4), never hidden in a smaller number.
        var visibility = await RecordVisibility.ForFarmsAsync(repository, farmIds, query.ActorUserId, now, ct);
        // spec: plr-d10 lane MU-4 (§11.6) — a seat that covers chosen plots counts his plots' money only (labelled so on the
        // phone: ScopedToPlots); his own submissions elsewhere are his to see, never part of "his plots'" total.
        var plotScopes = farmIds
            .Select(id => FarmReadScope.Of(id, accesses.GetValueOrDefault(id), now))
            .Where(s => s?.PlotIds is not null && !s.IsPrimaryAccountHolder)
            .ToDictionary(s => s!.FarmId, s => s!);
        var entries = farmEntries
            .Where(entry => visibility.MaySeeCost(entry.Id))
            .Where(entry => !plotScopes.TryGetValue((Guid)entry.FarmId, out var plotScope)
                || (entry.PlotId is { } plotId && plotScope.CoversPlot(plotId)))
            .ToList();
        var corrections = await repository.GetCorrectionsForEntriesAsync(entries.Select(e => e.Id), ct);

        var latestCorrections = corrections
            .GroupBy(c => c.CostEntryId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(c => c.CorrectedAtUtc).First());

        var correctionCounts = corrections
            .GroupBy(c => c.CostEntryId)
            .ToDictionary(g => g.Key, g => g.Count());

        var normalizedRows = entries.Select(entry =>
        {
            var hasCorrection = latestCorrections.TryGetValue(entry.Id, out var latestCorrection);
            var effectiveAmount = hasCorrection ? latestCorrection!.CorrectedAmount : entry.Amount;
            var correctionsCount = correctionCounts.TryGetValue(entry.Id, out var count) ? count : 0;

            return new
            {
                GroupKey = BuildGroupKey(normalizedGroupBy, entry),
                EffectiveAmount = effectiveAmount,
                CorrectionsCount = correctionsCount
            };
        }).ToList();

        // spec: plr-d10 lane MU-4 fix pass 1 (L3, D-39) — "his plots'" total is the SAME number /finance/plot-summary gives:
        // a bill split across plots counts by its share lines on his plots (RecordVisibility.Ledger: never the whole bill,
        // a bill kept by its audience not at all), exactly as the plot summary adds them.
        foreach (var (farmId, plotScope) in plotScopes)
        {
            var farmLedgers = await repository.GetDayLedgersForFarm(
                new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId),
                query.FromDate ?? DateOnly.MinValue,
                query.ToDate ?? DateOnly.MaxValue,
                ct);
            foreach (var ledger in farmLedgers.Select(l => visibility.Ledger(l.ToDto())).Where(l => l is not null))
            {
                normalizedRows.AddRange(ledger!.Allocations
                    .Where(share => plotScope.CoversPlot(share.PlotId))
                    .Select(share => new
                    {
                        GroupKey = normalizedGroupBy switch
                        {
                            "plot" => share.PlotId.ToString(),
                            "crop" => "unassigned-crop",
                            _ => ledger.LedgerDate.ToString("yyyy-MM-dd"),
                        },
                        EffectiveAmount = share.AllocatedAmount,
                        CorrectionsCount = 0,
                    }));
            }
        }

        var grouped = normalizedRows
            .GroupBy(x => x.GroupKey)
            .Select(g => new FinanceSummaryItemDto(
                g.Key,
                decimal.Round(g.Sum(x => x.EffectiveAmount), 2, MidpointRounding.AwayFromZero),
                g.Count(),
                g.Sum(x => x.CorrectionsCount)))
            .OrderBy(i => i.GroupKey)
            .ToList();

        var grandTotal = decimal.Round(grouped.Sum(i => i.TotalAmount), 2, MidpointRounding.AwayFromZero);
        var currencyCode = entries.FirstOrDefault()?.CurrencyCode ?? "INR";

        return Result.Success(new FinanceSummaryDto(
            normalizedGroupBy,
            query.FromDate,
            query.ToDate,
            currencyCode,
            grandTotal,
            grouped,
            FarmsNotCounted: memberFarmIds.Count - farmIds.Count,
            // lane MU-4 — only a record kept by its AUDIENCE is "not counted by rule" (W4); one outside his plots is not his.
            // lane MU-4 fix pass 1 (M4) — and only one he would see by its place (never another plot's private money).
            RecordsNotCounted: farmEntries.Count(entry =>
                visibility.HiddenByAudience(Domain.RecordPrivacy.RecordKinds.CostEntry, entry.Id)
                && !visibility.IsOutOfPlace(Domain.RecordPrivacy.RecordKinds.CostEntry, entry.Id)),
            ScopedToPlots: plotScopes.Count > 0));
    }

    private static string? NormalizeGroupBy(string groupBy)
    {
        var normalized = groupBy.Trim().ToLowerInvariant();
        return normalized switch
        {
            "day" => "day",
            "plot" => "plot",
            "crop" => "crop",
            _ => null
        };
    }

    private static string BuildGroupKey(string groupBy, Domain.Finance.CostEntry entry)
    {
        return groupBy switch
        {
            "day" => entry.EntryDate.ToString("yyyy-MM-dd"),
            "plot" => entry.PlotId?.ToString() ?? "unassigned-plot",
            "crop" => entry.CropCycleId?.ToString() ?? "unassigned-crop",
            _ => entry.EntryDate.ToString("yyyy-MM-dd")
        };
    }
}
