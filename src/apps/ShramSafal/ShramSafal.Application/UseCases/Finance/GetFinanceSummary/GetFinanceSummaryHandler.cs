using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.GetFinanceSummary;

public sealed class GetFinanceSummaryHandler(IShramSafalRepository repository)
{
    public async Task<Result<FinanceSummaryDto>> HandleAsync(GetFinanceSummaryQuery query, CancellationToken ct = default)
    {
        var normalizedGroupBy = NormalizeGroupBy(query.GroupBy);
        if (normalizedGroupBy is null)
        {
            return Result.Failure<FinanceSummaryDto>(ShramSafalErrors.InvalidCommand);
        }

        var entries = await repository.GetCostEntriesAsync(query.FromDate, query.ToDate, ct);
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
            grouped));
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

