using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Tests.Auth;

/// <summary>
/// Minimal in-memory implementation of <see cref="IShramSafalRepository"/> used
/// exclusively by the baseline 814ec70 regression tests.
///
/// Only the authorization-adjacent methods are implemented — every other
/// method throws <see cref="NotImplementedException"/> so an unexpected call
/// from a future refactor surfaces loudly in tests rather than silently
/// returning defaults.
/// </summary>
internal sealed class FakeAuthorizationRepository : IShramSafalRepository
{
    private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();
    private readonly Dictionary<Guid, DailyLog> _logs = new();

    public void AddMembership(FarmId farmId, UserId userId, AppRole role)
    {
        _memberships[(farmId.Value, userId.Value)] = role;
    }

    public void AddLog(DailyLog log)
    {
        _logs[log.Id] = log;
    }

    public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        return Task.FromResult<AppRole?>(_memberships.TryGetValue((farmId, userId), out var role) ? role : null);
    }

    public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        if (!_memberships.TryGetValue((farmId, userId), out var role))
        {
            return Task.FromResult(false);
        }

        return Task.FromResult(role is AppRole.PrimaryOwner or AppRole.SecondaryOwner);
    }

    public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        return Task.FromResult(_memberships.ContainsKey((farmId, userId)));
    }

    public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default)
    {
        var count = _memberships
            .Where(kv => kv.Key.farmId == farmId && kv.Value == AppRole.PrimaryOwner)
            .Count();
        return Task.FromResult(count);
    }

    public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        return Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);
    }

    // --- Everything below is intentionally unsupported. If a future refactor
    // --- routes through this fake for an unrelated codepath we want loud
    // --- failures, not silent defaults that let a regression slip.
    public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotImplementedException();
    public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotImplementedException();
    public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotImplementedException();
}
