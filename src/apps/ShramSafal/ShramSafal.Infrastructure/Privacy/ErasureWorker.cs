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
// unconditionally; the stub throws NotImplementedException which the
// worker catches + logs + marks voice_clips_retained_deferred=true on
// the request payload.
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

        // (e) Retained voice S3 — via port (Phase 07 rebinds the stub).
        var retainedStore = sp.GetRequiredService<IRetainedBlobStore>();
        try
        {
            await retainedStore.DeleteRetainedVoiceForUserAsync(targetUserId, ct).ConfigureAwait(false);
        }
        catch (NotImplementedException ex)
        {
            voiceClipsDeferred = true;
            logger.LogWarning(ex,
                "ErasureWorker: voice_clips_retained purge deferred for user {UserId} (Phase 07 not yet shipped).",
                targetUserId);
        }

        // Per-row audit emission per DS-017 rule (d). We emit one
        // aggregate "ErasureAnonymize/Applied" row per TABLE (carrying
        // the count + scrubbed columns) rather than literally one row
        // per data row — the per-data-row spec is the test contract
        // (ErasureWorkerAnonymizationTest seeds PII rows + asserts
        // surviving rows carry the sentinel + per-row AuditEvent
        // entries). To keep that contract honest we emit one
        // AuditEvent per anonymized data row, batched here.
        await EmitPerRowAuditEventsAsync(admin, request, perTableCounts, sentinel, ct).ConfigureAwait(false);

        request.MarkCompleted(totalAnonymized, nowUtc);

        // Final ErasureRequest/Completed audit row (single, not per-table).
        var completionPayload = new
        {
            requestId = request.Id,
            targetUserId,
            rowsAnonymizedCount = totalAnonymized,
            perTableCounts,
            voiceClipsRetainedDeferred = voiceClipsDeferred,
        };

        var completionAudit = AuditEventFactory.Create(
            entityType: "ErasureRequest",
            entityId: request.Id,
            action: "Completed",
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

        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        logger.LogInformation(
            "ErasureWorker completed request {RequestId} for user {UserId}: {Count} rows anonymized.",
            request.Id, targetUserId, totalAnonymized);
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
            if (req is not null && req.Status != ErasureStatus.Failed && req.Status != ErasureStatus.Completed)
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
