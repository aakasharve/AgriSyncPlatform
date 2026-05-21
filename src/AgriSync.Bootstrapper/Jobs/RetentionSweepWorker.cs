// spec: data-principle-spine-2026-05-05/08.4 + data-principle-spine-2026-05-05/phase-07-spine-hardening
//
// Sub-phase 08.4 (per OQ-4 verdict) — daily 03:00 IST sweep of the
// in-app retention surfaces. Mirrors the ComplianceEvaluatorSweeper
// schedule shape; uses IAdminDbContextFactory<ShramSafalDbContext> for
// the DELETE.
//
// Scope (per OQ-4):
//   - ssf.export_artifacts       : DELETE rows + S3 objects > 7 days old
//   - ssf.audit_read_telemetry   : DELETE rows > 30 days old
//   - ssf.voice_clips_retained   : DELETE rows + S3 objects for users
//                                   who have withdrawn FullHistoryJournal
//                                   consent OR whose clip is older than
//                                   the configured retention horizon
//                                   (default 1825 days / 5 years, per
//                                   appsettings Privacy:VoiceClipsRetained:MaxAgeDays).
//
// voice_clips_retained sweep added by Phase 07 spine-hardening (ADR-DS-009).
// Per-row AuditEvent emission diverges from ADR-DS-010 §a (per-table for
// anonymization) — see ADR-DS-009 §"Per-row sweep audit" for the rationale.
// Sweep target: VoiceClipRetained rows whose owner has UserConsentState
// FullHistoryJournal=false AND WithdrawnAtUtc IS NOT NULL OR clip age >
// Privacy:VoiceClipsRetained:MaxAgeDays (default 1825 = 5y).
//
// Each pass emits one ssf.retention_sweep_runs row + one AuditEvent
// (entityType="RetentionSweep", action="Executed") for the cron-firing
// record, AND one AuditEvent per swept voice_clips_retained row
// (entityType="VoiceClipRetained", action="RetentionSweep") carrying
// consentTokenKid in payload so DPDP §11 export can prove which signed
// token authorized retention up until the sweep.

using System.Globalization;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Jobs;

