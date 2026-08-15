using ShramSafal.Domain.AI;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
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
    /// <summary>
    /// §P0.2 — this default used to FAIL OPEN. It forwarded to the unscoped
    /// overload, so any implementation that did not override it answered a
    /// farm-scoped audit request with the WHOLE ledger, silently, while the
    /// call site read as if it were scoped. Roughly 25 test doubles implement
    /// only the unscoped overload, so deleting the default is a suite-wide
    /// compile break and keeping the forward preserves the hazard.
    ///
    /// Throwing is the third option: a double that never calls this is
    /// unaffected, and one that does gets a loud stop instead of the ledger.
    /// The production override in ShramSafalRepository is the only real
    /// implementation.
    /// </summary>
    Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => throw new NotSupportedException(
            "GetAuditEventsChangedSinceAsync(farmIds, ...) has no fail-open default. "
            + "Forwarding to the unscoped overload returned the entire audit ledger "
            + "for a farm-scoped request (§P0.2). Override it on this implementation.");

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

    // --- DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) --------------
    /// <summary>
    /// Upserts the ref-count entry in <c>ssf.raw_blob_index</c> for a content-
    /// addressed raw blob the orchestrator just parked in the cold tier (see
    /// <see cref="ShramSafal.Application.Storage.IRawBlobStore.PutAsync"/>).
    /// Insert-and-set-RefCount=1 on first sighting; increment on a repeat
    /// upload of the same SHA-256. The unique key is
    /// <see cref="RawBlobRef.Sha256"/>.
    /// <para>
    /// <b>§P0.9 — <paramref name="subjectUserId"/> is the data-subject
    /// linkage.</b> The implementation also records
    /// <c>(sha256, subjectUserId)</c> in <c>ssf.raw_blob_subjects</c>,
    /// idempotently. This is the ONLY user→audio pointer that survives a DPDP
    /// erasure: the cascade deletes <c>ai_jobs WHERE user_id = X</c>, and
    /// <c>ai_jobs.raw_input_ref</c> was previously the only link, so the S3
    /// object was left permanently unattributable.
    /// </para>
    /// <para>
    /// <b>Pass <c>null</c> when the subject is genuinely unknown</b> — and only
    /// then. The linkage row is skipped, so an unknown owner is recorded as the
    /// ABSENCE of a row. Never pass <see cref="Guid.Empty"/> or a fresh GUID to
    /// fill the parameter; a fabricated owner reads as a real one and is worse
    /// than an honest gap.
    /// </para>
    /// <para>
    /// Default impl is a no-op so the dozens of in-tree
    /// <c>IShramSafalRepository</c> test doubles keep compiling. Production
    /// <c>ShramSafalRepository</c> overrides with EF Core writes; integration
    /// suites that care about ref-count semantics override as well.
    /// </para>
    /// </summary>
    Task UpsertRawBlobIndexAsync(RawBlobRef blobRef, Guid? subjectUserId, CancellationToken ct = default)
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

    // --- Labour Management read-model (Task 1.2, spec: 2026-07-13-labour-attendance-approval-design) ---

    /// <summary>
    /// All <see cref="FarmMembership"/> rows for a farm (any status) — the
    /// source for <c>GetLabourDataHandler</c>'s People assembly. Unlike
    /// <see cref="GetFarmMembershipAsync"/> (single user) this returns the
    /// whole roster. Default impl returns empty so the many in-tree
    /// <see cref="IShramSafalRepository"/> test doubles keep compiling;
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult(new List<FarmMembership>());

    /// <summary>
    /// The farm's labour <see cref="CostEntry"/> rows — <c>CategoryId</c>
    /// <c>labour_payout</c> OR <c>labour_misc</c> (Decision 3a, 2026-07-19,
    /// spec: 2026-07-13-labour-attendance-approval-design: दिलं = ALL labour
    /// money paid out, not just job-card settlements) — each paired with the
    /// linked <see cref="JobCard.AssignedWorkerUserId"/> when one exists
    /// (read at the repo layer via <c>CostEntry.JobCardId → JobCard</c>,
    /// since <c>CostEntryDto</c> does not expose <c>JobCardId</c>).
    /// <c>labour_misc</c> rows are never linked to a JobCard, so their
    /// <c>AssignedWorkerUserId</c> is always <c>null</c> — the caller counts
    /// them at the farm-wide level only, never attributes them to a person.
    /// <para>
    /// MONEY-CONSISTENCY INVARIANT — these are the EXACT SAME rows
    /// <c>GetFinanceSummaryHandler</c> sums for the "Labour" bucket
    /// (<c>labour_payout</c> + <c>labour_misc</c>). The caller (handler)
    /// applies the latest <see cref="FinanceCorrection"/> and rounding
    /// identically to that handler so the labour "Paid" figure equals the
    /// finance page.
    /// </para>
    /// Default impl returns empty so in-tree test doubles keep compiling;
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
        FarmId farmId, CancellationToken ct = default)
        => Task.FromResult(new List<(CostEntry, Guid?)>());

    /// <summary>
    /// <see cref="LabourAssignment"/> rows (voice-derived, NO-MULTIPLY
    /// descriptive attendance — count/shift/task/names only) for daily logs
    /// on this farm dated on/after <paramref name="weekStart"/>. Interim
    /// source for <c>Dashboard.ManDays</c> (sum of
    /// <see cref="LabourAssignment.WorkerCount"/>) until the Stage 5
    /// per-worker attendance ledger lands — <c>Ledger.Rows</c> stays empty
    /// until then. Default impl returns empty so in-tree test doubles keep
    /// compiling; production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<List<LabourAssignment>> GetLabourAssignmentsForFarmSinceAsync(
        FarmId farmId, DateOnly weekStart, CancellationToken ct = default)
        => Task.FromResult(new List<LabourAssignment>());

    // --- Field Operator identity (Task 11, spec: 2026-07-13-labour-attendance-approval-design) ---
    // A10: IShramSafalRepository has 28 implementors and uses default interface
    // implementations DELIBERATELY — an abstract member here produces ~135
    // compile errors across the test tree. Every member below ships a default
    // body so every existing test double keeps compiling untouched; production
    // ShramSafalRepository overrides all five.

    /// <summary>Stage a new <see cref="FieldOperator"/> identity (Task 9). No SaveChanges — the caller commits.</summary>
    Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Single <see cref="FieldOperator"/> lookup by id. <b>NOT farm-scoped by
    /// itself</b> — <c>p_user_select_field_operators</c> is a PERMISSIVE RLS
    /// policy OR-ed with the tenant policy (A11), so under a multi-farm login
    /// this can return a row belonging to a DIFFERENT farm than the caller's
    /// current <c>agrisync.farm_id</c>. Every caller MUST assert
    /// <see cref="FieldOperator.OriginatingFarmId"/> against the authorised
    /// farm before using the result — see <c>AttachFieldOperatorHandler</c>'s
    /// file header for the full rationale.
    /// </summary>
    Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult<FieldOperator?>(null);

    /// <summary>
    /// Single <see cref="LabourAssignment"/> lookup by id. <b>NOT farm-scoped by
    /// itself</b> — <c>p_user_select_labour_assignments</c> is the same kind of
    /// PERMISSIVE, OR-ed RLS policy as <see cref="GetFieldOperatorByIdAsync"/>
    /// above; a multi-farm caller can load a row belonging to another farm.
    /// Callers must resolve the parent <c>DailyLog</c> and assert its
    /// <c>FarmId</c> before trusting this result.
    /// </summary>
    Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult<LabourAssignment?>(null);

    /// <summary>All active-or-not <see cref="FieldOperator"/> identities originated on a farm, for the field-operator list read.</summary>
    Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperator>>([]);

    /// <summary>
    /// "ON CONFLICT DO NOTHING" insert for the (FieldOperator, LabourAssignment)
    /// attribution row — <c>true</c> = inserted, <c>false</c> = this pair
    /// already existed (a retried attach; NOT an error — Task 11.5). Mirrors
    /// <see cref="ISyncMutationStore.TryStoreSuccessAsync"/>, the one existing
    /// outcome-returning precedent in this codebase (A10). Production
    /// <c>ShramSafalRepository</c> commits immediately (its own SaveChanges) so
    /// the caller learns the real outcome; PostgreSQL specifics (SQLSTATE
    /// 23505) never leave Infrastructure — this port never throws a
    /// provider-specific exception.
    /// </summary>
    Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        => Task.FromResult(true);

    // --- Labour review & correction (Task 12b, spec: 2026-07-13-labour-attendance-approval-design) ---
    // Same A10 rule as the Task 11 block above: every member ships a DEFAULT
    // body. IShramSafalRepository has 28 implementors and an abstract member
    // here produces ~135 compile errors across the test tree. Production
    // ShramSafalRepository overrides all three.

    /// <summary>
    /// Stage an APPEND-ONLY <see cref="LabourCorrection"/> row. No SaveChanges —
    /// the caller commits it in the SAME unit of work as the in-place mutation
    /// of the <see cref="LabourAssignment"/> it explains. There is deliberately
    /// no update or delete counterpart: correction history that can itself be
    /// rewritten proves nothing.
    /// </summary>
    Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// The LIVE attribution set for one engagement — every
    /// <see cref="FieldOperatorWorkRow"/> currently pointing at it.
    /// <b>NOT farm-scoped by itself</b>, for the same reason as
    /// <see cref="GetLabourAssignmentByIdAsync"/>: <c>p_user_select_field_operator_work_rows</c>
    /// is a PERMISSIVE RLS policy OR-ed with the tenant policy, so a multi-farm
    /// caller can see rows outside the farm established for this request.
    /// Callers must assert the parent engagement's farm first.
    /// </summary>
    Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(
        Guid labourAssignmentId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);

    /// <summary>
    /// Stage the removal of one attribution row. No SaveChanges — the caller
    /// commits it together with the <see cref="LabourCorrection"/> that records
    /// WHICH operator was removed, so the deletion can never commit without its
    /// explanation (Task 12b.4).
    /// </summary>
    Task RemoveFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// STAGE-ONLY sibling of <see cref="TryAddFieldOperatorWorkRowAsync"/>. That
    /// one commits immediately (Task 11's attach route needs the real outcome
    /// before it answers the farmer); a correction cannot use it, because the
    /// added attribution and the <see cref="LabourCorrection"/> explaining it
    /// must reach the database in ONE unit of work. The unique index
    /// <c>ux_field_operator_work_rows_operator_assignment</c> remains the
    /// backstop; the correction handler pre-filters operators that are already
    /// attributed, so the ordinary re-add is a no-op rather than a violation.
    /// </summary>
    Task AddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        => Task.CompletedTask;

    // --- Labour read-back on /sync/pull (LABOUR_PHASE2 Phase 3) ---------------
    // Same A10/F7 rule as the two blocks above: BOTH members ship a DEFAULT body,
    // because an abstract member on this interface produces ~135 compile errors
    // across the 28 in-tree implementors. Production ShramSafalRepository
    // overrides both.
    //
    // Read-only, no farm parameter, and that is deliberate: the caller passes the
    // ids of daily logs it has ALREADY farm-scoped, so these can only widen to
    // children of rows the caller was entitled to. They are not a farm-scoped
    // entry point and must not be used as one.

    /// <summary>
    /// Every <see cref="LabourAssignment"/> whose parent <c>DailyLog</c> is in
    /// <paramref name="dailyLogIds"/> — the labour half of a <c>/sync/pull</c>
    /// delta, fetched in ONE round trip rather than per log.
    /// </summary>
    /// <remarks>
    /// <para><b>There is no "changed since" here, and that is not an oversight.</b>
    /// <c>ssf.labour_assignments</c> has NO <c>modified_at_utc</c> and corrections
    /// mutate the row IN PLACE, so a delta keyed on this table could not see a
    /// correction at all. The delta is the PARENT log's <c>ModifiedAtUtc</c>, which
    /// <c>CorrectLabourHandler</c> bumps; this method then returns current truth for
    /// whatever logs that delta selected. Adding a timestamp filter here would
    /// silently hide every correction.</para>
    /// <para>Ordered by <c>created_at_utc</c> so a device sees engagements in the
    /// order they were recorded.</para>
    /// </remarks>
    Task<IReadOnlyList<LabourAssignment>> GetLabourAssignmentsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<LabourAssignment>>([]);

    /// <summary>
    /// The LIVE attribution rows for a set of engagements — the bulk sibling of
    /// <see cref="GetFieldOperatorWorkRowsForAssignmentAsync"/>.
    /// </summary>
    /// <remarks>
    /// <b>NOT farm-scoped by itself</b>, exactly like its single-assignment
    /// sibling: <c>p_user_select_field_operator_work_rows</c> is a PERMISSIVE
    /// policy OR-ed with the tenant policy, and Postgres FK checks bypass RLS
    /// entirely, so a row here can carry a <c>farm_id</c> other than its parent
    /// log's. The caller must assert that itself (doctrine E4 — both sides).
    /// </remarks>
    Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentsAsync(
        IReadOnlyCollection<Guid> labourAssignmentIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);

    // --- Labour capability (LABOUR_PHASE2 Phase 5, migration ②) ---------------
    // Same A10/F7 rule as every block above, and it is LOAD-BEARING here:
    // IShramSafalRepository has 28 implementors and an ABSTRACT member on this
    // interface produces ~135 compile errors across the test tree. Both members
    // below therefore ship a DEFAULT body. Production ShramSafalRepository
    // overrides both.
    //
    // ⚠ KNOWN CONSEQUENCE, stated rather than discovered later: because the
    // default for GetLabourManagementGrantAsync is `false`, EVERY in-tree test
    // double silently reports "not granted". That is the correct fail-closed
    // direction, and it is what keeps the pre-existing Worker-denial baselines
    // (FarmMembershipAuthorizationBaselineTests) passing untouched — but it also
    // means a FUTURE test that asserts a denial can pass for the wrong reason:
    // it would pass identically against a repository that never consulted the
    // grant at all. Any test that means to prove the GRANT path must override
    // this member (see LabourCapabilityGateTests, which uses a double that
    // returns true, and the real-Postgres suite, which uses the real row).

    /// <summary>
    /// Does this user hold the EXPLICIT <c>can_manage_labour_records</c> grant
    /// on this farm? Non-terminal memberships only — a grant cannot outlive the
    /// membership that carries it.
    ///
    /// <para><b>This is one INPUT to the decision, never the decision.</b>
    /// Owner-tier and Mukadam are allowed with this flag <c>false</c>; the
    /// effective rule is <see cref="ShramSafal.Domain.Farms.LabourManagementPermission.IsAllowed"/>,
    /// resolved once in <c>LabourManagementGate</c>. Do not call this member
    /// directly from a handler.</para>
    /// </summary>
    Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(false);

    /// <summary>
    /// The caller's non-terminal <see cref="FarmMembership"/> on a farm,
    /// <b>TRACKED</b> — for the grant/revoke write path only.
    ///
    /// <para><b>Why this exists next to <see cref="GetFarmMembershipAsync"/>
    /// rather than reusing it.</b> That method is <c>AsNoTracking()</c>, so a
    /// domain mutation applied to what it returns is never persisted by
    /// <c>SaveChangesAsync</c> — the change is made on a detached POCO and
    /// silently discarded. (<c>ExitMembershipHandler</c> does exactly that
    /// today; see the Phase 5 report. Reusing the no-tracking read here would
    /// have shipped a grant endpoint that answers 200 and writes nothing.)
    /// Widening <c>GetFarmMembershipAsync</c> to tracked would change behaviour
    /// for every existing caller, so the write path gets its own read that says
    /// what it is.</para>
    /// </summary>
    Task<FarmMembership?> GetTrackedFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult<FarmMembership?>(null);

    /// <summary>
    /// The caller's <see cref="FarmMembership"/> on a farm <b>whatever its
    /// status</b>, <b>TRACKED</b> — for the exit write path only.
    ///
    /// <para><b>Why the terminal rows have to come back.</b>
    /// <c>ExitMembershipHandler</c> answers "you have already left" as an
    /// idempotent success rather than an error, because a farmer on a rural
    /// connection re-sending the same request must converge instead of being
    /// told something went wrong. That branch reads
    /// <c>membership.IsTerminal</c> — and every other membership read in this
    /// port filters <c>Revoked</c>/<c>Exited</c> out, so with any of them the
    /// branch is unreachable and a repeat exit answers "you are not a member of
    /// this farm" about a farm the caller demonstrably was a member of.</para>
    ///
    /// <para><b>Deterministic when several rows exist.</b>
    /// <c>ix_farm_memberships_farm_user_nonterminal</c> permits at most ONE
    /// non-terminal row per (farm, user) but any number of terminal ones (a
    /// worker may rejoin by QR after leaving). The live row wins; otherwise the
    /// most recently modified terminal row, so the answer does not depend on
    /// scan order.</para>
    ///
    /// <para><b>Default is the narrower sibling, deliberately.</b> Falling back
    /// to <see cref="GetTrackedFarmMembershipAsync"/> leaves every in-tree test
    /// double on the behaviour it has today (non-terminal only) instead of on
    /// <c>null</c>, so a double that has not overridden this member degrades to
    /// "not a member" — the answer it already gave — rather than to a new,
    /// silently wrong one.</para>
    /// </summary>
    Task<FarmMembership?> GetTrackedFarmMembershipIncludingTerminalAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => GetTrackedFarmMembershipAsync(farmId, userId, ct);
}
