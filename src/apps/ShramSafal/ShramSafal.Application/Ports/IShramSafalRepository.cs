using ShramSafal.Domain.AI;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Storage;
using ShramSafal.Domain.Work;
using ShramSafal.Application.Contracts.Dtos;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;


namespace ShramSafal.Application.Ports;

/// <summary>
/// User-scoped my-farms projection row — one per farm the caller owns or is an
/// active member of, with the caller's role on that farm. Returned by
/// <see cref="IShramSafalRepository.GetMyFarmsAsync"/> for the
/// <c>/shramsafal/farms/mine</c> read path.
/// </summary>
public sealed record MyFarmProjection(
    Guid FarmId,
    string Name,
    string? FarmCode,
    Guid OwnerAccountId,
    AppRole? Role);

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

    // Track B B2.8 — stage a WeatherStamp on the DbSet (no SaveChanges; the
    // caller's existing SaveChangesAsync commits it in the same unit of work
    // as the DailyLog). Production ShramSafalRepository overrides with the EF
    // AddAsync. A default no-op impl is used (not a required member) so the
    // ~28 in-tree IShramSafalRepository test doubles keep compiling untouched —
    // the same convention the other recent additive ports here follow (e.g.
    // UpsertRawBlobIndexAsync). Weather-stamp persistence is best-effort /
    // NON-BLOCKING anyway, so a test double that no-ops it is harmless.
    Task AddWeatherStampAsync(WeatherStamp stamp, CancellationToken ct = default)
        => Task.CompletedTask;
    Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default);
    Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default);

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.5) — every log that has NEVER been touched
    /// by the verification FSM, oldest first, TRACKED so the caller can attest to them.
    ///
    /// <para><b>Why "no events at all" is the right predicate, and the whole guard.</b>
    /// <c>DailyLog.CurrentVerificationStatus</c> folds the events and defaults to
    /// <c>Draft</c>, so "reads Draft" is ambiguous: it covers a log nobody has ever
    /// assessed AND a log a human deliberately re-opened (<c>Edit</c> writes a real Draft
    /// event; <c>AddLogTaskHandler</c> walks an attested day back to Draft to re-cover new
    /// content). Backfilling on "reads Draft" would therefore stamp approval over a
    /// re-opening somebody performed on purpose. An EMPTY event list cannot mean that:
    /// nothing has ever been asserted about this day by anyone, which is precisely and
    /// only the population wave-1.3 left behind. It also makes the backfill self-limiting
    /// — a log it has attested to has two events and can never be a candidate again, so
    /// re-running is a no-op with no marker table to keep in sync.</para>
    ///
    /// <para><b>Why it takes a cursor and not just a limit (wave-1.5 review, I1).</b> Not
    /// every candidate can be repaired: a mukadam's day, or one whose creator has left the
    /// farm, is REFUSED and therefore stays a candidate forever — it has no verification
    /// events and never will until a human presses approve. Ordered oldest-first, a run of
    /// such rows holds the front of the result set on every re-read, so a caller that only
    /// ever asks for "the first N candidates" re-reads the same refusals and can never see
    /// what sorts behind them. With <paramref name="afterCreatedAtUtc"/> /
    /// <paramref name="afterId"/> the caller walks FORWARD through the whole candidate set
    /// instead, and an owner's stuck day behind 500 un-attestable ones is reached. Keyset,
    /// not OFFSET, because the set shrinks underneath the walk as rows are repaired — an
    /// offset would skip rows as it slid.</para>
    ///
    /// <para>Default no-op so the ~28 in-tree test doubles keep compiling, per the
    /// additive-port convention above.</para>
    /// </summary>
    /// <param name="limit">Maximum candidates to return in this page.</param>
    /// <param name="afterCreatedAtUtc">
    /// Exclusive lower bound on <c>CreatedAtUtc</c> from the previous page's last row.
    /// Null (with <paramref name="afterId"/>) starts from the oldest candidate.
    /// </param>
    /// <param name="afterId">
    /// Tie-break half of the cursor: rows sharing <paramref name="afterCreatedAtUtc"/> are
    /// included only if their id sorts after this one. Both halves are required —
    /// <c>CreatedAtUtc</c> alone is not unique, and a bulk import can give many logs the
    /// same timestamp.
    /// </param>
    /// <param name="ct">Cancellation.</param>
    Task<IReadOnlyList<DailyLog>> GetDailyLogsWithNoVerificationHistoryAsync(
        int limit, DateTime? afterCreatedAtUtc, Guid? afterId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLog>>(Array.Empty<DailyLog>());

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

    // ADR 0019 / sync-pull-user-scoped-rls-read-path-2026-06-07 R3:
    // farm-filtered changed-since overloads. Production overrides push the
    // farm scope into SQL before RLS evaluates per-row user-scoped policies;
    // default implementations keep existing test doubles source-compatible.
    Task<List<Farm>> GetFarmsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetFarmsChangedSinceAsync(sinceUtc, ct);
    Task<List<Plot>> GetPlotsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetPlotsChangedSinceAsync(sinceUtc, ct);
    Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetCropCyclesChangedSinceAsync(sinceUtc, ct);
    Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetDailyLogsChangedSinceAsync(sinceUtc, ct);
    Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetCostEntriesChangedSinceAsync(sinceUtc, ct);
    Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetFinanceCorrectionsChangedSinceAsync(sinceUtc, ct);
    Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetDayLedgersChangedSinceAsync(sinceUtc, ct);
    Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetPlannedActivitiesChangedSinceAsync(sinceUtc, ct);
    Task<List<Attachment>> GetAttachmentsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetAttachmentsChangedSinceAsync(sinceUtc, ct);
    Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetAuditEventsChangedSinceAsync(sinceUtc, ct);

    Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default);
    Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default);
    Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// User-scoped my-farms projection (owner + active-member farms, with the
    /// caller's role per farm). Opens its OWN transaction and emits
    /// <c>SET LOCAL agrisync.user_id</c> so the <c>p_user_select_farms</c> /
    /// <c>p_user_select_memberships</c> RLS policies surface the caller's farms
    /// on the admin-elevated <c>/shramsafal/farms/mine</c> route (where the
    /// interceptor injects no GUC and the middleware opens no transaction).
    /// Default impl returns empty so the many in-tree test doubles compile;
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<List<MyFarmProjection>> GetMyFarmsAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<MyFarmProjection>());

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
    /// <remarks>
    /// <paramref name="scopedFarmId"/> must not be null for a caller who is not the
    /// worker himself — a null scope aggregates every farm he has ever worked, which is
    /// the portable reputation <see cref="WorkerRecordPortability"/> guards. The callers
    /// obtain it from <c>WorkerRecordAccess.SingleFarmScope</c>; do not pass a raw
    /// client-supplied farm id.
    /// </remarks>
    Task<WorkerMetricsDto> GetWorkerMetricsAsync(UserId workerUserId, Guid? scopedFarmId, DateTime since30d, CancellationToken ct = default)
        => Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));

    // --- spec: dfes-companion-2026-07-11 (wave-4.4) — founder ruling A, 2026-08-17 ----
    /// <summary>
    /// True when <paramref name="workerUserId"/> has himself granted
    /// <see cref="WorkerRecordPortability.PortabilityConsentPurposeCode"/> — consent for
    /// his identifiable record to leave the farm that recorded it.
    ///
    /// <para><b>The default is false, and false is the whole point.</b> Ruling A puts the
    /// worker-consent question at portability, not at naming: his name inside his own
    /// farm's records needs no consent, but a reputation that follows him to the next
    /// employer needs HIS. Nothing in this codebase can grant that purpose yet, so every
    /// implementation answers false and every cross-farm read is refused.</para>
    ///
    /// <para>This default impl is the fail-closed seam. When someone builds a portable
    /// worker record they must come here and implement it against a real consent row —
    /// they cannot ship the feature by forgetting this method, because forgetting it
    /// denies. An owner's consent is NEVER an answer to this question, and
    /// <c>ConsentPurpose.CrossFarmAggregation</c> is not either: that licenses
    /// DE-IDENTIFIED data, and this boundary is only about data that still names him.</para>
    /// </summary>
    Task<bool> HasWorkerRecordPortabilityConsentAsync(UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult(false);

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

    // --- DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) --------------
    /// <summary>
    /// Upserts the ref-count entry in <c>ssf.raw_blob_index</c> for a content-
    /// addressed raw blob the orchestrator just parked in the cold tier (see
    /// <see cref="ShramSafal.Application.Storage.IRawBlobStore.PutAsync"/>).
    /// Insert-and-set-RefCount=1 on first sighting; increment on a repeat
    /// upload of the same SHA-256. The unique key is
    /// <see cref="RawBlobRef.Sha256"/>.
    /// <para>
    /// Default impl is a no-op so the dozens of in-tree
    /// <c>IShramSafalRepository</c> test doubles keep compiling. Production
    /// <c>ShramSafalRepository</c> overrides with EF Core writes; integration
    /// suites that care about ref-count semantics override as well.
    /// </para>
    /// </summary>
    Task UpsertRawBlobIndexAsync(RawBlobRef blobRef, CancellationToken ct = default)
        => Task.CompletedTask;

    // --- SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 (transcript idempotency) ---
    /// <summary>
    /// Lookup a prior transcript by the unique tuple
    /// <c>(audio_content_hash, transcript_provider, transcript_model_version,
    /// transcript_mode)</c>. Returns the prior <see cref="TranscriptHistory"/>
    /// row if present (Sarvam idempotency check — Task 2.10 Lever #8) or
    /// <c>null</c> when this is a first sighting. Used by
    /// <c>SarvamStreamingSttClient.TranscribeAsync</c> and
    /// <c>SarvamVerbatimSttClient.TranscribeVerbatimAsync</c> to short-circuit
    /// the Sarvam REST call when the same audio has already been transcribed
    /// against the same (provider, model, mode). Default impl returns
    /// <c>null</c> so legacy test doubles compile; production overrides hit
    /// <c>ssf.transcript_history</c>.
    /// </summary>
    Task<TranscriptHistory?> GetTranscriptHistoryAsync(
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        CancellationToken ct = default)
        => Task.FromResult<TranscriptHistory?>(null);

    /// <summary>
    /// Insert a new <see cref="TranscriptHistory"/> row with
    /// <c>ON CONFLICT DO NOTHING</c> semantics against the unique tuple
    /// <c>(audio_content_hash, transcript_provider, transcript_model_version,
    /// transcript_mode)</c>. A race between two concurrent transcribers of
    /// the same audio resolves to one persisted row; the loser silently
    /// no-ops. Used by <c>SarvamStreamingSttClient</c> /
    /// <c>SarvamVerbatimSttClient</c> after a successful Sarvam call.
    /// Default impl is a no-op so legacy test doubles compile.
    /// </summary>
    Task UpsertTranscriptHistoryAsync(
        TranscriptHistory history,
        CancellationToken ct = default)
        => Task.CompletedTask;

    // --- DATA_PRINCIPLE_SPINE sub-phase 06.1 / 06.2 (consent domain) ------
    /// <summary>
    /// Fetch the live <see cref="UserConsentState"/> row for
    /// <paramref name="userId"/>, or <c>null</c> when no row exists yet
    /// (first-ever consent interaction for that user). Default impl
    /// returns <c>null</c> so legacy test doubles compile; production
    /// <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult<UserConsentState?>(null);

    /// <summary>
    /// Persist a brand-new <see cref="UserConsentState"/> row (first toggle
    /// for this user). The handler decides between Add vs Update — the
    /// repository surface mirrors the existing
    /// <see cref="AddAuditEventAsync"/> shape (no UpdateXxx counterpart
    /// because EF tracks the entity once it is materialised through the
    /// DbContext).
    /// </summary>
    Task AddUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Replace the live <see cref="UserConsentState"/> for the user
    /// embedded in <paramref name="state"/>. The Infrastructure
    /// implementation reattaches the value via the DbSet's existing
    /// tracking entry; the in-memory test doubles overwrite their
    /// dictionary. <c>UserId</c> is the row's primary key.
    /// </summary>
    Task UpdateUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Append a <see cref="ConsentAuditEntry"/> row to the
    /// <c>ssf.consent_audit</c> ledger. The migration revokes UPDATE +
    /// DELETE on this table so an existing row can never be mutated —
    /// this method is INSERT-only by both port contract and DB
    /// privilege.
    /// </summary>
    Task AddConsentAuditEntryAsync(ConsentAuditEntry entry, CancellationToken ct = default)
        => Task.CompletedTask;

    // --- DATA_PRINCIPLE_SPINE sub-phase 10.2 / 10.4 (PII review queue) ---
    /// <summary>
    /// Append a brand-new <see cref="ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry"/>
    /// row to <c>ssf.pii_review_queue</c>. INSERT-only by privilege
    /// (migration revokes DELETE). Used by
    /// <c>ParseVoiceInputHandler</c> on every detection event that
    /// produces a redaction (auto-redacted, review-pending, or
    /// discard).
    /// </summary>
    Task AddPiiReviewQueueEntryAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry entry,
        CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Fetch the queue entry by id, or <c>null</c> when absent. Used
    /// by the approve/reject endpoints; no farm-scope check (reviewer
    /// allow-list spans all farms per OQ-6).
    /// </summary>
    Task<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry?> GetPiiReviewQueueEntryAsync(
        Guid entryId,
        CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry?>(null);

    /// <summary>
    /// List queue entries filtered by status. The admin UI calls
    /// this with <see cref="ShramSafal.Domain.Privacy.Pii.PiiReviewStatus.Pending"/>
    /// to drain the review queue.
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>> ListPiiReviewQueueAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewStatus status,
        int limit,
        CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>>(Array.Empty<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>());

    // --- DATA_PRINCIPLE_SPINE sub-phase 08.1 (DPDP rights surface) -------
    /// <summary>
    /// Enqueue a fresh <see cref="ErasureRequest"/> row for the async
    /// ErasureWorker (08.2) to process. Default impl is a no-op so test
    /// stubs that don't exercise the erasure path stay compiling; the
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task AddErasureRequestAsync(ErasureRequest request, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Enqueue a fresh <see cref="ExportRequest"/> row for the async
    /// ExportWorker (08.3) to process.
    /// </summary>
    Task AddExportRequestAsync(ExportRequest request, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Append a <see cref="BreachIncident"/> to the breach ledger
    /// (Phase 08.5 scaffolding — admin records a breach; Phase 12+
    /// wires the dispatcher).
    /// </summary>
    Task AddBreachIncidentAsync(BreachIncident incident, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Read the user's recent erasure requests for the mobile
    /// "Recent requests" UI. Default impl returns empty so test stubs
    /// stay compiling.
    /// </summary>
    Task<List<ErasureRequest>> GetErasureRequestsForUserAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<ErasureRequest>());

    Task<List<ExportRequest>> GetExportRequestsForUserAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<ExportRequest>());

    // --- AI Intelligence Plan WP-2b (Track B typed ledger writers) --------
    // Confirm-time server-side derivation (LedgerDerivationService) stages
    // these typed ssf rows on the DbSet inside CreateDailyLogHandler's
    // existing unit of work (no SaveChanges here — the handler commits). The
    // 11 tables + routine_patterns already exist, RLS-enabled, runtime-proven
    // (ADR 0023). Each writer mirrors the AddWeatherStampAsync default-no-op
    // convention (L69) so the ~28 in-tree IShramSafalRepository test doubles
    // keep compiling untouched — derivation is best-effort / NON-BLOCKING, so
    // a test double that no-ops it is harmless. Production ShramSafalRepository
    // overrides with the EF AddAsync.

    /// <summary>
    /// Stage a derived <see cref="FarmOperation"/> ledger-spine parent
    /// (inputs → operationType "application"). No SaveChanges — the handler
    /// owns the commit.
    /// </summary>
    Task AddFarmOperationAsync(FarmOperation op, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Stage a derived <see cref="ApplicationInputItem"/> child of a
    /// <see cref="FarmOperation"/> (ordinal-keyed within the input array).
    /// </summary>
    Task AddApplicationInputItemAsync(ApplicationInputItem item, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="IrrigationEntry"/> (daily_logs child).</summary>
    Task AddIrrigationEntryAsync(IrrigationEntry e, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="LabourAssignment"/> (daily_logs child).</summary>
    Task AddLabourAssignmentAsync(LabourAssignment a, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="MachineryUsage"/> (daily_logs child).</summary>
    Task AddMachineryUsageAsync(MachineryUsage m, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="ObservationEvent"/> (daily_logs child).</summary>
    Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="DisturbanceEvent"/> (daily_logs child).</summary>
    Task AddDisturbanceEventAsync(DisturbanceEvent d, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Supersession lookup — the CURRENT-version <see cref="FarmOperation"/>
    /// whose <see cref="DerivedEventKey"/> matches, or <c>null</c>. Re-derivation
    /// marks the old row superseded and inserts a new current row with the same
    /// key (append-only, never duplicates). Default impl returns <c>null</c> so
    /// test doubles compile; production filters on <c>IsCurrentVersion</c>.
    /// </summary>
    Task<FarmOperation?> GetFarmOperationByKeyAsync(string derivedEventKey, CancellationToken ct = default)
        => Task.FromResult<FarmOperation?>(null);

    /// <summary>
    /// RoutineMemory upsert lookup — the existing <see cref="RoutinePattern"/>
    /// for (<paramref name="farmId"/>, <paramref name="plotId"/>,
    /// <paramref name="operationType"/>) or <c>null</c> on first sighting.
    /// Default impl returns <c>null</c> so test doubles compile.
    /// </summary>
    Task<RoutinePattern?> GetRoutinePatternAsync(Guid farmId, Guid? plotId, string operationType, CancellationToken ct = default)
        => Task.FromResult<RoutinePattern?>(null);

    /// <summary>Stage a brand-new <see cref="RoutinePattern"/> (first confirmed sighting).</summary>
    Task AddRoutinePatternAsync(RoutinePattern p, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// DFES (dfes-companion-2026-07-11) — all <see cref="ShramSafal.Domain.Dfes.DailyRichnessAggregate"/>
    /// rows for a farm (the Phase-3 engagement fold reads these). Default impl returns empty so the
    /// in-tree IShramSafalRepository test doubles keep compiling; production overrides.
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Dfes.DailyRichnessAggregate>> GetDailyRichnessAggregatesForFarmAsync(
        Guid farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Dfes.DailyRichnessAggregate>>(
            Array.Empty<ShramSafal.Domain.Dfes.DailyRichnessAggregate>());

    // ── DFES (dfes-companion-2026-07-11) daily richness derivation ─────────────
    Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLog>>(Array.Empty<DailyLog>());

    Task<IReadOnlyList<ShramSafal.Domain.Farms.ObservationEvent>> GetObservationEventsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Farms.ObservationEvent>>(
            Array.Empty<ShramSafal.Domain.Farms.ObservationEvent>());

    /// <summary>
    /// wave-3.5, Ruling 3 (2026-08-15) — the day's system-captured
    /// <see cref="ShramSafal.Domain.Farms.WeatherStamp"/> rows, so the scorer can stop
    /// asking the farmer to repeat weather the app already holds.
    ///
    /// <para><c>ssf.weather_stamps</c> has been written on the same unit of work as the
    /// log since 20260630040851_AddWeatherStampsTable and carries its own SELECT RLS
    /// policy — but until this port existed <b>nothing had ever read it back</b>. That
    /// was the whole gap: the data was there and the farmer was still being asked.</para>
    ///
    /// <para>Same shape as <see cref="GetObservationEventsForDailyLogsAsync"/> above: an
    /// EXISTS-join child keyed by plain <c>DailyLogId</c>, read no-tracking because the
    /// scorer only inspects it. Default empty so the in-tree test doubles keep compiling;
    /// a double that does not override it simply sees no system weather, which is the
    /// pre-3.5 behaviour exactly.</para>
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Farms.WeatherStamp>> GetWeatherStampsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Farms.WeatherStamp>>(
            Array.Empty<ShramSafal.Domain.Farms.WeatherStamp>());

    // ── the rest of the day's PERSISTED spine (task-7, 2026-08-13) ─────────────
    // The richness scorer used to read the AI job's NormalizedResultJson and
    // nothing else, so every fact the farmer supplied that lives ONLY as a typed
    // row — a labour engagement, an irrigation, a machine, a disturbance — was
    // invisible to it on any log without a usable AI-JSON root. These reads give
    // the scorer the same rows the farmer actually created. Default impls return
    // empty so the in-tree test doubles keep compiling; production overrides.

    /// <summary>DFES — the <see cref="LabourAssignment"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<LabourAssignment>> GetLabourAssignmentsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<LabourAssignment>>(Array.Empty<LabourAssignment>());

    /// <summary>DFES — the <see cref="IrrigationEntry"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<IrrigationEntry>> GetIrrigationEntriesForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<IrrigationEntry>>(Array.Empty<IrrigationEntry>());

    /// <summary>DFES — the <see cref="MachineryUsage"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<MachineryUsage>> GetMachineryUsagesForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<MachineryUsage>>(Array.Empty<MachineryUsage>());

    /// <summary>DFES — the <see cref="DisturbanceEvent"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<DisturbanceEvent>> GetDisturbanceEventsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DisturbanceEvent>>(Array.Empty<DisturbanceEvent>());

    /// <summary>
    /// READ-ONLY lookup of the day's aggregate. The production implementation is
    /// <b>NO-TRACKING</b> — the returned entity is DETACHED, so mutating it (e.g.
    /// <c>ApplyDerivation</c>) and then calling <see cref="SaveChangesAsync"/> emits
    /// <b>NO UPDATE AT ALL</b>: a silent, exception-free no-op.
    /// <para><b>Do NOT use this overload when the caller intends to mutate the entity.</b>
    /// Use <see cref="GetDailyRichnessAggregateForUpdateAsync"/> for any read-modify-write.</para>
    /// </summary>
    Task<ShramSafal.Domain.Dfes.DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Dfes.DailyRichnessAggregate?>(null);

    /// <summary>
    /// FIX (dfes-companion-2026-07-11) — read the day's aggregate as a
    /// <b>CHANGE-TRACKED</b> entity, for the read-modify-write recompute path
    /// (<c>DailyRichnessDerivationService.RecomputeAsync</c>). Because the entity is
    /// attached to the DbContext, a subsequent <c>ApplyDerivation</c> +
    /// <see cref="SaveChangesAsync"/> actually emits the UPDATE.
    /// <para>This exists SPECIFICALLY because <see cref="GetDailyRichnessAggregateAsync"/>
    /// is no-tracking: mutating its detached result persisted NOTHING and froze the farmer's
    /// day score at whatever the first log of the day produced. Read-only callers
    /// (e.g. <c>GetDayUnderstandingHandler</c>) must keep using the no-tracking overload —
    /// do not collapse these two into one tracked method.</para>
    /// Default returns null so in-tree <c>IShramSafalRepository</c> test doubles keep
    /// compiling; production overrides.
    /// </summary>
    Task<ShramSafal.Domain.Dfes.DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Dfes.DailyRichnessAggregate?>(null);

    Task AddDailyRichnessAggregateAsync(
        ShramSafal.Domain.Dfes.DailyRichnessAggregate aggregate, CancellationToken ct = default)
        => Task.CompletedTask;

    // ── DFES Phase 5 — question-engine telemetry (append-only ssf.question_events) ──
    /// <summary>
    /// Stage an append-only <see cref="ShramSafal.Domain.Dfes.QuestionEvent"/> row.
    /// No SaveChanges — the handler owns the commit. Default no-op keeps existing
    /// in-tree test doubles compiling (mirrors AddWeatherStampAsync, L69).
    /// </summary>
    Task AddQuestionEventAsync(ShramSafal.Domain.Dfes.QuestionEvent e, CancellationToken ct = default)
        => Task.CompletedTask;

    // ── wave-4.2 — the two append-only consent ledgers behind the gate's one tap ──
    /// <summary>
    /// Stage an append-only <see cref="ShramSafal.Domain.Consent.TermsAcceptanceEvent"/>.
    /// No SaveChanges — the handler owns the commit, and it commits BOTH ledgers together
    /// or neither. Default no-op keeps in-tree test doubles compiling.
    /// </summary>
    Task AddTermsAcceptanceEventAsync(
        ShramSafal.Domain.Consent.TermsAcceptanceEvent e, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Stage an append-only <see cref="ShramSafal.Domain.Consent.ConsentGrantEvent"/>.
    /// Same contract as the terms ledger above.
    /// </summary>
    Task AddConsentGrantEventAsync(
        ShramSafal.Domain.Consent.ConsentGrantEvent e, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Read recent question_events for a farm (anti-repeat / cooldown feed). RLS
    /// already scopes rows to the tenant; the app layer additionally membership-checks.
    /// Default empty so test doubles compile.
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Dfes.QuestionEvent>> GetRecentQuestionEventsForFarmAsync(
        Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Dfes.QuestionEvent>>(Array.Empty<ShramSafal.Domain.Dfes.QuestionEvent>());

    /// <summary>
    /// wave-3.3, Ruling 1 (2026-08-15) — the existing append-only row for
    /// (<paramref name="dailyLogId"/>, <paramref name="questionKey"/>), if any.
    ///
    /// <para><c>ssf.question_events</c> carries <c>REVOKE UPDATE, DELETE</c>
    /// (20260713052440_AddDfesDataSpine), so an upsert is unavailable to the app role:
    /// the handler reads, then inserts. The partial unique index
    /// <c>ux_question_events_log_question</c> (20260816090000_UniqueQuestionPerLog) is the
    /// backstop for a genuine race; this read is what makes the ordinary offline retry
    /// silent rather than a 500.</para>
    ///
    /// <para>Default body returns null so the in-tree <c>IShramSafalRepository</c> test
    /// doubles keep compiling — the same convention this file already uses for
    /// <see cref="AddWeatherStampAsync"/> and <see cref="AddQuestionEventAsync"/>. A double
    /// that does not override this therefore behaves exactly as it did before wave-3.3.</para>
    /// </summary>
    Task<ShramSafal.Domain.Dfes.QuestionEvent?> FindQuestionEventAsync(
        Guid dailyLogId, string questionKey, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Dfes.QuestionEvent?>(null);

    /// <summary>
    /// task-3 (2026-08-14), founder ruling A — the gap dimensions the farmer actually
    /// ANSWERED on one local day, for the daily-richness recompute to credit.
    ///
    /// <para>Returns only what <see cref="ShramSafal.Domain.Dfes.AnsweredGap.TryFrom"/>
    /// accepts: a <c>gap.*</c> question whose response carries content. Non-gap questions
    /// and empty answers yield nothing, so silence can never score (doctrine P4). Rows the
    /// farmer explicitly SKIPPED are excluded before <c>TryFrom</c> ever sees them — it has
    /// no access to the flag, so this read is what makes "a skip yields nothing" TRUE
    /// rather than merely documented. Every instance MUST be built through <c>TryFrom</c>
    /// — it is what upper-cases the dimension, and the extractor compares dimension names
    /// with ordinal equality.</para>
    ///
    /// <para><c>question_events</c> has no local-date column, so the day is expressed as the
    /// UTC window <see cref="ShramSafal.Domain.Dfes.FarmLocalDay.UtcWindow"/> defines —
    /// the same rule the handler uses to decide which day was answered. RLS scopes rows to
    /// the caller's tenant; the app layer additionally membership-checks. Default empty so
    /// in-tree test doubles keep compiling; production overrides.</para>
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Dfes.AnsweredGap>> GetAnsweredGapsAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Dfes.AnsweredGap>>(Array.Empty<ShramSafal.Domain.Dfes.AnsweredGap>());
}