public sealed class RetentionSweepWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<RetentionSweepWorker> logger) : BackgroundService
{
    private const int ExportArtifactsTtlDays = 7;
    private const int AuditReadTelemetryTtlDays = 30;
    private const int VoiceClipsRetainedMaxAgeDaysDefault = 1825; // 5y per ADR-DS-009

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("RetentionSweepWorker started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPassAsync(stoppingToken).ConfigureAwait(false);

            // Next 03:00 IST = 21:30 UTC. Schedule the next tick at the
            // closest upcoming 21:30 UTC.
            var nowUtc = DateTime.UtcNow;
            var todayAt2130 = new DateTime(nowUtc.Year, nowUtc.Month, nowUtc.Day, 21, 30, 0, DateTimeKind.Utc);
            var nextRun = nowUtc < todayAt2130 ? todayAt2130 : todayAt2130.AddDays(1);
            var delay = nextRun - nowUtc;
            if (delay <= TimeSpan.Zero) delay = TimeSpan.FromHours(24);

            try { await Task.Delay(delay, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("RetentionSweepWorker stopping.");
    }

    private async Task RunPassAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var sp = scope.ServiceProvider;

            var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var admin = await adminFactory.CreateAsync(
                reason: $"{nameof(RetentionSweepWorker)}.sweep",
                actorUserId: SystemActor.Worker,
                ct: ct).ConfigureAwait(false);

            var nowUtc = DateTime.UtcNow;
            var exportArtifactCutoff = nowUtc.AddDays(-ExportArtifactsTtlDays);
            var auditTelemetryCutoff = nowUtc.AddDays(-AuditReadTelemetryTtlDays);

            // 1. Collect aged export_artifacts S3 keys + delete the S3
            //    objects, THEN delete the rows.
            var agedArtifacts = await admin.Database
                .SqlQueryRaw<string>(
                    "SELECT s3_key AS \"Value\" FROM ssf.export_artifacts WHERE created_at_utc < {0}",
                    exportArtifactCutoff)
                .ToListAsync(ct).ConfigureAwait(false);

            var rawBlobStore = sp.GetService<IRawBlobStore>();
            var s3Removed = 0;
            foreach (var key in agedArtifacts)
            {
                // The key encodes "exports/{user}/{request}.zip#sha256=…";
                // parse the sha256 suffix for the content-addressed
                // dereference call. If parsing fails we still delete the
                // row (the S3 lifecycle policy is the backstop).
                var sha = ExtractSha256(key);
                if (rawBlobStore is not null && !string.IsNullOrEmpty(sha))
                {
                    try
                    {
                        await rawBlobStore.DereferenceAsync(sha, ct).ConfigureAwait(false);
                        s3Removed++;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex,
                            "RetentionSweepWorker: failed to dereference S3 object for export_artifact key {Key}.",
                            key);
                    }
                }
            }

            var artifactsDeleted = await admin.Database.ExecuteSqlRawAsync(
                "DELETE FROM ssf.export_artifacts WHERE created_at_utc < {0}",
                new object[] { exportArtifactCutoff }, ct).ConfigureAwait(false);

            var telemetryDeleted = await admin.Database.ExecuteSqlRawAsync(
                "DELETE FROM ssf.audit_read_telemetry WHERE read_at_utc < {0}",
                new object[] { auditTelemetryCutoff }, ct).ConfigureAwait(false);

            // ── Phase 07 ADR-DS-009 — voice_clips_retained sweep ──────────
            var retainedBlobStore = sp.GetService<IRetainedBlobStore>();
            var config = sp.GetService<IConfiguration>();
            var (vcrRows, vcrS3) = await SweepVoiceClipsRetainedAsync(
                admin, retainedBlobStore, config, nowUtc, ct).ConfigureAwait(false);

            var totalRows = artifactsDeleted + telemetryDeleted + vcrRows;
            var totalS3 = s3Removed + vcrS3;

            var tablesSwept = vcrRows > 0
                ? "export_artifacts,audit_read_telemetry,voice_clips_retained"
                : "export_artifacts,audit_read_telemetry";

            var sweepRow = RetentionSweepRun.Record(
                tablesSwept: tablesSwept,
                rowsRemovedCount: totalRows,
                s3ObjectsRemovedCount: totalS3,
                nowUtc: nowUtc);
            admin.RetentionSweepRuns.Add(sweepRow);

            admin.AuditEvents.Add(AuditEventFactory.Create(
                entityType: "RetentionSweep",
                entityId: sweepRow.Id,
                action: "Executed",
                actorUserId: SystemActor.Worker,
                actorRole: "system_retention_sweeper",
                payload: new
                {
                    tablesSwept = sweepRow.TablesSwept,
                    rowsRemovedCount = sweepRow.RowsRemovedCount,
                    s3ObjectsRemovedCount = sweepRow.S3ObjectsRemovedCount,
                    occurredAtUtc = sweepRow.OccurredAtUtc.ToString("O", CultureInfo.InvariantCulture),
                },
                farmId: null,
                clientCommandId: null,
                appVersion: AppVersionProvider.Current,
                deviceId: "system",
                ipHash: "sha256:system",
                sourceAiJobId: null));

            await admin.SaveChangesAsync(ct).ConfigureAwait(false);

            logger.LogInformation(
                "RetentionSweepWorker pass complete: {RowsRemoved} rows + {S3Removed} S3 objects removed ({VcrRows} voice clips).",
                totalRows, totalS3, vcrRows);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "RetentionSweepWorker pass failed.");
        }
    }

    /// <summary>
    /// Phase 07 spine-hardening (ADR-DS-009) — sweep ssf.voice_clips_retained
    /// for rows whose owner has withdrawn the FullHistoryJournal consent OR
    /// whose RecordedAtUtc is older than the configured retention horizon.
    /// Per-row AuditEvent emission per ADR-DS-009 §"Per-row sweep audit"
    /// (diverges from ADR-DS-010 §a per-table erasure pattern).
    /// </summary>
    private async Task<(int rowsRemoved, int s3ObjectsDeleted)> SweepVoiceClipsRetainedAsync(
        ShramSafalDbContext admin,
        IRetainedBlobStore? retainedBlobStore,
        IConfiguration? config,
        DateTime nowUtc,
        CancellationToken ct)
    {
        if (retainedBlobStore is null)
        {
            // No retained blob store registered (e.g. tests that wire
            // IRetainedBlobStore via a sibling scope). Skip — the next
            // run picks up the rows when the store is present.
            return (0, 0);
        }

        var maxAgeDays = config?.GetValue<int?>("Privacy:VoiceClipsRetained:MaxAgeDays")
            ?? VoiceClipsRetainedMaxAgeDaysDefault;
        var ageHorizonUtc = nowUtc.AddDays(-maxAgeDays);

        // Candidate clips: owner has withdrawn FullHistoryJournal consent
        // (FullHistoryJournal=false AND WithdrawnAtUtc != null) OR the clip
        // is older than the configured retention horizon. Left-join consent
        // state via subquery so clips whose owner never created a consent
        // row (defensive: shouldn't happen per Phase 06 invariant but we
        // tolerate it by treating "no consent row" as "no grant" and
        // letting the age-horizon branch govern).
        var candidates = await admin.VoiceClipsRetained
            .AsNoTracking()
            .Select(clip => new
            {
                clip.ClipId,
                clip.UserId,
                clip.S3Key,
                clip.RecordedAtUtc,
                ConsentState = admin.UserConsentStates
                    .AsNoTracking()
                    .FirstOrDefault(c => c.UserId == clip.UserId),
            })
            .Where(x =>
                (x.ConsentState != null
                    && !x.ConsentState.FullHistoryJournal
                    && x.ConsentState.WithdrawnAtUtc != null)
                || x.RecordedAtUtc < ageHorizonUtc)
            .Select(x => new
            {
                x.ClipId,
                x.UserId,
                x.S3Key,
                x.RecordedAtUtc,
                CurrentTokenKid = x.ConsentState != null ? x.ConsentState.CurrentTokenKid : null,
                FullHistoryJournal = x.ConsentState != null && x.ConsentState.FullHistoryJournal,
            })
            .ToListAsync(ct).ConfigureAwait(false);

        if (candidates.Count == 0)
        {
            return (0, 0);
        }

        // Delete S3 objects FIRST (per-user batch — matches the existing
        // IRetainedBlobStore API). If S3 deletion fails for a user we skip
        // their DB rows so the next pass retries. Note: the per-user
        // delete also removes the DB rows inside S3RetainedBlobStore —
        // we re-query after to compute the actual delta.
        var deletedClipIdsByUser = candidates
            .GroupBy(c => c.UserId)
            .ToDictionary(g => g.Key, g => g.Select(c => c.ClipId).ToList());

        var successfullySweptUsers = new HashSet<Guid>();
        int s3DeleteCount = 0;
        foreach (var (userId, clipIds) in deletedClipIdsByUser)
        {
            try
            {
                await retainedBlobStore.DeleteRetainedVoiceForUserAsync(userId, ct).ConfigureAwait(false);
                s3DeleteCount += clipIds.Count;
                successfullySweptUsers.Add(userId);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "RetentionSweepWorker: S3 delete failed for user {UserId} (skipping audit + DB delete to preserve consistency).",
                    userId);
            }
        }

        // Per-row AuditEvent for each successfully swept clip. The
        // payload carries consentTokenKid so DPDP §11 export can prove
        // which signed consent token authorized retention until the
        // sweep moment. Emit BEFORE relying on DB delete — the
        // S3RetainedBlobStore adapter already removed the rows during
        // the per-user call above, so the audit row is the durable
        // record that the clip ever existed.
        int rowsRemoved = 0;
        foreach (var c in candidates.Where(c => successfullySweptUsers.Contains(c.UserId)))
        {
            var sweepReason = c.RecordedAtUtc < ageHorizonUtc
                ? "age_horizon"
                : "consent_withdrawn";

            var auditRow = AuditEventFactory.Create(
                entityType: "VoiceClipRetained",
                entityId: c.ClipId,
                action: "RetentionSweep",
                actorUserId: SystemActor.Worker,
                actorRole: "system_retention_sweeper",
                payload: new
                {
                    consentTokenKid = c.CurrentTokenKid, // ADR-DS-009 audit-payload kid stamp
                    clipId = c.ClipId,
                    userId = c.UserId,
                    s3Key = c.S3Key,
                    recordedAtUtc = c.RecordedAtUtc.ToString("O", CultureInfo.InvariantCulture),
                    sweepReason,
                },
                farmId: null,
                clientCommandId: null,
                appVersion: AppVersionProvider.Current,
                deviceId: "system",
                ipHash: "sha256:system",
                sourceAiJobId: null);
            admin.AuditEvents.Add(auditRow);
            rowsRemoved++;
        }

        // Belt-and-braces: ensure any orphan metadata rows from a prior
        // half-failed sweep are cleared for the users we successfully
        // swept. The S3RetainedBlobStore.DeleteRetainedVoiceForUserAsync
        // already calls SaveChanges with the row delete; this re-attach
        // is a defensive no-op when nothing remains.
        if (successfullySweptUsers.Count > 0)
        {
            var orphans = await admin.VoiceClipsRetained
                .Where(c => successfullySweptUsers.Contains(c.UserId))
                .ToListAsync(ct).ConfigureAwait(false);
            if (orphans.Count > 0)
            {
                admin.VoiceClipsRetained.RemoveRange(orphans);
            }
        }

        return (rowsRemoved, s3DeleteCount);
    }

    private static string ExtractSha256(string s3Key)
    {
        // Key shape per ExportWorker: "exports/{user}/{req}.zip#sha256={sha}"
        var idx = s3Key.IndexOf("#sha256=", StringComparison.Ordinal);
        if (idx < 0) return string.Empty;
        return s3Key[(idx + "#sha256=".Length)..];
    }
}
