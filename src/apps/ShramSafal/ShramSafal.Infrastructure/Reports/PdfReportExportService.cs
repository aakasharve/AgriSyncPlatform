using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Reports;

public sealed class PdfReportExportService(IShramSafalRepository repository) : IReportExportService
{
    private static readonly string[] ExpectedCategories =
    [
        "Labour",
        "Seeds",
        "Fertilizer",
        "Pesticide",
        "Equipment",
        "Fuel"
    ];

    public async Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, CancellationToken ct)
    {
        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        var plots = await repository.GetPlotsByFarmIdAsync(farmId, ct);
        var logs = await repository.GetDailyLogsForFarmByDateRangeAsync(farmId, date, date, ct);
        var costEntries = await repository.GetCostEntriesForFarmByDateRangeAsync(farmId, date, date, ct);
        var corrections = await repository.GetCorrectionsForEntriesAsync(costEntries.Select(x => x.Id), ct);

        var plotNames = plots.ToDictionary(x => x.Id, x => x.Name);
        var effectiveCosts = BuildEffectiveCosts(costEntries, corrections);

        var activityRows = BuildDailyActivityRows(logs, plotNames);
        var costRows = effectiveCosts
            .GroupBy(x => x.Entry.Category, StringComparer.OrdinalIgnoreCase)
            .Select(group => new DailySummaryReport.CostRow(
                group.Key,
                decimal.Round(group.Sum(x => x.EffectiveAmount), 2, MidpointRounding.AwayFromZero)))
            .OrderBy(x => x.Category)
            .ToList();

        var verificationRows = logs
            .OrderBy(x => x.LogDate)
            .ThenBy(x => x.CreatedAtUtc)
            .Select(log =>
            {
                var lastEvent = log.VerificationEvents
                    .OrderByDescending(x => x.OccurredAtUtc)
                    .FirstOrDefault();

                return new DailySummaryReport.VerificationRow(
                    ResolvePlotName(plotNames, log.PlotId),
                    log.CurrentVerificationStatus.ToString(),
                    (lastEvent?.OccurredAtUtc ?? log.CreatedAtUtc).ToString("yyyy-MM-dd HH:mm:ss"));
            })
            .ToList();

        var model = new DailySummaryReport.Data(
            farm?.Name ?? "Unknown Farm",
            date,
            "Weather data is not available in the current ledger snapshot.",
            AttachedReceiptCount: 0,
            ActivityRows: activityRows,
            CostRows: costRows,
            VerificationRows: verificationRows,
            GeneratedAtUtc: DateTime.UtcNow);

        return DailySummaryReport.Generate(model);
    }

    public async Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, CancellationToken ct)
    {
        var startDate = new DateOnly(year, month, 1);
        var endDate = startDate.AddMonths(1).AddDays(-1);

        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        var plots = await repository.GetPlotsByFarmIdAsync(farmId, ct);
        var costEntries = await repository.GetCostEntriesForFarmByDateRangeAsync(farmId, startDate, endDate, ct);
        var corrections = await repository.GetCorrectionsForEntriesAsync(costEntries.Select(x => x.Id), ct);

        var plotNames = plots.ToDictionary(x => x.Id, x => x.Name);
        var effectiveCosts = BuildEffectiveCosts(costEntries, corrections);

        var perPlotRows = effectiveCosts
            .GroupBy(x => x.Entry.PlotId)
            .Select(group =>
            {
                var direct = decimal.Round(group.Sum(x => x.EffectiveAmount), 2, MidpointRounding.AwayFromZero);
                const decimal allocated = 0m;
                return new MonthlyCostReport.PlotCostRow(
                    ResolvePlotName(plotNames, group.Key),
                    direct,
                    allocated,
                    direct + allocated);
            })
            .OrderBy(x => x.PlotName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var categoryTotals = effectiveCosts
            .GroupBy(x => NormalizeCategory(x.Entry.Category), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => decimal.Round(group.Sum(x => x.EffectiveAmount), 2, MidpointRounding.AwayFromZero),
                StringComparer.OrdinalIgnoreCase);

        foreach (var expectedCategory in ExpectedCategories)
        {
            categoryTotals.TryAdd(expectedCategory, 0m);
        }

        var categoryRows = categoryTotals
            .OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase)
            .Select(x => new MonthlyCostReport.CategoryCostRow(x.Key, x.Value))
            .ToList();

        var dailyRows = BuildDailyCostRows(startDate, endDate, effectiveCosts);

        var flaggedRows = effectiveCosts
            .Where(x => x.Entry.IsFlagged)
            .OrderBy(x => x.Entry.EntryDate)
            .ThenBy(x => ResolvePlotName(plotNames, x.Entry.PlotId), StringComparer.OrdinalIgnoreCase)
            .Select(x => new MonthlyCostReport.FlaggedEntryRow(
                x.Entry.EntryDate,
                ResolvePlotName(plotNames, x.Entry.PlotId),
                x.Entry.Category,
                decimal.Round(x.EffectiveAmount, 2, MidpointRounding.AwayFromZero),
                x.Entry.FlagReason ?? "Flagged"))
            .ToList();

        var grandTotal = decimal.Round(effectiveCosts.Sum(x => x.EffectiveAmount), 2, MidpointRounding.AwayFromZero);

        var model = new MonthlyCostReport.Data(
            farm?.Name ?? "Unknown Farm",
            year,
            month,
            perPlotRows,
            categoryRows,
            dailyRows,
            flaggedRows,
            grandTotal,
            DateTime.UtcNow);

        return MonthlyCostReport.Generate(model);
    }

    public async Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, CancellationToken ct)
    {
        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        var plots = await repository.GetPlotsByFarmIdAsync(farmId, ct);
        var logs = await repository.GetDailyLogsForFarmByDateRangeAsync(farmId, fromDate, toDate, ct);

        var plotNames = plots.ToDictionary(x => x.Id, x => x.Name);

        var logRows = logs
            .OrderBy(x => x.LogDate)
            .ThenBy(x => x.CreatedAtUtc)
            .Select(log =>
            {
                var latestEvent = log.VerificationEvents
                    .OrderByDescending(x => x.OccurredAtUtc)
                    .FirstOrDefault();

                var taskSummary = log.Tasks.Count == 0
                    ? "No tasks logged"
                    : string.Join(", ", log.Tasks.Select(x => x.ActivityType).Distinct(StringComparer.OrdinalIgnoreCase));

                return new VerificationReport.LogRow(
                    log.LogDate,
                    ResolvePlotName(plotNames, log.PlotId),
                    taskSummary,
                    log.CurrentVerificationStatus.ToString(),
                    latestEvent?.VerifiedByUserId.ToString() ?? "-",
                    (latestEvent?.OccurredAtUtc ?? log.CreatedAtUtc).ToString("yyyy-MM-dd HH:mm:ss"));
            })
            .ToList();

        var summary = new VerificationReport.SummaryRow(
            TotalLogs: logs.Count,
            VerifiedCount: logs.Count(x => x.CurrentVerificationStatus == VerificationStatus.Verified),
            DisputedCount: logs.Count(x => x.CurrentVerificationStatus == VerificationStatus.Disputed),
            PendingCount: logs.Count(x =>
                x.CurrentVerificationStatus is VerificationStatus.Draft or VerificationStatus.Confirmed or VerificationStatus.CorrectionPending));

        var correctionRows = BuildCorrectionRows(logs, plotNames);

        var model = new VerificationReport.Data(
            farm?.Name ?? "Unknown Farm",
            fromDate,
            toDate,
            logRows,
            summary,
            correctionRows,
            DateTime.UtcNow);

        return VerificationReport.Generate(model);
    }

    private static List<DailySummaryReport.ActivityRow> BuildDailyActivityRows(
        IEnumerable<DailyLog> logs,
        IReadOnlyDictionary<Guid, string> plotNames)
    {
        var rows = new List<DailySummaryReport.ActivityRow>();

        foreach (var log in logs.OrderBy(x => x.LogDate).ThenBy(x => x.CreatedAtUtc))
        {
            if (log.Tasks.Count == 0)
            {
                rows.Add(new DailySummaryReport.ActivityRow(
                    ResolvePlotName(plotNames, log.PlotId),
                    "No task",
                    "No task details provided.",
                    "-"));
                continue;
            }

            foreach (var task in log.Tasks.OrderBy(x => x.OccurredAtUtc))
            {
                rows.Add(new DailySummaryReport.ActivityRow(
                    ResolvePlotName(plotNames, log.PlotId),
                    task.ActivityType,
                    string.IsNullOrWhiteSpace(task.Notes) ? "-" : task.Notes!,
                    "-"));
            }
        }

        return rows;
    }

    private static List<MonthlyCostReport.DailyCostRow> BuildDailyCostRows(
        DateOnly startDate,
        DateOnly endDate,
        IReadOnlyList<EffectiveCost> effectiveCosts)
    {
        var totalsByDate = effectiveCosts
            .GroupBy(x => x.Entry.EntryDate)
            .ToDictionary(
                group => group.Key,
                group => decimal.Round(group.Sum(x => x.EffectiveAmount), 2, MidpointRounding.AwayFromZero));

        var rows = new List<MonthlyCostReport.DailyCostRow>();
        var current = startDate;
        while (current <= endDate)
        {
            totalsByDate.TryGetValue(current, out var total);
            rows.Add(new MonthlyCostReport.DailyCostRow(current, total));
            current = current.AddDays(1);
        }

        return rows;
    }

    private static List<VerificationReport.CorrectionRow> BuildCorrectionRows(
        IEnumerable<DailyLog> logs,
        IReadOnlyDictionary<Guid, string> plotNames)
    {
        var rows = new List<VerificationReport.CorrectionRow>();

        foreach (var log in logs)
        {
            var ordered = log.VerificationEvents
                .OrderBy(x => x.OccurredAtUtc)
                .ToList();

            for (var i = 1; i < ordered.Count; i++)
            {
                var previous = ordered[i - 1];
                var current = ordered[i];

                rows.Add(new VerificationReport.CorrectionRow(
                    log.LogDate,
                    ResolvePlotName(plotNames, log.PlotId),
                    previous.Status.ToString(),
                    current.Status.ToString(),
                    string.IsNullOrWhiteSpace(current.Reason)
                        ? "Status transition"
                        : current.Reason!));
            }
        }

        return rows;
    }

    private static string ResolvePlotName(IReadOnlyDictionary<Guid, string> plotNames, Guid? plotId)
    {
        if (plotId is null)
        {
            return "Unassigned";
        }

        return plotNames.TryGetValue(plotId.Value, out var name) ? name : $"Plot-{plotId.Value:N}";
    }

    private static IReadOnlyList<EffectiveCost> BuildEffectiveCosts(
        IReadOnlyList<CostEntry> costEntries,
        IReadOnlyList<FinanceCorrection> corrections)
    {
        var latestCorrectionByEntryId = corrections
            .GroupBy(x => x.CostEntryId)
            .ToDictionary(
                group => group.Key,
                group => group.OrderByDescending(x => x.CorrectedAtUtc).First());

        return costEntries
            .Select(entry =>
            {
                var effectiveAmount = latestCorrectionByEntryId.TryGetValue(entry.Id, out var correction)
                    ? correction.CorrectedAmount
                    : entry.Amount;

                return new EffectiveCost(entry, effectiveAmount);
            })
            .ToList();
    }

    private static string NormalizeCategory(string category)
    {
        if (string.IsNullOrWhiteSpace(category))
        {
            return "Uncategorized";
        }

        var normalized = category.Trim().ToLowerInvariant();
        if (normalized.Contains("labour"))
        {
            return "Labour";
        }

        if (normalized.Contains("seed"))
        {
            return "Seeds";
        }

        if (normalized.Contains("fertilizer"))
        {
            return "Fertilizer";
        }

        if (normalized.Contains("pesticide"))
        {
            return "Pesticide";
        }

        if (normalized.Contains("equipment") || normalized.Contains("machinery"))
        {
            return "Equipment";
        }

        if (normalized.Contains("fuel"))
        {
            return "Fuel";
        }

        return category.Trim();
    }

    private sealed record EffectiveCost(CostEntry Entry, decimal EffectiveAmount);
}
