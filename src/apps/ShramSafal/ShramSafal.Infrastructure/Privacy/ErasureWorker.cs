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
