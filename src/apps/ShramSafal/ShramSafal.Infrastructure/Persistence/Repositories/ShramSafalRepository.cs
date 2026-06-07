using Microsoft.EntityFrameworkCore;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Work;
using ShramSafal.Domain.Attachments;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class ShramSafalRepository(ShramSafalDbContext db) : IShramSafalRepository
{
    public async Task AddFarmAsync(Farm farm, CancellationToken ct = default)
    {
        await db.Farms.AddAsync(farm, ct);
    }

    public async Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default)
    {
        await db.FarmBoundaries.AddAsync(boundary, ct);
    }

    public async Task<FarmBoundary?> GetActiveFarmBoundaryAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.FarmBoundaries
            .FirstOrDefaultAsync(boundary => boundary.FarmId == typedFarmId && boundary.IsActive, ct);
    }

    public async Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.Farms.FirstOrDefaultAsync(f => f.Id == typedFarmId, ct);
    }

    public async Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default)
    {
        await db.FarmMemberships.AddAsync(membership, ct);
    }

    public async Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        return await db.FarmMemberships
            .AsNoTracking()
            .FirstOrDefaultAsync(
                membership => membership.FarmId == typedFarmId &&
                              membership.UserId == typedUserId &&
                              membership.Status != MembershipStatus.Revoked &&
                              membership.Status != MembershipStatus.Exited,
                ct);
    }

    public async Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        var isDeclaredOwner = await db.Farms
            .AsNoTracking()
            .AnyAsync(f => f.Id == typedFarmId && f.OwnerUserId == typedUserId, ct);
        if (isDeclaredOwner)
        {
            return AppRole.PrimaryOwner;
        }

        var membership = await db.FarmMemberships
            .AsNoTracking()
            .Where(x => x.FarmId == typedFarmId && x.UserId == typedUserId
                && x.Status != MembershipStatus.Revoked && x.Status != MembershipStatus.Exited)
            .Select(x => (AppRole?)x.Role)
            .FirstOrDefaultAsync(ct);

        return membership;
    }

    public async Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var role = await GetUserRoleForFarmAsync(farmId, userId, ct);
        return role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;
    }

    public async Task AddPlotAsync(Plot plot, CancellationToken ct = default)
    {
        await db.Plots.AddAsync(plot, ct);
    }

    public async Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
    {
        return await db.Plots.FirstOrDefaultAsync(p => p.Id == plotId, ct);
    }

    public async Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.Plots
            .Where(p => p.FarmId == typedFarmId)
            .OrderBy(p => p.Name)
            .ToListAsync(ct);
    }

    public async Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default)
    {
        await db.CropCycles.AddAsync(cropCycle, ct);
    }

    public async Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await db.CropCycles.FirstOrDefaultAsync(c => c.Id == cropCycleId, ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default)
    {
        return await db.CropCycles
            .Where(c => c.PlotId == plotId)
            .OrderBy(c => c.StartDate)
            .ToListAsync(ct);
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

    public async Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
    {
        var ids = costEntryIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await db.CostEntries
            .Where(entry => ids.Contains(entry.Id))
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(
        FarmId farmId,
        Guid? plotId,
        string category,
        DateTime since,
        CancellationToken ct = default)
    {
        return await db.CostEntries
            .Where(entry =>
                entry.FarmId == farmId &&
                entry.PlotId == plotId &&
                entry.CreatedAtUtc >= since)
            .OrderByDescending(entry => entry.CreatedAtUtc)
            .ToListAsync(ct);
    }

    /// <summary>
    /// DATA_PRINCIPLE_SPINE sub-phase 02.5 — returns active rows from
    /// <c>ssf.cost_categories</c> for the pull-sync reference projection.
    /// </summary>
    public async Task<List<CostCategory>> GetCostCategoriesAsync(CancellationToken ct = default)
    {
        return await db.CostCategories
            .AsNoTracking()
            .Where(c => c.IsActive)
            .ToListAsync(ct);
    }

    public async Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default)
    {
        await db.FinanceCorrections.AddAsync(correction, ct);
    }

    public async Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default)
    {
        await db.DayLedgers.AddAsync(dayLedger, ct);
    }

    public async Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .Include(x => x.Allocations)
            .FirstOrDefaultAsync(x => x.Id == dayLedgerId, ct);
    }

    public async Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .Include(x => x.Allocations)
            .FirstOrDefaultAsync(x => x.SourceCostEntryId == costEntryId, ct);
    }

    public async Task<List<DayLedger>> GetDayLedgersForFarm(
        Guid farmId,
        DateOnly from,
        DateOnly to,
        CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);

        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x =>
                x.FarmId == typedFarmId &&
                x.LedgerDate >= from &&
                x.LedgerDate <= to)
            .OrderBy(x => x.LedgerDate)
            .ThenBy(x => x.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default)
    {
        await db.Attachments.AddAsync(attachment, ct);
    }

    public async Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default)
    {
        return await db.Attachments.FirstOrDefaultAsync(a => a.Id == attachmentId, ct);
    }

    public async Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default)
    {
        var normalizedType = entityType.Trim();
        return await db.Attachments
            .AsNoTracking()
            .Where(a => a.LinkedEntityId == entityId && a.LinkedEntityType == normalizedType)
            .OrderBy(a => a.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default)
    {
        await db.PriceConfigs.AddAsync(config, ct);
    }

    public async Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
    {
        await db.AuditEvents.AddAsync(auditEvent, ct);
    }

    public async Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default)
    {
        await db.ScheduleTemplates.AddAsync(template, ct);
    }

    public async Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
        await db.ScheduleTemplates
            .Include(t => t.Stages)
            .Include(t => t.Activities)
            .FirstOrDefaultAsync(t => t.Id == templateId, ct);

    public async Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default)
    {
        var typedUserId = new UserId(userId);
        return await db.FarmMemberships
            .AnyAsync(m => m.UserId == typedUserId
                && m.Status == MembershipStatus.Active
                && (int)m.Role >= (int)AppRole.SecondaryOwner, ct);
    }

    public async Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) =>
        await db.ScheduleTemplates
            .Where(t => t.Id == rootTemplateId || t.DerivedFromTemplateId == rootTemplateId)
            .ToListAsync(ct);

    public async Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default)
    {
        return await db.ScheduleTemplates
            .AsNoTracking()
            .Include(t => t.Activities)
            .OrderBy(t => t.Name)
            .ThenBy(t => t.Stage)
            .ToListAsync(ct);
    }

    public async Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default)
    {
        await db.PlannedActivities.AddRangeAsync(plannedActivities, ct);
    }

    public async Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) =>
        await db.PlannedActivities.FirstOrDefaultAsync(a => a.Id == id, ct);

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
            .Where(f => f.ModifiedAtUtc > sinceUtc)
            .OrderBy(f => f.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Farm>> GetFarmsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.Farms
            .AsNoTracking()
            .Where(f => ids.Contains((Guid)f.Id) && f.ModifiedAtUtc > sinceUtc)
            .OrderBy(f => f.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Plots
            .AsNoTracking()
            .Where(p => p.ModifiedAtUtc > sinceUtc)
            .OrderBy(p => p.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Plot>> GetPlotsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.Plots
            .AsNoTracking()
            .Where(p => ids.Contains((Guid)p.FarmId) && p.ModifiedAtUtc > sinceUtc)
            .OrderBy(p => p.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CropCycles
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.CropCycles
            .AsNoTracking()
            .Where(c => ids.Contains((Guid)c.FarmId) && c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .AsNoTracking()
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l => l.ModifiedAtUtc > sinceUtc)
            .OrderBy(l => l.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.DailyLogs
            .AsNoTracking()
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l => ids.Contains((Guid)l.FarmId) && l.ModifiedAtUtc > sinceUtc)
            .OrderBy(l => l.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CostEntries
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.CostEntries
            .AsNoTracking()
            .Where(c => ids.Contains((Guid)c.FarmId) && c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.FinanceCorrections
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.FinanceCorrections
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .Where(c => db.CostEntries.Any(entry =>
                entry.Id == c.CostEntryId &&
                ids.Contains((Guid)entry.FarmId)))
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x => x.ModifiedAtUtc > sinceUtc)
            .OrderBy(x => x.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x => ids.Contains((Guid)x.FarmId) && x.ModifiedAtUtc > sinceUtc)
            .OrderBy(x => x.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.PriceConfigs
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.PlannedActivities
            .AsNoTracking()
            .Where(a => a.ModifiedAtUtc > sinceUtc)
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.PlannedActivities
            .AsNoTracking()
            .Where(a => a.ModifiedAtUtc > sinceUtc)
            .Where(a => db.CropCycles.Any(cycle =>
                cycle.Id == a.CropCycleId &&
                ids.Contains((Guid)cycle.FarmId)))
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Attachments
            .AsNoTracking()
            .Where(a =>
                a.CreatedAtUtc > sinceUtc ||
                a.ModifiedAtUtc > sinceUtc ||
                (a.UploadedAtUtc.HasValue && a.UploadedAtUtc.Value > sinceUtc) ||
                (a.FinalizedAtUtc.HasValue && a.FinalizedAtUtc.Value > sinceUtc))
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Attachment>> GetAttachmentsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.Attachments
            .AsNoTracking()
            .Where(a =>
                ids.Contains((Guid)a.FarmId) &&
                (a.CreatedAtUtc > sinceUtc ||
                 a.ModifiedAtUtc > sinceUtc ||
                 (a.UploadedAtUtc.HasValue && a.UploadedAtUtc.Value > sinceUtc) ||
                 (a.FinalizedAtUtc.HasValue && a.FinalizedAtUtc.Value > sinceUtc)))
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.OccurredAtUtc > sinceUtc)
            .OrderBy(a => a.OccurredAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);

        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.OccurredAtUtc > sinceUtc)
            .Where(a => !a.FarmId.HasValue || ids.Contains(a.FarmId.Value))
            .OrderBy(a => a.OccurredAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default)
    {
        var normalizedEntityType = entityType.Trim();
        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.EntityId == entityId && a.EntityType == normalizedEntityType)
            .OrderBy(a => a.OccurredAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsForFarmAsync(
        Guid farmId,
        DateOnly from,
        DateOnly to,
        int limit,
        int offset,
        CancellationToken ct = default)
    {
        var fromUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var toExclusiveUtc = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        return await db.AuditEvents
            .AsNoTracking()
            .Where(a =>
                a.FarmId == farmId &&
                a.OccurredAtUtc >= fromUtc &&
                a.OccurredAtUtc < toExclusiveUtc)
            .OrderByDescending(a => a.OccurredAtUtc)
            .Skip(Math.Max(0, offset))
            .Take(Math.Clamp(limit, 1, 1000))
            .ToListAsync(ct);
    }

    public async Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var ownedFarmIds = await db.Farms
            .AsNoTracking()
            .Where(f => (Guid)f.OwnerUserId == userId)
            .Select(f => (Guid)f.Id)
            .ToListAsync(ct);

        var membershipFarmIds = await db.FarmMemberships
            .AsNoTracking()
            .Where(m => (Guid)m.UserId == userId
                && m.Status != MembershipStatus.Revoked && m.Status != MembershipStatus.Exited)
            .Select(m => (Guid)m.FarmId)
            .ToListAsync(ct);

        return ownedFarmIds
            .Concat(membershipFarmIds)
            .Distinct()
            .ToList();
    }

    public async Task<List<MyFarmProjection>> GetMyFarmsAsync(Guid userId, CancellationToken ct = default)
    {
        // /shramsafal/farms/mine is skip-listed in TenantTransactionMiddleware →
        // admin-elevated → the interceptor injects NO GUC AND the middleware opens
        // NO transaction. Open our own tx so `SET LOCAL agrisync.user_id` survives
        // the SELECT (Postgres scopes SET LOCAL to the current transaction). The
        // interceptor is in admin no-op mode here, so it does not rewrite these
        // commands — the manual GUC below is authoritative.
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        // Set the tx-local GUC the p_user_select_* policies key on, via a
        // PARAMETERISED set_config (is_local=true ≡ SET LOCAL but injectable —
        // avoids EF1002 on ExecuteSqlRaw + string interpolation). Run as its own
        // command (NOT prepended to the SELECT), so the set_config result row is
        // discarded by ExecuteNonQuery and never confuses the reader of the
        // farms query that follows.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)", ct);

        // RLS (p_user_select_farms) filters to the caller's owned + active-member
        // farms — no WHERE needed.
        var farms = await db.Farms.AsNoTracking().ToListAsync(ct);

        var memberships = await db.FarmMemberships
            .AsNoTracking()
            .Where(m => (Guid)m.UserId == userId
                && m.Status != MembershipStatus.Revoked && m.Status != MembershipStatus.Exited)
            .ToListAsync(ct);

        await tx.CommitAsync(ct);

        var roleByFarm = memberships
            .GroupBy(m => (Guid)m.FarmId)
            .ToDictionary(g => g.Key, g => g.First().Role);

        return farms.Select(f =>
        {
            var farmId = (Guid)f.Id;
            AppRole? role = roleByFarm.TryGetValue(farmId, out var membershipRole)
                ? membershipRole
                : ((Guid)f.OwnerUserId == userId ? AppRole.PrimaryOwner : (AppRole?)null);
            return new MyFarmProjection(farmId, f.Name, f.FarmCode, (Guid)f.OwnerAccountId, role);
        }).ToList();
    }

    public async Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
        IEnumerable<Guid> userIds,
        CancellationToken ct = default)
    {
        var ids = userIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();

        if (ids.Count == 0)
        {
            return [];
        }

        if (!db.Database.IsRelational())
        {
            return ids
                .Select(id => new SyncOperatorDto(id, $"Operator {id:N}"[..17], "WORKER"))
                .OrderBy(op => op.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var operators = new List<SyncOperatorDto>(ids.Count);
        foreach (var id in ids)
        {
            var row = await db.Database
                .SqlQueryRaw<OperatorDirectoryRow>(
                    """
                    select
                        u."Id" as "UserId",
                        u.display_name as "DisplayName",
                        case lower(coalesce(m.role, 'worker'))
                            when 'primaryowner' then 'PRIMARY_OWNER'
                            when 'secondaryowner' then 'SECONDARY_OWNER'
                            when 'mukadam' then 'MUKADAM'
                            else 'WORKER'
                        end as "Role"
                    from public.users u
                    left join public.memberships m
                        on m.user_id = u."Id"
                        and m.app_id = 'shramsafal'
                        and m.is_revoked = false
                    where u."Id" = {0}
                    limit 1
                    """,
                    id)
                .FirstOrDefaultAsync(ct);

            if (row is null)
            {
                continue;
            }

            operators.Add(new SyncOperatorDto(row.UserId, row.DisplayName, row.Role));
        }

        return operators
            .OrderBy(op => op.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        var isOwner = await db.Farms
            .AsNoTracking()
            .AnyAsync(f => f.Id == typedFarmId && f.OwnerUserId == typedUserId, ct);
        if (isOwner)
        {
            return true;
        }

        return await db.FarmMemberships
            .AsNoTracking()
            .AnyAsync(
                membership => membership.FarmId == typedFarmId &&
                              membership.UserId == typedUserId &&
                              membership.Status != MembershipStatus.Revoked &&
                              membership.Status != MembershipStatus.Exited,
                ct);
    }

    public async Task<(bool IsMember, Guid OwnerAccountId)> GetFarmMembershipForTenantAsync(
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
    {
        // DATA_PRINCIPLE_SPINE 03.2 — Owner shortcut first so a farm's
        // declared OwnerUserId resolves to its OwnerAccountId in one
        // round-trip even when the membership row is absent (matches the
        // semantic of IsUserMemberOfFarmAsync above).
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        var ownerHit = await db.Farms
            .AsNoTracking()
            .Where(f => f.Id == typedFarmId && f.OwnerUserId == typedUserId)
            .Select(f => (Guid?)f.OwnerAccountId.Value)
            .FirstOrDefaultAsync(ct);
        if (ownerHit is Guid ownerAccount)
        {
            return (true, ownerAccount);
        }

        // owner_account_id was added to ssf.farm_memberships by migration
        // 20260516120000_AddOwnerAccountIdToFarmMemberships but is not on
        // the FarmMembership domain entity (kept stable for that migration
        // per its own rationale comment). Read it via raw SQL alongside
        // the non-terminal status filter the existing LINQ predicates use.
        // Status enum: 0=PendingOtpClaim, 1=PendingApproval, 2=Active,
        // 3=Suspended, 5=Revoked, 6=Exited (see MembershipStatus enum).
        var membershipOwner = await db.Database
            .SqlQueryRaw<Guid?>(
                """
                SELECT owner_account_id AS "Value"
                FROM ssf.farm_memberships
                WHERE farm_id = {0}
                  AND user_id = {1}
                  AND status NOT IN (5, 6)
                LIMIT 1
                """,
                farmId,
                userId)
            .FirstOrDefaultAsync(ct);

        return membershipOwner is Guid mappedOwner
            ? (true, mappedOwner)
            : (false, Guid.Empty);
    }

    public async Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);

        var membershipOwners = await db.FarmMemberships
            .AsNoTracking()
            .CountAsync(m => m.FarmId == typedFarmId
                && m.Status == MembershipStatus.Active
                && m.Role == AppRole.PrimaryOwner, ct);

        // Fallback for seeded farms: the declared Farm.OwnerUserId also
        // counts as a PrimaryOwner, even if no explicit membership row
        // exists. This mirrors the fallback in GetUserRoleForFarmAsync.
        if (membershipOwners == 0)
        {
            var hasDeclaredOwner = await db.Farms
                .AsNoTracking()
                .AnyAsync(f => f.Id == typedFarmId, ct);
            return hasDeclaredOwner ? 1 : 0;
        }

        return membershipOwners;
    }

    // --- Schedule domain (Phase 3) -----------------------------------------------------

    public async Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default)
    {
        await db.CropScheduleTemplates.AddAsync(template, ct);
    }

    public async Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(
        ScheduleTemplateId templateId,
        CancellationToken ct = default)
    {
        return await db.CropScheduleTemplates
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == templateId.Value, ct);
    }

    public async Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(
        string cropKey,
        string? regionCode,
        CancellationToken ct = default)
    {
        var normalizedCrop = cropKey.Trim().ToLowerInvariant();
        var normalizedRegion = string.IsNullOrWhiteSpace(regionCode)
            ? null
            : regionCode.Trim().ToLowerInvariant();

        return await db.CropScheduleTemplates
            .AsNoTracking()
            .Where(t => t.CropKey == normalizedCrop
                        && (normalizedRegion == null || t.RegionCode == normalizedRegion)
                        && t.IsPublished)
            .OrderBy(t => t.TemplateKey)
            .ToListAsync(ct);
    }

    public async Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default)
    {
        await db.ScheduleSubscriptions.AddAsync(subscription, ct);
    }

    public async Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(
        ScheduleSubscriptionId subscriptionId,
        CancellationToken ct = default)
    {
        return await db.ScheduleSubscriptions
            .FirstOrDefaultAsync(s => s.Id == subscriptionId.Value, ct);
    }

    public async Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(
        Guid plotId,
        string cropKey,
        Guid cropCycleId,
        CancellationToken ct = default)
    {
        var normalizedCrop = cropKey.Trim().ToLowerInvariant();

        return await db.ScheduleSubscriptions
            .AsNoTracking()
            .FirstOrDefaultAsync(
                s => s.PlotId == plotId
                     && s.CropKey == normalizedCrop
                     && s.CropCycleId == cropCycleId
                     && s.State == ScheduleSubscriptionState.Active,
                ct);
    }

    public async Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default)
    {
        await db.ScheduleMigrationEvents.AddAsync(migrationEvent, ct);
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }

    // --- CEI Phase 1 §4.4 -----------------------------------------------------------------

    public async Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default)
    {
        var logs = await db.DailyLogs
            .Where(l => l.PlotId == plotId)
            .Include(l => l.VerificationEvents)
            .ToListAsync(ct);

        return logs.Count(l => l.CurrentVerificationStatus == VerificationStatus.Disputed);
    }

    // --- CEI Phase 3 §4.6 -----------------------------------------------------------------

    public async Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .Where(l => l.FarmId == farmId)
            .Include(l => l.VerificationEvents)
            .OrderBy(l => l.LogDate)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
    {
        // Get all crop cycle IDs for the farm first, then query planned activities
        var cropCycleIds = await db.CropCycles
            .Where(c => c.FarmId == farmId)
            .Select(c => c.Id)
            .ToListAsync(ct);

        if (cropCycleIds.Count == 0) return [];

        return await db.PlannedActivities
            .Where(a => cropCycleIds.Contains(a.CropCycleId) && a.PlannedDate >= sinceDate && a.RemovedAtUtc == null)
            .ToListAsync(ct);
    }

    public async Task<List<LogTask>> GetLogTasksForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
    {
        return await (
            from task in db.LogTasks
            join log in db.DailyLogs on task.DailyLogId equals log.Id
            where log.FarmId == farmId && log.LogDate >= sinceDate
            select task
        ).ToListAsync(ct);
    }

    public async Task<List<Guid>> GetAllActiveFarmIdsAsync(CancellationToken ct = default)
    {
        return await db.FarmMemberships
            .Where(m => m.Status == MembershipStatus.Active)
            .Select(m => (Guid)m.FarmId)
            .Distinct()
            .ToListAsync(ct);
    }

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ------------------------------------------

    public async Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default)
    {
        await db.JobCards.AddAsync(jobCard, ct);
    }

    public async Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
    {
        return await db.JobCards.FindAsync([jobCardId], ct);
    }

    public async Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        return await db.JobCards
            .FirstOrDefaultAsync(j => j.LinkedDailyLogId == dailyLogId, ct);
    }

    public async Task<List<JobCard>> GetJobCardsForFarmAsync(
        FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
    {
        var query = db.JobCards.Where(j => j.FarmId == farmId);
        if (statusFilter.HasValue)
            query = query.Where(j => j.Status == statusFilter.Value);
        return await query.OrderByDescending(j => j.CreatedAtUtc).ToListAsync(ct);
    }

    public async Task<List<JobCard>> GetJobCardsForWorkerAsync(
        UserId workerUserId, CancellationToken ct = default)
    {
        return await db.JobCards
            .Where(j => j.AssignedWorkerUserId == workerUserId)
            .OrderByDescending(j => j.PlannedDate)
            .ToListAsync(ct);
    }

    public async Task<List<JobCard>> GetJobCardsChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var farmIdSet = farmIds.Select(id => new FarmId(id)).ToHashSet();
        return await db.JobCards
            .Where(j => farmIdSet.Contains(j.FarmId) && j.ModifiedAtUtc > sinceUtc)
            .ToListAsync(ct);
    }

    public Task<WorkerMetricsDto> GetWorkerMetricsAsync(
        UserId workerUserId, Guid? scopedFarmId, DateTime since30d, CancellationToken ct = default)
    {
        // For now return zeroed metrics — ReliabilityScore computation from DB queries
        // is deferred to a dedicated read-model in a future phase.
        return Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));
    }

    // --- DATA_PRINCIPLE_SPINE sub-phase 02.3 (warm-tier transcripts) ------
    public Task AddTranscriptAsync(Transcript transcript, CancellationToken ct = default)
    {
        db.Transcripts.Add(transcript);
        return Task.CompletedTask;
    }

    // --- DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) --------------
    /// <summary>
    /// Upsert by SHA-256 — increment ref-count on a repeat sighting, insert a
    /// fresh row (RefCount=1) on first sighting. SaveChanges is invoked
    /// directly so the index row is durable BEFORE the caller stamps the
    /// SHA-256 onto an <see cref="AiJob.RawInputRef"/>. Both DbContext-bound
    /// repositories (this one and <c>AiJobRepository</c>) share the same
    /// scoped <c>ShramSafalDbContext</c>, so this flushes any pending
    /// orchestrator writes too — which is fine: the orchestrator does the
    /// upsert call BEFORE it adds the AiJob to the tracker, so nothing else
    /// is in flight at this point.
    /// </summary>
    public async Task UpsertRawBlobIndexAsync(RawBlobRef blobRef, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(blobRef);

        var existing = await db.RawBlobIndices
            .FirstOrDefaultAsync(x => x.Sha256 == blobRef.Sha256, ct);

        if (existing is not null)
        {
            existing.IncrementRefCount();
        }
        else
        {
            await db.RawBlobIndices.AddAsync(RawBlobIndexEntry.New(blobRef), ct);
        }

        await db.SaveChangesAsync(ct);
    }

    // --- SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 (transcript idempotency) ---
    // The unique key on ssf.transcript_history is
    // (audio_content_hash, transcript_provider, transcript_model_version,
    // transcript_mode). See TranscriptHistoryConfiguration.cs for the EF
    // mapping. The lookup hits the unique index
    // ux_transcript_history_audio_provider_model_mode by name.

    public async Task<TranscriptHistory?> GetTranscriptHistoryAsync(
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(audioContentHash) ||
            string.IsNullOrWhiteSpace(transcriptProvider) ||
            string.IsNullOrWhiteSpace(transcriptModelVersion) ||
            string.IsNullOrWhiteSpace(transcriptMode))
        {
            return null;
        }

        return await db.TranscriptHistories
            .AsNoTracking()
            .FirstOrDefaultAsync(
                h => h.AudioContentHash == audioContentHash &&
                     h.TranscriptProvider == transcriptProvider &&
                     h.TranscriptModelVersion == transcriptModelVersion &&
                     h.TranscriptMode == transcriptMode,
                ct);
    }

    /// <summary>
    /// "ON CONFLICT DO NOTHING" semantics. We pre-check the unique tuple
    /// inside the same DbContext to avoid the UPDATE landmine on a tracked
    /// entity collision; SaveChanges is invoked directly so the row is
    /// durable before the caller returns the transcript to the user. If a
    /// concurrent writer beat us to it (race window), the duplicate-key
    /// INSERT path raises a Postgres unique-violation which we catch +
    /// swallow — the loser's transcript text is presumed equivalent because
    /// the same audio + same (provider, model, mode) deterministically
    /// produces the same text.
    /// </summary>
    public async Task UpsertTranscriptHistoryAsync(TranscriptHistory history, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(history);

        // First-line check: if the row already exists, no-op. AsNoTracking
        // keeps the EF identity map clean so a later GET in the same scope
        // re-reads from DB if needed.
        var existing = await db.TranscriptHistories
            .AsNoTracking()
            .AnyAsync(
                h => h.AudioContentHash == history.AudioContentHash &&
                     h.TranscriptProvider == history.TranscriptProvider &&
                     h.TranscriptModelVersion == history.TranscriptModelVersion &&
                     h.TranscriptMode == history.TranscriptMode,
                ct);

        if (existing)
        {
            return;
        }

        try
        {
            await db.TranscriptHistories.AddAsync(history, ct);
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Race window between the pre-check and the SaveChanges: a
            // concurrent writer landed the same row. Detach our copy so
            // EF stops tracking it and the next SaveChanges in this scope
            // doesn't re-attempt the INSERT.
            db.Entry(history).State = EntityState.Detached;
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        // Npgsql surfaces unique-violation as SQLSTATE 23505 inside an
        // inner PostgresException. We avoid a hard reference to
        // Npgsql.PostgresException so the production assembly's reference
        // surface stays unchanged; instead, we sniff the SqlState property
        // via reflection-safe Exception.Data and the inner-exception
        // message. The defensive check is intentional — losing the race
        // and silently swallowing is the correct behavior per the
        // ON CONFLICT DO NOTHING semantics in the port contract.
        for (Exception? inner = ex; inner is not null; inner = inner.InnerException)
        {
            if (inner.GetType().Name == "PostgresException")
            {
                var sqlStateProp = inner.GetType().GetProperty("SqlState");
                if (sqlStateProp?.GetValue(inner) is string sqlState &&
                    string.Equals(sqlState, "23505", StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }

    // ── DATA_PRINCIPLE_SPINE sub-phase 06.1 / 06.2 (consent domain) ──────
    // spec: data-principle-spine-2026-05-05/06.2

    /// <summary>
    /// Fetch the live consent row for <paramref name="userId"/> or null
    /// when the user has never toggled any consent (first-time
    /// interaction). The <c>ssf.user_consent_state</c> PK is
    /// <c>user_id</c>; <see cref="DbSet{TEntity}.FindAsync"/> hits the
    /// identity map first so a within-request re-read is free.
    /// </summary>
    public async Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return null;
        }

        return await db.UserConsentStates.FirstOrDefaultAsync(s => s.UserId == userId, ct);
    }

    public async Task AddUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);
        await db.UserConsentStates.AddAsync(state, ct);
    }

    /// <summary>
    /// Replace the live consent row. The factory pattern on
    /// <see cref="UserConsentState"/> returns a NEW instance on every
    /// update; the handler hands us that new instance and we
    /// reattach + mark modified. Pre-existing rows that the handler
    /// already loaded through this same context get their tracked entry
    /// updated via <see cref="DbContext.Entry"/>.
    /// </summary>
    public async Task UpdateUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);

        // The handler loads the existing row, computes the diff, then
        // hands us a new value instance. Reuse the tracked entity
        // when present so EF emits an UPDATE; otherwise, attach and
        // mark Modified so EF still emits an UPDATE (not an INSERT —
        // the row exists in DB).
        var tracked = await db.UserConsentStates
            .FirstOrDefaultAsync(s => s.UserId == state.UserId, ct);

        if (tracked is null)
        {
            db.UserConsentStates.Attach(state);
            db.Entry(state).State = EntityState.Modified;
            return;
        }

        // Overwrite the tracked entity's scalar values from the new
        // instance — CurrentValues.SetValues copies every mapped
        // property by name without invalidating the tracking entry.
        db.Entry(tracked).CurrentValues.SetValues(state);
    }

    public async Task AddConsentAuditEntryAsync(ConsentAuditEntry entry, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        await db.ConsentAuditEntries.AddAsync(entry, ct);
    }

    // ── DATA_PRINCIPLE_SPINE sub-phase 10.2 / 10.4 (PII review queue) ────
    // spec: data-principle-spine-2026-05-05/10.2

    public async Task AddPiiReviewQueueEntryAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry entry,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        await db.PiiReviewQueueEntries.AddAsync(entry, ct);
    }

    public async Task<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry?> GetPiiReviewQueueEntryAsync(
        Guid entryId,
        CancellationToken ct = default)
    {
        if (entryId == Guid.Empty)
        {
            return null;
        }

        return await db.PiiReviewQueueEntries.FirstOrDefaultAsync(e => e.Id == entryId, ct);
    }

    public async Task<IReadOnlyList<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>> ListPiiReviewQueueAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewStatus status,
        int limit,
        CancellationToken ct = default)
    {
        var clamped = limit <= 0 ? 50 : Math.Min(limit, 200);
        return await db.PiiReviewQueueEntries
            .Where(e => e.Status == status)
            .OrderBy(e => e.OccurredAtUtc)
            .Take(clamped)
            .ToListAsync(ct);
    }

    // ── DATA_PRINCIPLE_SPINE sub-phase 08.1 (DPDP rights surface) ────────
    // spec: data-principle-spine-2026-05-05/08.1

    public async Task AddErasureRequestAsync(ErasureRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await db.ErasureRequests.AddAsync(request, ct);
    }

    public async Task AddExportRequestAsync(ExportRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await db.ExportRequests.AddAsync(request, ct);
    }

    public async Task AddBreachIncidentAsync(BreachIncident incident, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(incident);
        await db.BreachIncidents.AddAsync(incident, ct);
    }

    public async Task<List<ErasureRequest>> GetErasureRequestsForUserAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return new List<ErasureRequest>();
        }
        return await db.ErasureRequests
            .Where(r => r.RequestedByUserId == userId || r.OnBehalfOfUserId == userId)
            .OrderByDescending(r => r.RequestedAtUtc)
            .Take(50)
            .ToListAsync(ct);
    }

    public async Task<List<ExportRequest>> GetExportRequestsForUserAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return new List<ExportRequest>();
        }
        return await db.ExportRequests
            .Where(r => r.RequestedByUserId == userId || r.OnBehalfOfUserId == userId)
            .OrderByDescending(r => r.RequestedAtUtc)
            .Take(50)
            .ToListAsync(ct);
    }

    private static List<Guid> NormalizeFarmIds(IEnumerable<Guid> farmIds)
    {
        return farmIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();
    }

    private sealed class OperatorDirectoryRow
    {
        public Guid UserId { get; set; }
        public string DisplayName { get; set; } = string.Empty;
        public string Role { get; set; } = "WORKER";
    }
}
