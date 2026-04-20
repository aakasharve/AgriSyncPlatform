using Microsoft.EntityFrameworkCore;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

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

    public async Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Plots
            .AsNoTracking()
            .Where(p => p.ModifiedAtUtc > sinceUtc)
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

    public async Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CostEntries
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
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

    public async Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x => x.ModifiedAtUtc > sinceUtc)
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

    public async Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.OccurredAtUtc > sinceUtc)
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

    private sealed class OperatorDirectoryRow
    {
        public Guid UserId { get; set; }
        public string DisplayName { get; set; } = string.Empty;
        public string Role { get; set; } = "WORKER";
    }
}
