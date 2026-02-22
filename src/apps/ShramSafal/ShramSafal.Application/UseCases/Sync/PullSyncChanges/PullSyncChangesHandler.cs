using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

public sealed class PullSyncChangesHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<SyncPullResponseDto>> HandleAsync(PullSyncChangesQuery query, CancellationToken ct = default)
    {
        var serverNowUtc = clock.UtcNow;
        var sinceUtc = NormalizeCursor(query.SinceUtc, serverNowUtc);

        var farms = await repository.GetFarmsChangedSinceAsync(sinceUtc, ct);
        var plots = await repository.GetPlotsChangedSinceAsync(sinceUtc, ct);
        var cropCycles = await repository.GetCropCyclesChangedSinceAsync(sinceUtc, ct);
        var dailyLogs = await repository.GetDailyLogsChangedSinceAsync(sinceUtc, ct);
        var costEntries = await repository.GetCostEntriesChangedSinceAsync(sinceUtc, ct);
        var financeCorrections = await repository.GetFinanceCorrectionsChangedSinceAsync(sinceUtc, ct);
        var priceConfigs = await repository.GetPriceConfigsChangedSinceAsync(sinceUtc, ct);
        var attachments = await repository.GetAttachmentsChangedSinceAsync(sinceUtc, ct);
        var dayLedgers = await repository.GetDayLedgersChangedSinceAsync(sinceUtc, ct);
        var plannedActivities = await repository.GetPlannedActivitiesChangedSinceAsync(sinceUtc, ct);

        var nextCursorUtc = ComputeNextCursor(
            sinceUtc,
            farms,
            plots,
            cropCycles,
            dailyLogs,
            costEntries,
            financeCorrections,
            priceConfigs,
            attachments,
            dayLedgers,
            plannedActivities);

        var response = new SyncPullResponseDto(
            serverNowUtc,
            nextCursorUtc,
            farms.Select(f => f.ToDto()).ToList(),
            plots.Select(p => p.ToDto()).ToList(),
            cropCycles.Select(c => c.ToDto()).ToList(),
            dailyLogs.Select(l => l.ToDto()).ToList(),
            costEntries.Select(c => c.ToDto()).ToList(),
            financeCorrections.Select(c => c.ToDto()).ToList(),
            priceConfigs.Select(c => c.ToDto()).ToList(),
            attachments
                .Where(attachment => attachment.Status == Domain.Attachments.AttachmentStatus.Finalized)
                .Select(attachment => attachment.ToDto())
                .ToList(),
            dayLedgers.Select(c => c.ToDto()).ToList(),
            plannedActivities.Select(a => a.ToDto()).ToList());

        return Result.Success(response);
    }

    private static DateTime NormalizeCursor(DateTime rawCursor, DateTime serverNowUtc)
    {
        var cursor = rawCursor.Kind switch
        {
            DateTimeKind.Utc => rawCursor,
            DateTimeKind.Local => rawCursor.ToUniversalTime(),
            _ => DateTime.SpecifyKind(rawCursor, DateTimeKind.Utc)
        };

        if (cursor < DateTime.UnixEpoch)
        {
            return DateTime.UnixEpoch;
        }

        if (cursor > serverNowUtc)
        {
            return serverNowUtc;
        }

        return cursor;
    }

    private static DateTime ComputeNextCursor(
        DateTime sinceUtc,
        IReadOnlyList<Domain.Farms.Farm> farms,
        IReadOnlyList<Domain.Farms.Plot> plots,
        IReadOnlyList<Domain.Crops.CropCycle> cropCycles,
        IReadOnlyList<Domain.Logs.DailyLog> dailyLogs,
        IReadOnlyList<Domain.Finance.CostEntry> costEntries,
        IReadOnlyList<Domain.Finance.FinanceCorrection> financeCorrections,
        IReadOnlyList<Domain.Finance.PriceConfig> priceConfigs,
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        IReadOnlyList<Domain.Finance.DayLedger> dayLedgers,
        IReadOnlyList<Domain.Planning.PlannedActivity> plannedActivities)
    {
        var maxTimestamp = sinceUtc;

        if (farms.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, farms.Max(f => f.CreatedAtUtc));
        }

        if (plots.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plots.Max(p => p.CreatedAtUtc));
        }

        if (cropCycles.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, cropCycles.Max(c => c.CreatedAtUtc));
        }

        foreach (var log in dailyLogs)
        {
            maxTimestamp = Max(maxTimestamp, log.CreatedAtUtc);
            if (log.Tasks.Count > 0)
            {
                maxTimestamp = Max(maxTimestamp, log.Tasks.Max(t => t.OccurredAtUtc));
            }

            if (log.VerificationEvents.Count > 0)
            {
                maxTimestamp = Max(maxTimestamp, log.VerificationEvents.Max(v => v.OccurredAtUtc));
            }
        }

        if (costEntries.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, costEntries.Max(c => c.CreatedAtUtc));
        }

        if (financeCorrections.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, financeCorrections.Max(c => c.CorrectedAtUtc));
        }

        if (priceConfigs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, priceConfigs.Max(c => c.CreatedAtUtc));
        }

        foreach (var attachment in attachments)
        {
            maxTimestamp = Max(maxTimestamp, attachment.CreatedAtUtc);
            if (attachment.FinalizedAtUtc.HasValue)
            {
                maxTimestamp = Max(maxTimestamp, attachment.FinalizedAtUtc.Value);
            }
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.CreatedAtUtc));
        }

        if (plannedActivities.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plannedActivities.Max(a => a.CreatedAtUtc));
        }

        return maxTimestamp;
    }

    private static DateTime Max(DateTime left, DateTime right) => left >= right ? left : right;
}
