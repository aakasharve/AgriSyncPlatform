using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

public sealed class PullSyncChangesHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<SyncPullResponseDto>> HandleAsync(PullSyncChangesQuery query, CancellationToken ct = default)
    {
        var serverNowUtc = clock.UtcNow;
        var sinceUtc = NormalizeCursor(query.SinceUtc, serverNowUtc);
        var farmIds = await repository.GetFarmIdsForUserAsync(query.UserId, ct);
        var farmIdSet = farmIds.ToHashSet();

        var farms = (await repository.GetFarmsChangedSinceAsync(sinceUtc, ct))
            .Where(f => farmIdSet.Contains((Guid)f.Id))
            .ToList();
        var plots = (await repository.GetPlotsChangedSinceAsync(sinceUtc, ct))
            .Where(p => farmIdSet.Contains((Guid)p.FarmId))
            .ToList();
        var cropCycles = (await repository.GetCropCyclesChangedSinceAsync(sinceUtc, ct))
            .Where(c => farmIdSet.Contains((Guid)c.FarmId))
            .ToList();
        var dailyLogs = (await repository.GetDailyLogsChangedSinceAsync(sinceUtc, ct))
            .Where(l => farmIdSet.Contains((Guid)l.FarmId))
            .ToList();
        var attachments = (await repository.GetAttachmentsChangedSinceAsync(sinceUtc, ct))
            .Where(a => farmIdSet.Contains((Guid)a.FarmId))
            .ToList();
        var costEntries = (await repository.GetCostEntriesChangedSinceAsync(sinceUtc, ct))
            .Where(c => farmIdSet.Contains((Guid)c.FarmId))
            .ToList();
        var costEntryIds = costEntries.Select(c => c.Id).ToHashSet();
        var financeCorrections = (await repository.GetFinanceCorrectionsChangedSinceAsync(sinceUtc, ct))
            .Where(c => costEntryIds.Contains(c.CostEntryId))
            .ToList();
        var dayLedgers = (await repository.GetDayLedgersChangedSinceAsync(sinceUtc, ct))
            .Where(l => farmIdSet.Contains((Guid)l.FarmId))
            .ToList();
        var priceConfigs = (await repository.GetPriceConfigsChangedSinceAsync(sinceUtc, ct))
            .Where(p => (Guid)p.CreatedByUserId == query.UserId)
            .ToList();
        var cropCycleIds = cropCycles.Select(c => c.Id).ToHashSet();
        var plannedActivities = (await repository.GetPlannedActivitiesChangedSinceAsync(sinceUtc, ct))
            .Where(a => cropCycleIds.Contains(a.CropCycleId))
            .ToList();
        var auditEvents = (await repository.GetAuditEventsChangedSinceAsync(sinceUtc, ct))
            .Where(a => !a.FarmId.HasValue || farmIdSet.Contains(a.FarmId.Value))
            .ToList();

        var nextCursorUtc = ComputeNextCursor(
            sinceUtc,
            farms,
            plots,
            cropCycles,
            dailyLogs,
            attachments,
            costEntries,
            financeCorrections,
            dayLedgers,
            priceConfigs,
            plannedActivities,
            auditEvents);

        var response = new SyncPullResponseDto(
            serverNowUtc,
            nextCursorUtc,
            farms.Select(f => f.ToDto()).ToList(),
            plots.Select(p => p.ToDto()).ToList(),
            cropCycles.Select(c => c.ToDto()).ToList(),
            dailyLogs.Select(l => l.ToDto()).ToList(),
            attachments.Select(a => a.ToDto()).ToList(),
            costEntries.Select(c => c.ToDto()).ToList(),
            financeCorrections.Select(c => c.ToDto()).ToList(),
            dayLedgers.Select(l => l.ToDto()).ToList(),
            priceConfigs.Select(c => c.ToDto()).ToList(),
            plannedActivities.Select(a => a.ToDto()).ToList(),
            auditEvents.Select(a => a.ToDto()).ToList(),
            ReferenceDataCatalog.ScheduleTemplates,
            ReferenceDataCatalog.CropTypes,
            ReferenceDataCatalog.ActivityCategories,
            ReferenceDataCatalog.CostCategories,
            ReferenceDataCatalog.VersionHash);

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
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        IReadOnlyList<Domain.Finance.CostEntry> costEntries,
        IReadOnlyList<Domain.Finance.FinanceCorrection> financeCorrections,
        IReadOnlyList<Domain.Finance.DayLedger> dayLedgers,
        IReadOnlyList<Domain.Finance.PriceConfig> priceConfigs,
        IReadOnlyList<Domain.Planning.PlannedActivity> plannedActivities,
        IReadOnlyList<Domain.Audit.AuditEvent> auditEvents)
    {
        var maxTimestamp = sinceUtc;

        if (farms.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, farms.Max(f => f.ModifiedAtUtc));
        }

        if (plots.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plots.Max(p => p.ModifiedAtUtc));
        }

        if (cropCycles.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, cropCycles.Max(c => c.ModifiedAtUtc));
        }

        if (dailyLogs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dailyLogs.Max(log => log.ModifiedAtUtc));
        }

        if (attachments.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, attachments.Max(a => a.ModifiedAtUtc));
        }

        if (costEntries.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, costEntries.Max(c => c.ModifiedAtUtc));
        }

        if (financeCorrections.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, financeCorrections.Max(c => c.ModifiedAtUtc));
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.ModifiedAtUtc));
        }

        if (priceConfigs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, priceConfigs.Max(c => c.ModifiedAtUtc));
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.CreatedAtUtc));
        }

        if (plannedActivities.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plannedActivities.Max(a => a.ModifiedAtUtc));
        }

        if (auditEvents.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, auditEvents.Max(a => a.OccurredAtUtc));
        }

        return maxTimestamp;
    }

    private static DateTime Max(DateTime left, DateTime right) => left >= right ? left : right;
}
