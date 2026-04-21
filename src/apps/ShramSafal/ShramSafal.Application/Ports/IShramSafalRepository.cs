using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Application.Contracts.Dtos;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.Ports;

public interface IShramSafalRepository
{
    Task AddFarmAsync(Farm farm, CancellationToken ct = default);
    Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default);
    Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default);
    Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default);
    Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default);
    Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default);

    Task AddPlotAsync(Plot plot, CancellationToken ct = default);
    Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default);
    Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default);

    Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default);
    Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default);
    Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default);

    Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default);
    Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default);
    Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default);

    Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default);
    Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default);
    Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default);
    Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default);
    Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default);
    Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default);
    Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default);
    Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default);
    Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default);
    Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default);
    Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default);
    Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default);

    Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default);
    Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default);

    Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default);
    Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default);
    Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default);
    Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);
    Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);

    Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);
    Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default);

    Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default);
    Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default);
    Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default);
    Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);
    Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Count of <c>Active</c> <c>PrimaryOwner</c> memberships on a farm.
    /// Used by the exit-membership handler to defend invariant I3 (the
    /// last PrimaryOwner cannot leave).
    /// </summary>
    Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default);

    // --- Schedule domain (Phase 3) ---------------------------------------------------------
    Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default);
    Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default);
    Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default);

    Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default);
    Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default);

    /// <summary>
    /// Returns the single <see cref="ScheduleSubscriptionState.Active"/> subscription for
    /// (<paramref name="plotId"/>, <paramref name="cropKey"/>, <paramref name="cropCycleId"/>)
    /// or <c>null</c> when none exists. Invariant I-14 guarantees at most one.
    /// </summary>
    Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default);

    Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default);

    Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default);

    /// <summary>
    /// Returns <c>true</c> if the user has at least one <c>Active</c>
    /// <see cref="FarmMembership"/> with <c>Role >= SecondaryOwner</c>.
    /// Used to gate Team / Licensed / Public template mutations.
    /// </summary>
    Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Returns the root template and all templates derived from it (flat list).
    /// </summary>
    Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);

    // --- CEI Phase 1 §4.4 ----------------------------------------------------------------
    /// <summary>
    /// Returns the count of <see cref="ShramSafal.Domain.Logs.DailyLog"/> records for the
    /// given plot whose <c>CurrentVerificationStatus</c> is
    /// <see cref="ShramSafal.Domain.Logs.VerificationStatus.Disputed"/>.
    /// </summary>
    Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default);

    // --- CEI Phase 3 §4.6 ----------------------------------------------------------------
    /// <summary>
    /// Returns all <see cref="DailyLog"/> records for the given farm.
    /// Used by the compliance evaluator to assess log coverage.
    /// </summary>
    Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult(new List<DailyLog>());

    /// <summary>
    /// Returns <see cref="PlannedActivity"/> records for all crop cycles on the given farm
    /// with <c>PlannedDate >= sinceDate</c>.
    /// </summary>
    Task<List<PlannedActivity>> GetPlannedActivitiesForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
        => Task.FromResult(new List<PlannedActivity>());

    /// <summary>
    /// Returns <see cref="LogTask"/> records for all daily logs on the given farm
    /// with log date >= <paramref name="sinceDate"/>.
    /// </summary>
    Task<List<LogTask>> GetLogTasksForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
        => Task.FromResult(new List<LogTask>());

    /// <summary>
    /// Returns all active farm IDs in the system (farms with at least one active membership).
    /// Used by the compliance sweeper to evaluate all farms.
    /// </summary>
    Task<List<Guid>> GetAllActiveFarmIdsAsync(CancellationToken ct = default)
        => Task.FromResult(new List<Guid>());
}
