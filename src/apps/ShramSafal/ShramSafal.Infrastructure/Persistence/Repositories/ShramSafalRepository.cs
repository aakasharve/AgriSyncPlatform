using Microsoft.EntityFrameworkCore;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class ShramSafalRepository(ShramSafalDbContext db) : IShramSafalRepository
{
    public async Task AddFarmAsync(Farm farm, CancellationToken ct = default)
    {
        await db.Farms.AddAsync(farm, ct);
    }

    public async Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.Farms.FirstOrDefaultAsync(f => f.Id == typedFarmId, ct);
    }

    public async Task AddPlotAsync(Plot plot, CancellationToken ct = default)
    {
        await db.Plots.AddAsync(plot, ct);
    }

    public async Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
    {
        return await db.Plots.FirstOrDefaultAsync(p => p.Id == plotId, ct);
    }

    public async Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default)
    {
        await db.CropCycles.AddAsync(cropCycle, ct);
    }

    public async Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await db.CropCycles.FirstOrDefaultAsync(c => c.Id == cropCycleId, ct);
    }

    public async Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default)
    {
        await db.DailyLogs.AddAsync(log, ct);
    }

    public async Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .FirstOrDefaultAsync(l => l.Id == dailyLogId, ct);
    }

    public async Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .FirstOrDefaultAsync(l => l.IdempotencyKey == idempotencyKey, ct);
    }

    public async Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default)
    {
        await db.CostEntries.AddAsync(costEntry, ct);
    }

    public async Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default)
    {
        return await db.CostEntries.FirstOrDefaultAsync(c => c.Id == costEntryId, ct);
    }

    public async Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default)
    {
        await db.FinanceCorrections.AddAsync(correction, ct);
    }

    public async Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default)
    {
        await db.PriceConfigs.AddAsync(config, ct);
    }

    public async Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default)
    {
        await db.ScheduleTemplates.AddAsync(template, ct);
    }

    public async Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default)
    {
        await db.PlannedActivities.AddRangeAsync(plannedActivities, ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await db.PlannedActivities
            .Where(p => p.CropCycleId == cropCycleId)
            .OrderBy(p => p.PlannedDate)
            .ThenBy(p => p.ActivityName)
            .ToListAsync(ct);
    }

    public async Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await (
            from task in db.LogTasks
            join log in db.DailyLogs on task.DailyLogId equals log.Id
            where log.CropCycleId == cropCycleId
            select task)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default)
    {
        var query = db.CostEntries.AsQueryable();

        if (fromDate is not null)
        {
            query = query.Where(c => c.EntryDate >= fromDate.Value);
        }

        if (toDate is not null)
        {
            query = query.Where(c => c.EntryDate <= toDate.Value);
        }

        return await query
            .OrderBy(c => c.EntryDate)
            .ThenBy(c => c.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
    {
        var ids = costEntryIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await db.FinanceCorrections
            .Where(c => ids.Contains(c.CostEntryId))
            .OrderBy(c => c.CorrectedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Farms
            .AsNoTracking()
            .Where(f => f.CreatedAtUtc > sinceUtc)
            .OrderBy(f => f.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Plots
            .AsNoTracking()
            .Where(p => p.CreatedAtUtc > sinceUtc)
            .OrderBy(p => p.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CropCycles
            .AsNoTracking()
            .Where(c => c.CreatedAtUtc > sinceUtc)
            .OrderBy(c => c.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .AsNoTracking()
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l =>
                l.CreatedAtUtc > sinceUtc ||
                l.Tasks.Any(t => t.OccurredAtUtc > sinceUtc) ||
                l.VerificationEvents.Any(v => v.OccurredAtUtc > sinceUtc))
            .OrderBy(l => l.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CostEntries
            .AsNoTracking()
            .Where(c =>
                c.CreatedAtUtc > sinceUtc ||
                db.FinanceCorrections.Any(fc => fc.CostEntryId == c.Id && fc.CorrectedAtUtc > sinceUtc))
            .OrderBy(c => c.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.FinanceCorrections
            .AsNoTracking()
            .Where(c => c.CorrectedAtUtc > sinceUtc)
            .OrderBy(c => c.CorrectedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.PriceConfigs
            .AsNoTracking()
            .Where(c => c.CreatedAtUtc > sinceUtc)
            .OrderBy(c => c.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.PlannedActivities
            .AsNoTracking()
            .Where(a => a.CreatedAtUtc > sinceUtc)
            .OrderBy(a => a.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }
}
