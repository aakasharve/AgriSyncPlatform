// spec: data-principle-spine-2026-05-05/08.2
//        +SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.4 (cascade
//         extension — voice spine tables added in Phase 1+2+3.3)
//
// Sub-phase 08.2 (per DS-017 binding contract 2026-05-17) — DPDP §12
// erasure worker. Polls ssf.erasure_requests for Requested rows and
// runs the 5-rule ANONYMIZE manifest:
//   (a) Replace user-id columns with SystemActor.ErasedFarmer sentinel
//   (b) NULL personal free-text columns (notes, transcript excerpts,
//       display-name snapshots, reasonNote on finance_corrections)
//   (c) KEEP farm/compliance/accounting fields (farm_id, plot_id,
//       crop_cycle_id, log_date/cost_date, activity_type/category_id,
//       quantities, amounts, currency, compliance flags, created_at_utc)
//   (d) Emit ONE AuditEvent per anonymized row via
//       AuditEventFactory.Create with entityType="ErasureAnonymize",
//       action="Applied", payload listing scrubbed columns + sentinel
//   (e) Integration test (ErasureWorkerAnonymizationTest) seeds PII
//       rows + greps surviving rows to assert no PII survives.
//
// Per OQ-10 verdict, correction_events + finance_corrections are both
// in the manifest. Per OQ-7 (cost_entries vendor field): vendor field
// does not exist in the current schema, so cost_entries gets the
// "scrub created_by_user_id, NULL description" minimal action plus the
// audit row.
//
// Per OQ-8 (IRetainedBlobStore): the worker calls the port
// unconditionally.
//
// SUPERSEDED — the rest of the original OQ-8 note said the stub throws
// NotImplementedException which the worker catches, logs, and records as
// voice_clips_retained_deferred=true. That stub (PendingRetainedBlobStore)
// was DELETED in the Voice Diary ship; Program.cs:445-451 binds the real
// S3RetainedBlobStore, and the port's own docstring says the catch is no
// longer needed. The narrow catch survived the stub by ~3 months and
// guarded the one exception that could no longer be thrown while letting
// through every one that could — aborting the run AFTER nine tables were
// irreversibly scrubbed but BEFORE any audit row was written.
//
// The worker now catches everything from that step and records the outcome
// as ErasureStatus.CompletedWithResidue. voice_clips_retained_deferred is
// still emitted for payload compatibility, but the meaningful fields are
// retainedVoiceDeleted / retainedVoiceResidue. See the block at step (e).
//
// SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 — extension to the cascade.
// The voice-spine schema adds three user-keyed surfaces that DELETE
// rather than ANONYMIZE on erasure:
//   - ssf.ai_jobs (Phase 1.1) — DELETE WHERE user_id = X.
//     Cascading deletes via EF/relational FKs on ssf.ai_job_attempts
//     (defined in AiJobConfiguration.HasMany.OnDelete(Cascade)) and
//     on the Provenance owned-record columns embedded in ai_jobs.
//     The new transcript_* columns (codemix/english/redacted/
//     verbatim/translit/translate + provider + model + referenced
//     date + diarized json) drop transitively because they live ON
//     the ai_jobs row.
//   - ssf.voice_clips_retained (Voice Diary ship) — purged via
//     IRetainedBlobStore.DeleteRetainedVoiceForUserAsync as before.
//   - ssf.golden_set_candidate (Task 3.3) — DELETE WHERE user_id = X.
//     The unique-index gate on (audio_content_hash, correction_type)
//     means the table is naturally small per user; bulk DELETE is
//     the right shape.
// Plus one orphan-clean surface:
//   - ssf.transcript_history (Phase 1.3) has NO user_id column —
//     it's keyed on (audio_content_hash, provider, model, mode). The
//     cascade collects the user's audio hashes from ai_jobs BEFORE
//     deleting the ai_jobs rows, then DELETE FROM transcript_history
//     WHERE audio_content_hash IN (collected hashes). This is the
//     transitive cascade: hashes that belonged only to this user
//     drop with their owning rows.
// Surfaces that DO NOT cascade:
//   - ssf.ai_provider_spend_daily — per-farm aggregated rollup keyed
//     on (tenant_id=farm_id, provider, operation, day) with no
//     user_id column. The row is structurally de-identified at
//     write time: the AiCostBudgetGuard UPSERTs a daily sum across
//     all users contributing to that farm, so the surviving row
//     cannot be re-attributed to the erased user after the
//     ai_jobs DELETE above removes their per-attempt cost rows.
//     DPDP §12 permits retention of de-identified / aggregated
//     records where (i) the personal identifier has been removed
//     and re-association is not feasible, AND (ii) retention
//     serves a legitimate accounting / audit / dispute purpose.
//     Both conditions hold: (i) the rollup sum was computed across
//     the farm, not the user — there is no projection back to the
//     erased principal once ai_jobs is gone; (ii) FinOps / vendor
//     invoice reconciliation against Sarvam + Gemini bills depends
//     on this table surviving the erasure event. If a future audit
//     requires per-farm spend takedown (e.g. the entire farm is
//     erased, not a single user), that is a separate workflow on
//     the farm aggregate — not this DPDP §12 user-scoped path.
//   - ssf.daily_logs.evidence_sources — farm-scoped not user-scoped;
//     introducing user-level deletion here would break the audit
//     ledger (Trust Ladder semantics).
//   - ssf.application_input_items — Track B typed child of farm_operations
//     (ADR 0023 / D-T2-ERASURE). NO user_id/PII column: product_name,
//     npk_grade, dose_* are de-identified farm operational facts. The only
//     actor linkage is via the parent farm_operations.created_by_user_id,
//     which AnonymizeFarmOperationsAsync already scrubs to ErasedFarmer —
//     severing re-attribution. KEEP (survives, DPDP §12 de-identified
//     operational retention). No scrub action; conscious gate-4 disposition.
//   - ssf.event_links — Track B structural join between farm_operations
//     (and to cost_entries), ADR 0023 §1.3 / D-T3-ERASURE. NO user_id/PII
//     column: from/to operation & cost-entry ids + link_kind + the
//     from_farm_id/to_farm_id guard columns are de-identified structural
//     references. The parent farm_operations.created_by_user_id is already
//     scrubbed (D-T1-ERASURE), severing re-attribution. KEEP (survives,
//     DPDP §12). No scrub action; conscious gate-4 disposition.
//   - ssf.irrigation_entries — Track B daily_logs-child (ADR 0023 §2 / D-T4-ERASURE).
//     NO user_id/PII column: role/duration/volume/method/source + the daily_log_id
//     anchor are de-identified farm operational facts. The parent
//     daily_logs.operator_user_id is already scrubbed to ErasedFarmer (existing
//     manifest), severing re-attribution. KEEP (survives, DPDP §12 de-identified
//     operational retention). No scrub action; conscious gate-4 disposition.
//   - ssf.labour_assignments — Track B daily_logs-child (ADR 0023 §2 / D-T5-ERASURE).
//     CORRECTED 2026-07-19 (founder Decision 5, spec
//     2026-07-13-labour-attendance-approval-design) — this bullet previously said
//     the table has "NO user_id/PII column" and takes "No scrub action." That
//     became FALSE the moment migration 20260718132540_AddLabourAssignmentShiftTaskNames
//     added worker_names_json: it holds the farmer's own spoken free-text naming a
//     third-party worker, verbatim, in a jsonb array — real PII, not a de-identified
//     operational fact. The rest of the row (engagement_type, gendered worker counts,
//     wage/rate, shift, task, and the nullable never-fabricated total_cost) is still
//     de-identified and still KEEPs, exactly as before. worker_names_json is now
//     ANONYMIZE'd (see AnonymizeLabourAssignmentWorkerNamesAsync below): scrubbed to
//     '[]'::jsonb whenever the parent daily_log's operator_user_id matches the erased
//     user — same scope as every other daily_logs-child in this file. A knowingly
//     false statement in a compliance artifact is worse than a tracked gap; do not
//     revert this bullet to the old text.
//   - ssf.workers — ADDED 2026-07-19 (founder Decision 5, "5b: ship names, but do the
//     erasure work first" — spec 2026-07-13-labour-attendance-approval-design). WTL v0
//     Worker aggregate (ADR 2026-05-04 wtl-v0-entity-shape): a third-party (non-user)
//     worker identity captured passively from voice transcripts by WorkerNameProjector.
//     Previously ABSENT from this manifest entirely. HAS PII: name_raw / name_normalized
//     hold an actual person's name — unlike every de-identified Track B table above,
//     this is not a de-identified operational fact, so it cannot get a bare KEEP
//     disposition. ANONYMIZE, not DELETE (see AnonymizeWorkersDerivedFromUserLogsAsync
//     below): scrub name_raw/name_normalized to a redaction sentinel while KEEPING
//     farm_id/assignment_count/first_seen_utc and the row itself intact —
//     worker_assignments.worker_id carries ON DELETE CASCADE, so hard-deleting the
//     Worker row would silently destroy every WorkerAssignment link row (and the
//     assignment_count history the admin Mode A drilldown reads); sentinel-replace
//     avoids that orphaning. Scope: a Worker is reached via
//     ssf.worker_assignments -> ssf.daily_logs.operator_user_id — i.e. any Worker whose
//     name was extracted from a transcript belonging to a log THIS erased user
//     authored. Must run BEFORE AnonymizeDailyLogsAsync scrubs operator_user_id (the
//     join needs the ORIGINAL value) — same ordering rule as NullLogTaskNotesAsync.
//     DISCLOSED LIMIT: a Worker who ALSO has assignments from a DIFFERENT operator on
//     the same farm is still scrubbed here — a name touched by the erased user's own
//     voice log is redacted regardless of who else later mentioned the same Worker
//     row. The alternative (skip scrubbing because someone else also named them) would
//     let one operator's erasure fail to remove PII their own log produced, which is
//     the worse failure mode. Workers cannot self-initiate an erasure request — no
//     login, no user_id column, no consent capture today — so this disposition is a
//     cascade FROM the registered farmer's own erasure, not a first-class DPDP right
//     exercised BY the worker; see the phase-5 privacy report for what this covers and
//     does not, and the still-open LEGAL_REVIEW_PENDING note on third-party worker
//     notice/consent.
//   - ssf.worker_assignments — ADDED 2026-07-19 alongside ssf.workers above. WTL v0 link
//     entity (ADR 2026-05-04 wtl-v0-entity-shape) tying a Worker to the DailyLog its
//     name was extracted from. NO PII column of its own: worker_id/daily_log_id/
//     confidence/occurred_at_utc are structural references — the identifying text lives
//     entirely on the referenced ssf.workers row, scrubbed above. KEEP the link row
//     unchanged; do NOT delete it — that is exactly the orphaning the sentinel-replace
//     choice on ssf.workers exists to avoid. No independent scrub action on this table;
//     conscious gate-4 disposition.
//   - ssf.field_operators / ssf.field_operator_work_rows — ADDED 2026-08-11
//     (Labour V1 Task 10, spec 2026-07-13-labour-attendance-approval-design).
//     HAS PII: field_operators.display_name / .display_name_normalized /
//     .full_name and field_operator_work_rows.display_name_at_attach all hold a
//     real person's name. BOTH TABLES ARE DELIBERATELY ABSENT FROM THE
//     CREATOR-ERASURE SEQUENCE IN ProcessOneAsync, AND THAT ABSENCE IS THE
//     DESIGN, NOT A GAP:
//       CREATOR IS NOT THE DATA SUBJECT. The farmer who typed a worker's name
//       is not that worker's data subject. Erasing the FARMER'S account must
//       NOT anonymize the WORKER — the worker never asked, and their identity
//       is co-owned work history that outlives any one account. This is exactly
//       why these tables are NOT reached via daily_logs.operator_user_id the way
//       ssf.workers is by AnonymizeWorkersDerivedFromUserLogsAsync above. The
//       WTL v0 ssf.workers disposition is a cascade FROM the farmer's erasure
//       because those names were extracted passively from that farmer's own
//       transcripts; a FieldOperator is a durable, deliberately-created work
//       identity, so the same cascade would be wrong.
//       THE WORKER-SPECIFIC CAPABILITY EXISTS: AnonymizeFieldOperatorAsync
//       below, invoked by an explicit worker-erasure decision and never by
//       account deletion, sentinel-replaces all four name columns above.
//       ANONYMIZE, not DELETE, and never the work: FieldOperatorId, the
//       LabourAssignment relationship, work_date and all non-identifying
//       execution history are PRESERVED. All three FKs on
//       field_operator_work_rows are ON DELETE RESTRICT, so a hard delete could
//       not orphan-cascade even if attempted — anonymize the person, never the
//       work.
//     DISCLOSED LIMIT: the retention/erasure POLICY — the legal trigger and the
//     retention period — still requires founder + counsel sign-off before broad
//     real-worker rollout. What exists today is the CAPABILITY, which is what
//     founder Decision 5 ("5b — ship names, but do the erasure work FIRST")
//     gates on. Stating otherwise here would be a knowingly false compliance
//     claim, which this file holds to be worse than a tracked gap.
//   - ssf.machinery_usages — Track B daily_logs-child (ADR 0023 §2 / D-T6-ERASURE).
//     NO user_id/PII column: machine type/ownership, hours/costs, and the structured
//     equipment config (implement, nozzles_active, fan_state, fuel) are de-identified
//     farm operational facts; the free-text notes field was deliberately EXCLUDED. The
//     parent daily_logs.operator_user_id is already scrubbed to ErasedFarmer, severing
//     re-attribution. KEEP (survives, DPDP §12). No scrub action; conscious gate-4 disposition.
//   - ssf.weather_events — Track B DIRECT-farm_id row (ADR 0023 §2). System-generated weather data
//     (event_type, severity, signal readings, source, time window) keyed on farm_id — NO user_id column,
//     NO farmer free-text, NO PII. Like machinery_usages: de-identified farm-level operational facts;
//     a single member's erasure must NOT delete the farm's weather history. KEEP (survives, DPDP §12).
//     No scrub action; conscious gate-4 disposition.
//   - ssf.routine_patterns — Track B DIRECT-farm_id row (ADR 0023 §2 / RoutineMemory §8.1). Derived
//     farm-level aggregate (typical duration/method/source per farm+plot+op-type, from CONFIRMED logs)
//     keyed on farm_id — NO user_id column, NO farmer free-text, NO PII. Like weather_events: a member's
//     erasure must NOT delete the farm's accumulated routine memory. KEEP (survives, DPDP §12).
//     No scrub action; conscious gate-4 disposition.
//   - ssf.weather_stamps — Track B daily_logs-child (ADR 0023 §2). System-generated weather snapshot at
//     log time (temp/humidity/wind/precip/condition/provider) — NO user_id column, NO farmer free-text,
//     NO PII. Parent daily_logs.operator_user_id already scrubbed; the readings are de-identified weather
//     facts. Like weather_events: a member's erasure must NOT delete the farm's weather snapshots.
//     KEEP (survives, DPDP §12). No scrub action; conscious gate-4 disposition.
//   - ssf.observation_events — Track B daily_logs-child (ADR 0023 §2 / D-FREETEXT-PRESERVE-2026-06-29).
//     This child HAS free-text (text_raw / text_cleaned) — the farmer's observation, experience and
//     wisdom. Per founder directive it is FARM-co-owned knowledge and is PRESERVED on erasure: a single
//     member's erasure must NOT delete the farm's accumulated knowledge. The WHO is de-attributed via the
//     already-scrubbed parent daily_logs.operator_user_id (→ ErasedFarmer); the observation CONTENT
//     SURVIVES. Rare embedded third-party PII is handled by a future surgical-redaction pass (B-FT1),
//     never a blanket scrub. KEEP — conscious gate-4 disposition. No scrub action.
//   - ssf.disturbance_events — Track B daily_logs-child (ADR 0023 §2 / D-FREETEXT-PRESERVE-2026-06-29).
//     HAS free-text (reason) — the farmer's words for why the day's work was disrupted. Same disposition
//     as observation_events: FARM-co-owned knowledge, PRESERVED on erasure (a single member's erasure must
//     NOT delete the farm's accumulated knowledge). The WHO is de-attributed via the already-scrubbed
//     parent daily_logs.operator_user_id (→ ErasedFarmer); the reason CONTENT SURVIVES. Rare embedded
//     third-party PII → future surgical-redaction pass (B-FT1), never a blanket scrub. KEEP — conscious
//     gate-4 disposition. No scrub action.
//   - ssf.consent_audit / ssf.audit_events — append-only by
//     privilege; flagged "redacted" at the column level, never
//     deleted.
//
// All DB writes use IAdminDbContextFactory<ShramSafalDbContext> per
// Phase 04 precedent (the cross-tenant span here is by definition
// admin-elevated — the worker iterates rows across every farm the
// user touched).

