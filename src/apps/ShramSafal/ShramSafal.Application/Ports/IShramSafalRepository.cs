using ShramSafal.Domain.AI;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Work;
using ShramSafal.Application.Contracts.Dtos;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;


namespace ShramSafal.Application.Ports;

public interface IShramSafalRepository
{
    Task AddFarmAsync(Farm farm, CancellationToken ct = default);

    // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION): required member.
    // Was previously a default-impl that threw NotImplementedException —
    // a runtime landmine if a future implementor forgot to override.
    // Production ShramSafalRepository overrides; every test stub now
    // overrides as well (most as Task.CompletedTask no-ops).
    Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default);
    Task<FarmBoundary?> GetActiveFarmBoundaryAsync(Guid farmId, CancellationToken ct = default)
        => Task.FromResult<FarmBoundary?>(null);
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
    /// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — returns a non-terminal
    /// farm-membership decision plus the farm's <c>owner_account_id</c>
    /// (denormalised onto <c>ssf.farm_memberships</c> by migration
    /// <c>20260516120000_AddOwnerAccountIdToFarmMemberships</c>) so the
    /// <c>ShramSafalAuthorizationEnforcer</c> can populate
    /// <c>TenantContext</c> with both halves of the RLS key in a single
    /// round-trip.
    /// <para>
    /// Returns <c>(false, Guid.Empty)</c> when the user has no active
    /// membership on the farm. Returns <c>(true, ownerAccountId)</c> for
    /// any non-terminal status — Active, PendingApproval, PendingOtpClaim,
    /// Suspended — matching the same predicate the existing
    /// <see cref="GetFarmMembershipAsync"/> entity-returning overload uses.
    /// Owner-of-farm shortcut: when <paramref name="userId"/> is the
    /// declared <c>Farm.OwnerUserId</c>, the method returns
    /// <c>(true, farm.OwnerAccountId)</c> even if the membership row is
    /// absent (mirrors <see cref="IsUserMemberOfFarmAsync"/> semantics).
    /// </para>
    /// <para>
    /// Naming deviation from sub-phase 03.2 spec: the spec named the new
    /// method <c>GetFarmMembershipAsync</c> with a tuple return type, but
    /// that name already exists at L32 above returning <c>FarmMembership?</c>.
    /// C# cannot overload by return type, so this method takes the
    /// <c>ForTenant</c> suffix; the consumer (
    /// <c>ShramSafalAuthorizationEnforcer</c>) and the semantics are
    /// unchanged from the spec. Documented in the hand-off envelope.
    /// </para>
    /// </summary>
    Task<(bool IsMember, Guid OwnerAccountId)> GetFarmMembershipForTenantAsync(
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
        // Default impl returns "not a member" so the dozens of in-tree
        // test doubles for IShramSafalRepository do not break. Production
        // ShramSafalRepository overrides; FakeAuthorizationRepository
        // (baseline-814ec70 suite) overrides with a deterministic owner.
        => Task.FromResult((false, Guid.Empty));

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

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ------------------------------------------

    // Sub-plan 03 Task 5: required member (see AddFarmBoundaryAsync above).
    Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default);

    Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
        => Task.FromResult<JobCard?>(null);

    /// <summary>
    /// Returns the JobCard whose <c>LinkedDailyLogId</c> equals <paramref name="dailyLogId"/>, or null.
    /// At most one card may be linked to a given log (domain invariant).
    /// </summary>
    Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
        => Task.FromResult<JobCard?>(null);

    /// <summary>
    /// Returns all job cards for the given farm, optionally filtered by status.
    /// </summary>
    Task<List<JobCard>> GetJobCardsForFarmAsync(FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
        => Task.FromResult(new List<JobCard>());

    /// <summary>
    /// Returns all job cards assigned to the given worker.
    /// </summary>
    Task<List<JobCard>> GetJobCardsForWorkerAsync(UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult(new List<JobCard>());

    /// <summary>
    /// Returns all job cards modified since the given cursor for the provided farms.
    /// Used by sync pull.
    /// </summary>
    Task<List<JobCard>> GetJobCardsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<JobCard>());

    /// <summary>
    /// Returns worker metrics for ReliabilityScore computation.
    /// </summary>
    Task<WorkerMetricsDto> GetWorkerMetricsAsync(UserId workerUserId, Guid? scopedFarmId, DateTime since30d, CancellationToken ct = default)
        => Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));

    // --- DATA_PRINCIPLE_SPINE sub-phase 02.5 (cost-category lookup) -------
    /// <summary>
    /// Returns all active rows from <c>ssf.cost_categories</c> — the
    /// canonical 13-code cost-category lookup owned by the server. The
    /// pull-sync handler projects these into <see cref="CostCategoryRefDto"/>
    /// so the mobile client can render Marathi / Hindi / English without
    /// a second round-trip. Default impl returns an empty list so legacy
    /// test doubles compile; production overrides hit the DB.
    /// </summary>
    Task<List<CostCategory>> GetCostCategoriesAsync(CancellationToken ct = default)
        => Task.FromResult(new List<CostCategory>());

    // --- DATA_PRINCIPLE_SPINE sub-phase 02.3 (warm-tier transcripts) ------
    /// <summary>
    /// Persists a warm-tier <see cref="Transcript"/> projection for the
    /// winning AI job attempt. One row per attempt; the <c>ssf.transcripts</c>
    /// unique index on <c>ai_job_attempt_id</c> enforces the invariant.
    /// Required member (no default impl) — every test double must explicitly
    /// override to avoid a runtime landmine if a future codepath routes
    /// through this method, per the sub-plan 03 Task 5 convention surfaced
    /// on <see cref="AddFarmBoundaryAsync"/>.
    /// </summary>
    Task AddTranscriptAsync(Transcript transcript, CancellationToken ct = default);
}