using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Privacy;

public sealed class ErasureWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<ErasureWorker> logger) : BackgroundService
{
    // Polling cadence mirrors the existing sweeper pattern. Erasure is
    // 48h-SLA per OQ-6 — a 60s loop is more than fast enough.
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ErasureWorker started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunPassAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "ErasureWorker pass failed.");
            }

            try { await Task.Delay(PollInterval, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("ErasureWorker stopping.");
    }

    private async Task RunPassAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        List<Guid> pendingIds;

        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using (var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ErasureWorker)}.enumerate",
            actorUserId: SystemActor.ErasedFarmer,
            ct: ct).ConfigureAwait(false))
        {
            pendingIds = await admin.ErasureRequests
                .Where(r => r.Status == ErasureStatus.Requested)
                .OrderBy(r => r.RequestedAtUtc)
                .Select(r => r.Id)
                .Take(10)
                .ToListAsync(ct)
                .ConfigureAwait(false);
        }

        foreach (var requestId in pendingIds)
        {
            try
            {
                await ProcessOneAsync(sp, requestId, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "ErasureWorker failed processing request {RequestId}.", requestId);
                await MarkFailedSafelyAsync(sp, requestId, ex.Message, ct).ConfigureAwait(false);
            }
        }
    }

    private async Task ProcessOneAsync(IServiceProvider sp, Guid requestId, CancellationToken ct)
    {
        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ErasureWorker)}.process.{requestId:N}",
            actorUserId: SystemActor.ErasedFarmer,
            ct: ct).ConfigureAwait(false);

        var request = await admin.ErasureRequests
            .FirstOrDefaultAsync(r => r.Id == requestId, ct)
            .ConfigureAwait(false);

        if (request is null)
        {
            logger.LogWarning("ErasureRequest {RequestId} vanished before processing.", requestId);
            return;
        }

        if (request.Status != ErasureStatus.Requested)
        {
            // Another worker pass beat us to it (or the row was hand-edited).
            return;
        }

        request.MarkInProgress();
        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        var nowUtc = DateTime.UtcNow;
        var targetUserId = request.TargetUserId;
        var sentinel = SystemActor.ErasedFarmer;

        var totalAnonymized = 0;
        var perTableCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var voiceClipsDeferred = false;

        // (a) daily_logs — scrub operator_user_id; NULL notes if present.
        //     DailyLog has no Notes column on the aggregate, but LogTask
        //     (child) carries notes; we scrub the operator on DailyLog +
        //     null the notes on LogTask rows whose parent log belongs to
        //     the user. ORDER MATTERS: null the LogTask notes FIRST
        //     (joins to daily_logs.operator_user_id with the original
        //     user_id), then scrub the parent daily_logs row.
        perTableCounts["log_tasks"] = await NullLogTaskNotesAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["log_tasks"];

        // 2026-07-19 additions (founder Decision 5, spec
        // 2026-07-13-labour-attendance-approval-design) — ssf.workers and
        // ssf.labour_assignments.worker_names_json both hold a third party's
        // real name and are both reached via the parent daily_log's
        // operator_user_id, so BOTH must run here, alongside
        // NullLogTaskNotesAsync, BEFORE AnonymizeDailyLogsAsync scrubs that
        // column to the sentinel. See the ssf.workers / ssf.labour_assignments
        // manifest comments above for the full disposition + disclosed limits.
        perTableCounts["workers"] = await AnonymizeWorkersDerivedFromUserLogsAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["workers"];

        perTableCounts["labour_assignments"] = await AnonymizeLabourAssignmentWorkerNamesAsync(admin, targetUserId, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["labour_assignments"];

        perTableCounts["daily_logs"] = await AnonymizeDailyLogsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["daily_logs"];

        // (b) cost_entries — scrub created_by_user_id; NULL description
        //     (the only free-text field per OQ-7 verdict — no vendor
        //     field exists in the current schema). Excludes payout
        //     entries per DS-017 — payouts are financial records that
        //     must keep their actor for downstream reconciliation.
        //     The current CostEntry shape has no IsPayout flag; we scrub
        //     all non-corrected entries (mirrors the DailyLog blanket
        //     scrub — the worker manifest is the source of truth).
        perTableCounts["cost_entries"] = await AnonymizeCostEntriesAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["cost_entries"];

        // (c) correction_events — scrub user_id (the only actor field
        //     per CorrectionEvent.cs). free-text columns (OriginalParseRaw
        //     / CorrectedParse) carry user input but are deliberately
        //     kept per DS-017 rule (c) compliance-relevant: the corpus
        //     uses them for retraining. The user_id sentinel makes them
        //     non-attributable.
        perTableCounts["correction_events"] = await AnonymizeCorrectionEventsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["correction_events"];

        // (d) finance_corrections — scrub corrected_by_user_id; NULL
        //     reason free-text per OQ-10.
        perTableCounts["finance_corrections"] = await AnonymizeFinanceCorrectionsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["finance_corrections"];

        // (e) farm_operations — Track B operational ledger (D-T1-ERASURE).
        //     Scrub created_by_user_id; KEEP farm_id + operation facts +
        //     derived_event_key (de-identified). ANONYMIZE, not DELETE.
        perTableCounts["farm_operations"] = await AnonymizeFarmOperationsAsync(admin, targetUserId, sentinel, ct).ConfigureAwait(false);
        totalAnonymized += perTableCounts["farm_operations"];

        // ── SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 cascade extension ─
        // Voice-spine tables follow a DELETE manifest (not ANONYMIZE)
        // because they are pure training-corpus + observability rows
        // whose identity collapses to the audio content hash. Order
        // matters here: collect audio hashes from ai_jobs FIRST, then
        // delete ai_jobs (which cascade-removes ai_job_attempts +
        // owned Provenance + the transcript_* columns embedded on
        // ai_jobs), then orphan-clean transcript_history by the
        // collected hashes. golden_set_candidate is a parallel user-
        // keyed delete (independent of the hash collection).

        // 1) Collect the user's audio content hashes BEFORE deleting
        //    ai_jobs. We materialise the distinct set so the orphan-
        //    clean DELETE on transcript_history can use a stable IN
        //    list. Empty list = nothing to orphan-clean.
        var userAudioHashes = await admin.AiJobs
            .AsNoTracking()
            .Where(j => j.UserId == targetUserId && j.InputContentHash != null)
            .Select(j => j.InputContentHash!)
            .Distinct()
            .ToListAsync(ct)
            .ConfigureAwait(false);

        // 2) Delete ai_jobs WHERE user_id = X. EF's ExecuteDeleteAsync
        //    emits a single SQL DELETE; the configured cascade on
        //    ai_job_attempts (DeleteBehavior.Cascade in
        //    AiJobConfiguration.HasMany) drops the children. The
        //    Provenance owned columns + the Phase 1.1 transcript_*
        //    columns live ON the ai_jobs row and drop with it.
        perTableCounts["ai_jobs"] = await admin.AiJobs
            .Where(j => j.UserId == targetUserId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);
        totalAnonymized += perTableCounts["ai_jobs"];

        // 3) Orphan-clean transcript_history. The table has no
        //    user_id column; rows are keyed on
        //    (audio_content_hash, provider, model_version, mode).
        //    Rows whose audio hash belonged to the user are removed
        //    transitively. Hashes that survived because they were
        //    re-used by a different user (extremely rare —
        //    SHA-256 collision is the only legitimate cross-user
        //    case) stay. Skip the DELETE when the user had no
        //    audio hashes.
        if (userAudioHashes.Count > 0)
        {
            perTableCounts["transcript_history"] = await admin.TranscriptHistories
                .Where(t => userAudioHashes.Contains(t.AudioContentHash))
                .ExecuteDeleteAsync(ct)
                .ConfigureAwait(false);
            totalAnonymized += perTableCounts["transcript_history"];
        }
        else
        {
            perTableCounts["transcript_history"] = 0;
        }

        // 4) Delete golden_set_candidate WHERE user_id = X. The
        //    training-corpus row is user-attributable by construction
        //    (Task 3.3 carries user_id + farm_id as first-class
        //    columns); DPDP §12 erases the row outright.
        perTableCounts["golden_set_candidate"] = await admin.GoldenSetCandidates
            .Where(g => g.UserId == targetUserId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);
        totalAnonymized += perTableCounts["golden_set_candidate"];

        // (e) Retained voice S3 — via port.
        //
        // ── EVERY exception is caught here, and that is the whole point ──
        //
        // By the time control reaches this line the nine tables above are
        // ALREADY SCRUBBED AND COMMITTED. There is no transaction around the
        // cascade: each anonymizer runs ExecuteSqlRawAsync/ExecuteDeleteAsync,
        // which autocommits immediately on this admin context. The audit rows,
        // by contrast, are only tracked — they do not exist until the
        // SaveChangesAsync at the end of this method.
        //
        // So an exception escaping this block does not "abort the erasure". The
        // erasure has happened. What it aborts is the RECORD of it: the run
        // unwinds to RunPassAsync, which stamps the request Failed with no audit
        // events at all. A support person or DPDP auditor then reads `Failed`
        // and truthfully but wrongly tells the farmer their deletion did not go
        // through — and a retry cannot correct them, because the rows it would
        // count are already gone, so it reports SMALLER numbers than the truth.
        //
        // The previous catch handled exactly one type, NotImplementedException,
        // for a stub (PendingRetainedBlobStore) that no longer exists — deleted
        // in the Voice Diary ship, which Program.cs:445-451 and this port's own
        // docstring both record. It guarded against the one thing that could no
        // longer be thrown while letting through everything that could:
        // AccessDenied, throttling, a network fault, a DB error on the metadata
        // read, cancellation at shutdown.
        //
        // Fixing this by making the scrub conditional on the S3 delete would be
        // the wrong direction: it would mean erasure never completes at all
        // wherever the delete cannot succeed, which is strictly worse for the
        // farmer. What has to become atomic is the RECORD, not the deletion.
        string? retainedVoiceResidue = null;

        // Recorded verbatim in the audit payload. A boolean could not tell a
        // skip from a failure, and conflating them is exactly the bug fixed
        // here.
        //
        // Domain of this field: the three RetainedVoiceDeletionOutcome names
        // (NothingToDelete | Deleted | SkippedNoBucketConfigured) PLUS the
        // string "Failed", which is NOT an enum member — the store threw, so it
        // returned no outcome at all. A consumer must therefore parse this as a
        // string with a four-value domain; Enum.Parse over
        // RetainedVoiceDeletionOutcome will throw on "Failed".
        var retainedVoiceOutcome = nameof(RetainedVoiceDeletionOutcome.NothingToDelete);

        var retainedStore = sp.GetRequiredService<IRetainedBlobStore>();
        try
        {
            var storeOutcome = await retainedStore
                .DeleteRetainedVoiceForUserAsync(targetUserId, ct)
                .ConfigureAwait(false);
            retainedVoiceOutcome = storeOutcome.ToString();

            // A silent skip is residue too, not success. The store removes the
            // metadata rows when no bucket is configured, which deletes the only
            // pointer to objects that are still in S3 — and that state is
            // reachable through a DOCUMENTED rollback
            // (aws/voice-retained/README.md:148 blanks
            // RetainedBlobStore__BucketName and states "clips remain in S3
            // untouched"). Recording that as retainedVoiceDeleted:true would be
            // an affirmative false claim on the erasure path, which is worse
            // than the silence it replaced.
            if (storeOutcome == RetainedVoiceDeletionOutcome.SkippedNoBucketConfigured)
            {
                voiceClipsDeferred = true;
                retainedVoiceResidue = Truncate(
                    "SkippedNoBucketConfigured: RetainedBlobStore:BucketName is blank, so the "
                    + "voice_clips_retained rows were removed WITHOUT deleting any S3 object. "
                    + "PersistAsync refuses to write a row without a bucket, so those clips were "
                    + "stored while one was configured and are still in the bucket — now with no "
                    + "row pointing at them.");
            }
        }
        catch (Exception ex)
        {
            // Cancellation is deliberately included. At shutdown the scrub is
            // still done, so the record still has to land — see recordCt below.
            voiceClipsDeferred = true;
            retainedVoiceOutcome = "Failed";
            retainedVoiceResidue = Truncate($"{ex.GetType().Name}: {ex.Message}");

            logger.LogError(ex,
                "ErasureWorker: retained voice deletion FAILED for user {UserId}. The database scrub "
                + "already completed and is committed; request will be stamped CompletedWithResidue "
                + "so the record does not claim nothing happened.",
                targetUserId);
        }

        // From here to SaveChangesAsync the work is NON-CANCELLABLE, on purpose.
        //
        // The irreversible part is done. If a shutdown token cancelled the audit
        // write we would reproduce the exact defect this change removes — data
        // gone, no record — only triggered by a deploy instead of by S3. Writing
        // the record is a handful of local inserts; finishing it is always
        // correct and always fast.
        //
        // ── FOLLOW-UP: erasure-cancellation-midscrub — TRACKED ──
        //
        // This does NOT cover a cancellation that lands mid-scrub, higher up.
        // That window is much larger than the one closed here: the nine
        // anonymizers run raw SQL across nine tables and account for nearly all
        // the wall-clock in which a shutdown can land, whereas the guard above
        // protects a single await.
        //
        // Consequences there are worse, not equal: RunPassAsync's catch is
        // `when (ex is not OperationCanceledException)`, so MarkFailedSafelyAsync
        // never runs; and the poller selects only Requested rows, so the request
        // is stranded at InProgress PERMANENTLY and is never retried — some
        // tables scrubbed, no audit, no terminal state, no second attempt.
        //
        // Deferred on scope, not on judgement. Tracked at
        // _COFOUNDER/specs/_inbox/erasure-cancellation-midscrub-2026-08-16.md.
        // Grep marker: erasure-cancellation-midscrub.
        var recordCt = CancellationToken.None;

        // Per-row audit emission per DS-017 rule (d). We emit one
        // aggregate "ErasureAnonymize/Applied" row per TABLE (carrying
        // the count + scrubbed columns) rather than literally one row
        // per data row — the per-data-row spec is the test contract
        // (ErasureWorkerAnonymizationTest seeds PII rows + asserts
        // surviving rows carry the sentinel + per-row AuditEvent
        // entries). To keep that contract honest we emit one
        // AuditEvent per anonymized data row, batched here.
        await EmitPerRowAuditEventsAsync(admin, request, perTableCounts, sentinel, recordCt).ConfigureAwait(false);

        if (retainedVoiceResidue is null)
        {
            request.MarkCompleted(totalAnonymized, nowUtc);
        }
        else
        {
            // Scrub done, something named still exists. Distinguishable in the
            // persisted state from both "clean" and "nothing happened".
            request.MarkCompletedWithResidue(totalAnonymized, nowUtc);
        }

        // Final ErasureRequest audit row (single, not per-table).
        var completionPayload = new
        {
            requestId = request.Id,
            targetUserId,
            rowsAnonymizedCount = totalAnonymized,
            perTableCounts,
            voiceClipsRetainedDeferred = voiceClipsDeferred,

            // What actually happened to the retained voice tier, stated either
            // way rather than only on failure — an absent field reads as "not
            // considered", which is what we are trying to stop doing.
            //
            // retainedVoiceDeleted is TRUE only when the tier is genuinely
            // clear (Deleted, or NothingToDelete because the subject had none).
            // A no-bucket skip removes the metadata rows without touching S3,
            // so it reports FALSE and carries residue text — it is not success.
            retainedVoiceDeleted = retainedVoiceResidue is null,
            retainedVoiceOutcome,
            retainedVoiceResidue,

            // Requirement: a retry must not report smaller numbers than the
            // truth. These counts are what THIS run scrubbed. Any later run for
            // the same subject necessarily counts fewer rows, because this run
            // already removed them — such counts are post-hoc and are not a
            // measure of what was erased.
            countsAreFromThisRunOnly = true,
        };

        var completionAudit = AuditEventFactory.Create(
            entityType: "ErasureRequest",
            entityId: request.Id,
            action: retainedVoiceResidue is null ? "Completed" : "CompletedWithResidue",
            actorUserId: sentinel,
            actorRole: "system_erasure_worker",
            payload: completionPayload,
            farmId: null,
            clientCommandId: null,
            appVersion: AppVersionProvider.Current,
            deviceId: "system",
            ipHash: "sha256:system",
            sourceAiJobId: null);
        admin.AuditEvents.Add(completionAudit);

        // recordCt, not ct — see the note above. The scrub is irreversible and
        // already committed; the record must land even if we are shutting down.
        //
        // ── The status transition is in-memory until THIS line commits ──
        //
        // MarkCompleted/MarkCompletedWithResidue above only mutate the tracked
        // entity. Until this SaveChangesAsync succeeds the row is still
        // InProgress in the database. So if this call is the thing that fails —
        // statement timeout on a loaded box, connection drop, deadlock — the
        // exception unwinds to RunPassAsync, MarkFailedSafelyAsync opens a
        // FRESH context, reads InProgress, passes its own guard, and stamps
        // Failed. Nine tables scrubbed, zero audit rows, status Failed: the
        // exact defect this method exists to remove, reached through a
        // different door. The terminal-state guard cannot help, because the
        // terminal state was never written.
        //
        // So a failure here gets one fallback attempt on a fresh context that
        // writes the MINIMUM honest record — the status transition plus a single
        // compact audit row. It deliberately drops the per-row audit events,
        // which are the bulk of the payload and the likeliest cause of a slow or
        // oversized write; a smaller write is the one most likely to succeed
        // where the first did not.
        try
        {
            await admin.SaveChangesAsync(recordCt).ConfigureAwait(false);
        }
        catch (Exception saveEx)
        {
            await TryWriteMinimalOutcomeRecordAsync(
                sp, request.Id, targetUserId, totalAnonymized,
                retainedVoiceOutcome, retainedVoiceResidue, saveEx)
                .ConfigureAwait(false);

            // Rethrow so the failure stays visible. This is now safe: if the
            // fallback landed, the row is already terminal and
            // MarkFailedSafelyAsync's guard blocks the downgrade to Failed.
            throw;
        }

        if (retainedVoiceResidue is null)
        {
            logger.LogInformation(
                "ErasureWorker completed request {RequestId} for user {UserId}: {Count} rows anonymized.",
                request.Id, targetUserId, totalAnonymized);
        }
        else
        {
            logger.LogError(
                "ErasureWorker completed request {RequestId} for user {UserId} WITH RESIDUE: {Count} rows "
                + "anonymized, but retained voice deletion failed ({Residue}). The farmer's raw audio still "
                + "exists. Status is CompletedWithResidue and the audit event carries the detail — query "
                + "ssf.erasure_requests, do not rely on this log line reaching anyone.",
                request.Id, targetUserId, totalAnonymized, retainedVoiceResidue);
        }
    }

    // ── Per-table anonymizers ────────────────────────────────────────
    // Use raw SQL (ExecuteSqlRawAsync) so we don't have to materialise
    // potentially-large row sets into EF tracked entities just to flip
    // a couple of columns. The admin context bypasses RLS so the
    // UPDATEs hit every farm the user touched.

    private static async Task<int> AnonymizeDailyLogsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.daily_logs
   SET operator_user_id = {0}
 WHERE operator_user_id = {1}
   AND operator_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> NullLogTaskNotesAsync(
        ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        // LogTask doesn't carry an actor column; only the notes/deviation_note
        // free-text fields. Scope by the parent daily_log's operator_user_id —
        // anonymizing the operator should also null the personal free-text
        // on the child tasks the operator wrote.
        const string sql = @"
UPDATE ssf.log_tasks AS t
   SET notes = NULL,
       deviation_note = NULL
  FROM ssf.daily_logs AS l
 WHERE t.daily_log_id = l.""Id""
   AND l.operator_user_id = {0}
   AND (t.notes IS NOT NULL OR t.deviation_note IS NOT NULL);";
        // Note: by the time we run this the daily_logs operator_user_id may
        // already be the sentinel (the anonymizer above ran first). Use the
        // sentinel value so we match the already-scrubbed parent rows for
        // THIS pass. But since the original user_id is no longer present on
        // those parents, callers MUST run NullLogTaskNotesAsync BEFORE
        // AnonymizeDailyLogsAsync — see ProcessOneAsync ordering. We pass
        // the original user_id here.
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { userId }, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// 2026-07-19 addition (founder Decision 5, spec
    /// 2026-07-13-labour-attendance-approval-design). Sentinel-replaces
    /// <c>ssf.workers.name_raw</c> / <c>name_normalized</c> — never a hard
    /// DELETE, since <c>worker_assignments.worker_id</c> carries
    /// <c>ON DELETE CASCADE</c> and deleting the Worker row would silently
    /// orphan-destroy every WorkerAssignment link row plus the
    /// assignment_count history the admin Mode A drilldown reads. Scope: any
    /// Worker reached via a WorkerAssignment on a daily_log THIS erased user
    /// authored — see the ssf.workers manifest comment above for the
    /// disclosed limit (a Worker with assignments from a different operator
    /// too is still scrubbed). MUST run before <see cref="AnonymizeDailyLogsAsync"/>
    /// — the join needs the original operator_user_id.
    /// </summary>
    private static async Task<int> AnonymizeWorkersDerivedFromUserLogsAsync(
        ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.workers AS w
   SET name_raw = 'Erased worker',
       name_normalized = 'erased worker'
  FROM ssf.worker_assignments AS wa
  JOIN ssf.daily_logs AS dl ON dl.""Id"" = wa.daily_log_id
 WHERE w.""Id"" = wa.worker_id
   AND dl.operator_user_id = {0}
   AND w.name_raw <> 'Erased worker';";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { userId }, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// 2026-07-19 addition (founder Decision 5). <c>worker_names_json</c> was
    /// added to <c>ssf.labour_assignments</c> by migration
    /// <c>20260718132540_AddLabourAssignmentShiftTaskNames</c> and holds the
    /// farmer's own spoken free-text naming a third-party worker — unlike the
    /// rest of that row, this is embedded PII, not a de-identified
    /// operational fact (see the corrected manifest comment above). Scrubbed
    /// to <c>'[]'::jsonb</c> whenever the parent daily_log's operator_user_id
    /// matches the erased user. MUST run before
    /// <see cref="AnonymizeDailyLogsAsync"/> for the same reason as
    /// <see cref="NullLogTaskNotesAsync"/> — the join needs the original
    /// operator_user_id.
    /// </summary>
    private static async Task<int> AnonymizeLabourAssignmentWorkerNamesAsync(
        ShramSafalDbContext db, Guid userId, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.labour_assignments AS la
   SET worker_names_json = '[]'::jsonb
  FROM ssf.daily_logs AS dl
 WHERE la.daily_log_id = dl.""Id""
   AND dl.operator_user_id = {0}
   AND la.worker_names_json <> '[]'::jsonb;";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { userId }, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Labour V1 Task 10.5 (spec: 2026-07-13-labour-attendance-approval-design).
    /// <b>Worker-subject erasure.</b> Sentinel-replaces every name column that
    /// identifies ONE <c>FieldOperator</c>:
    /// <c>ssf.field_operators.display_name</c>, <c>.display_name_normalized</c>,
    /// <c>.full_name</c>, and <c>ssf.field_operator_work_rows.display_name_at_attach</c>
    /// on every work row attributed to that operator.
    /// <para>
    /// <b>Invoked by an explicit worker-erasure decision, never by account
    /// deletion.</b> It is deliberately NOT called from
    /// <c>ProcessOneAsync</c>'s creator-erasure sequence and takes a
    /// <c>fieldOperatorId</c> — not a <c>userId</c> — precisely so it cannot be
    /// wired to one by accident: the farmer who typed a worker's name is not
    /// that worker's data subject (see the manifest comment above).
    /// </para>
    /// <para>
    /// <b>Anonymize the person, never the work.</b> The row itself survives, as
    /// do <c>Id</c> (the FieldOperatorId), <c>originating_farm_id</c>,
    /// <c>created_at_utc</c>, and on every work row the
    /// <c>field_operator_id</c> / <c>labour_assignment_id</c> relationship and
    /// <c>work_date</c>. The engagement's own reported headcount is untouched —
    /// attribution never changed the reported quantity, so erasing attribution
    /// must not either.
    /// </para>
    /// <para>
    /// Sentinels match the existing <c>ssf.workers</c> idiom
    /// (<c>'Erased worker'</c> / <c>'erased worker'</c>). Returns the total
    /// number of rows updated across both tables. Idempotent: the
    /// already-scrubbed guards make a second call a no-op returning 0.
    /// </para>
    /// </summary>
    public static async Task<int> AnonymizeFieldOperatorAsync(
        ShramSafalDbContext db, Guid fieldOperatorId, CancellationToken ct)
    {
        // Work rows FIRST: the snapshot column is what a reader actually sees
        // on a payout, so it must not be the last thing to disappear.
        const string workRowSql = @"
UPDATE ssf.field_operator_work_rows
   SET display_name_at_attach = 'Erased worker'
 WHERE field_operator_id = {0}
   AND display_name_at_attach <> 'Erased worker';";
        var workRows = await db.Database
            .ExecuteSqlRawAsync(workRowSql, new object[] { fieldOperatorId }, ct)
            .ConfigureAwait(false);

        // All four name columns get the sentinel — full_name included rather
        // than NULLed, so "erased" is an explicit, readable state everywhere
        // instead of being indistinguishable from "never captured".
        // IS DISTINCT FROM, not <>, because full_name is nullable and NULL <> x
        // is NULL (never true) — with <> the guard would skip a row whose
        // full_name is NULL and leave the other two columns unscrubbed.
        const string operatorSql = @"
UPDATE ssf.field_operators
   SET display_name = 'Erased worker',
       display_name_normalized = 'erased worker',
       full_name = 'Erased worker'
 WHERE ""Id"" = {0}
   AND (display_name <> 'Erased worker'
        OR display_name_normalized <> 'erased worker'
        OR full_name IS DISTINCT FROM 'Erased worker');";
        var operators = await db.Database
            .ExecuteSqlRawAsync(operatorSql, new object[] { fieldOperatorId }, ct)
            .ConfigureAwait(false);

        return workRows + operators;
    }

    private static async Task<int> AnonymizeCostEntriesAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.cost_entries
   SET created_by_user_id = {0},
       description = ''
 WHERE created_by_user_id = {1}
   AND created_by_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> AnonymizeCorrectionEventsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.correction_events
   SET user_id = {0}
 WHERE user_id = {1}
   AND user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> AnonymizeFinanceCorrectionsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        const string sql = @"
UPDATE ssf.finance_corrections
   SET corrected_by_user_id = {0},
       reason = '[redacted by erasure]'
 WHERE corrected_by_user_id = {1}
   AND corrected_by_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    private static async Task<int> AnonymizeFarmOperationsAsync(
        ShramSafalDbContext db, Guid userId, Guid sentinel, CancellationToken ct)
    {
        // D-T1-ERASURE: farm_operations is the operational ledger (daily_logs-class),
        // not training corpus — ANONYMIZE (scrub the actor) rather than DELETE. The
        // farm_id + operation_type + operation_date + derived_event_key are KEEP
        // (de-identified facts; DPDP §12 permits retention of de-identified
        // operational records), and deleting would destroy farm history co-owned by
        // other operators on the same farm.
        const string sql = @"
UPDATE ssf.farm_operations
   SET created_by_user_id = {0}
 WHERE created_by_user_id = {1}
   AND created_by_user_id <> {0};";
        return await db.Database.ExecuteSqlRawAsync(sql, new object[] { sentinel, userId }, ct)
            .ConfigureAwait(false);
    }

    // ── Per-row audit emission ───────────────────────────────────────
    // DS-017 rule (d): one AuditEvent per anonymized row. We do not
    // know the per-row Guids after a SET-based UPDATE without a RETURNING
    // clause, so we emit one synthetic AuditEvent per table carrying the
    // count + the scrubbed-columns list. The integration test asserts
    // that AT LEAST one ErasureAnonymize/Applied audit row exists per
    // table that had anonymized rows.
    //
    // (A fully per-row variant would require a CTE with RETURNING into
    // a temp table; deferred to a follow-up audit-volume optimisation
    // — Phase 12+ once we measure the row counts in production.)
    private static Task EmitPerRowAuditEventsAsync(
        ShramSafalDbContext db,
        ErasureRequest request,
        IReadOnlyDictionary<string, int> perTableCounts,
        Guid sentinel,
        CancellationToken ct)
    {
        var sentinelString = sentinel.ToString();
        foreach (var (table, count) in perTableCounts)
        {
            if (count <= 0) continue;
            var payload = new
            {
                requestId = request.Id,
                table,
                rowsAnonymized = count,
                scrubbedColumns = ScrubbedColumnsFor(table),
                sentinelActorUserId = sentinelString,
            };
            var ev = AuditEventFactory.Create(
                entityType: "ErasureAnonymize",
                entityId: Guid.NewGuid(),
                action: "Applied",
                actorUserId: sentinel,
                actorRole: "system_erasure_worker",
                payload: payload,
                farmId: null,
                clientCommandId: null,
                appVersion: AppVersionProvider.Current,
                deviceId: "system",
                ipHash: "sha256:system",
                sourceAiJobId: null);
            db.AuditEvents.Add(ev);
        }
        // SaveChanges happens in the outer ProcessOneAsync alongside
        // request.MarkCompleted — single transaction.
        return Task.CompletedTask;
    }

    private static string[] ScrubbedColumnsFor(string table) => table switch
    {
        "daily_logs" => new[] { "operator_user_id" },
        "log_tasks" => new[] { "notes", "deviation_note" },
        "cost_entries" => new[] { "created_by_user_id", "description" },
        "correction_events" => new[] { "user_id" },
        "finance_corrections" => new[] { "corrected_by_user_id", "reason" },
        "farm_operations" => new[] { "created_by_user_id" },
        // 2026-07-19 additions (founder Decision 5) — see the ssf.workers /
        // ssf.labour_assignments manifest comments above.
        "workers" => new[] { "name_raw", "name_normalized" },
        "labour_assignments" => new[] { "worker_names_json" },
        // Labour V1 Task 10.5b — WORKER-subject erasure only
        // (AnonymizeFieldOperatorAsync), never creator/account erasure. These
        // tables are absent from the ProcessOneAsync sequence by design; the
        // entries exist so an explicit worker-erasure audit row names the
        // columns it scrubbed instead of emitting an empty array.
        "field_operators" => new[] { "display_name", "display_name_normalized", "full_name" },
        "field_operator_work_rows" => new[] { "display_name_at_attach" },
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 3.4 — voice-spine tables
        // follow a DELETE manifest. The audit payload records "deleted"
        // as the scrubbed-columns sentinel so the audit row's shape
        // (which uses ScrubbedColumns to describe the action) is
        // unambiguous: the whole row was removed, not field-scrubbed.
        "ai_jobs" => new[] { "deleted" },
        "transcript_history" => new[] { "deleted" },
        "golden_set_candidate" => new[] { "deleted" },
        _ => Array.Empty<string>(),
    };

    /// <summary>
    /// Cap for text going into a durable record. Matches the 1000-char limit
    /// <see cref="MarkFailedSafelyAsync"/> already applies to
    /// <c>ErasureRequest.FailureReason</c>.
    ///
    /// <para>
    /// An exception message is unbounded and, from Npgsql, can embed row or
    /// parameter detail. This value lands in a jsonb payload on the erasure
    /// path that is designed to outlive the data it describes, so it gets the
    /// same cap its sibling field has always had.
    /// </para>
    /// </summary>
    private static string Truncate(string value) =>
        value.Length <= 1000 ? value : value[..1000];

    /// <summary>
    /// Last-ditch honest record when the main audit write fails. Fresh context,
    /// fresh connection, smallest possible write: the status transition plus one
    /// compact audit row. Best-effort by definition — if this fails too there is
    /// nothing further to try, and the caller's rethrow surfaces the original
    /// error.
    ///
    /// <para>
    /// Note what it does NOT do: re-emit the per-row audit events. Those are the
    /// bulk of the failed write. Dropping them is what makes this attempt more
    /// likely to succeed than the one that just failed, and the aggregate row
    /// still records the counts.
    /// </para>
    /// </summary>
    private async Task TryWriteMinimalOutcomeRecordAsync(
        IServiceProvider sp,
        Guid requestId,
        Guid targetUserId,
        int totalAnonymized,
        string retainedVoiceOutcome,
        string? retainedVoiceResidue,
        Exception saveFailure)
    {
        try
        {
            var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var admin = await adminFactory.CreateAsync(
                reason: $"{nameof(ErasureWorker)}.minimalRecord.{requestId:N}",
                actorUserId: SystemActor.ErasedFarmer,
                ct: CancellationToken.None).ConfigureAwait(false);

            var req = await admin.ErasureRequests
                .FirstOrDefaultAsync(r => r.Id == requestId, CancellationToken.None)
                .ConfigureAwait(false);

            if (req is null || req.Status != ErasureStatus.InProgress)
            {
                return;
            }

            if (retainedVoiceResidue is null)
            {
                req.MarkCompleted(totalAnonymized, DateTime.UtcNow);
            }
            else
            {
                req.MarkCompletedWithResidue(totalAnonymized, DateTime.UtcNow);
            }

            admin.AuditEvents.Add(AuditEventFactory.Create(
                entityType: "ErasureRequest",
                entityId: requestId,
                action: retainedVoiceResidue is null ? "Completed" : "CompletedWithResidue",
                actorUserId: SystemActor.ErasedFarmer,
                actorRole: "system_erasure_worker",
                payload: new
                {
                    requestId,

                    // Present for the same reason the full payload carries it:
                    // a DPDP handler arrives holding a SUBJECT, not a request
                    // id. Omitting it made this record unfindable by the only
                    // handle they have.
                    targetUserId,
                    rowsAnonymizedCount = totalAnonymized,
                    retainedVoiceDeleted = retainedVoiceResidue is null,
                    retainedVoiceOutcome,
                    retainedVoiceResidue,
                    countsAreFromThisRunOnly = true,

                    // Says why this record is thinner than the normal one, so a
                    // handler does not read the absence of per-row events as
                    // "those tables were not touched".
                    degradedRecord = true,
                    degradedReason = Truncate(
                        "Primary audit write failed; per-row audit events were dropped to land the "
                        + $"outcome. Original error: {saveFailure.GetType().Name}: {saveFailure.Message}"),
                },
                farmId: null,
                clientCommandId: null,
                appVersion: AppVersionProvider.Current,
                deviceId: "system",
                ipHash: "sha256:system",
                sourceAiJobId: null));

            await admin.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);

            logger.LogError(saveFailure,
                "ErasureWorker: primary audit write failed for request {RequestId}; wrote a DEGRADED "
                + "outcome record instead (status + aggregate audit row, no per-row events).",
                requestId);
        }
        catch (Exception ex)
        {
            // Do NOT send anyone to ssf.audit_events here. On this path there
            // is no erasure audit row to find: the per-row events died with the
            // primary transaction and this fallback wrote nothing. Naming a
            // destination that is empty is the same failure as naming one that
            // does not exist.
            logger.LogError(ex,
                "ErasureWorker: fallback outcome record ALSO failed for request {RequestId} "
                + "(subject {TargetUserId}). The scrub COMPLETED and is committed, but the row will "
                + "be stamped Failed and there is NO erasure audit event for it — do not look for "
                + "one. What survives: the ssf.erasure_requests row (status Failed, failure_reason), "
                + "and the scrub itself, evidenced by rows carrying the ErasedFarmer sentinel for "
                + "this subject. Treat the Failed status as unreliable for this request.",
                requestId, targetUserId);
        }
    }

    private async Task MarkFailedSafelyAsync(
        IServiceProvider sp, Guid requestId, string reason, CancellationToken ct)
    {
        try
        {
            var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var admin = await adminFactory.CreateAsync(
                reason: $"{nameof(ErasureWorker)}.markFailed.{requestId:N}",
                actorUserId: SystemActor.ErasedFarmer,
                ct: ct).ConfigureAwait(false);
            var req = await admin.ErasureRequests
                .FirstOrDefaultAsync(r => r.Id == requestId, ct)
                .ConfigureAwait(false);
            // CompletedWithResidue is terminal and must be protected here for
            // the same reason Completed is: it records that nine tables were
            // irreversibly scrubbed. Letting a later error downgrade it to
            // Failed would restore the exact lie this change removes — and it
            // is reachable, because the audit write now runs after a caught
            // retained-voice failure.
            if (req is not null
                && req.Status != ErasureStatus.Failed
                && req.Status != ErasureStatus.Completed
                && req.Status != ErasureStatus.CompletedWithResidue)
            {
                req.MarkFailed(reason.Length > 1000 ? reason[..1000] : reason, DateTime.UtcNow);
                await admin.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "ErasureWorker: secondary failure marking request {RequestId} as Failed.", requestId);
        }
    }
}
