// spec: data-principle-spine-2026-05-05/08.4
//
// Sub-phase 08.4 (per OQ-4 verdict) — daily 03:00 IST sweep of the
// in-app retention surfaces. Mirrors the ComplianceEvaluatorSweeper
// schedule shape; uses IAdminDbContextFactory<ShramSafalDbContext> for
// the DELETE.
//
// Scope (per OQ-4):
//   - ssf.export_artifacts  : DELETE rows + S3 objects > 7 days old
//   - ssf.audit_read_telemetry : DELETE rows > 30 days old
//
// voice_clips_retained is intentionally NOT swept here — that surface
// ships in Phase 07. Phase 02 S3 lifecycle handles the cold-storage
// tier.
//
// Each pass emits one ssf.retention_sweep_runs row + one AuditEvent
// (entityType="RetentionSweep", action="Executed").

using System.Globalization;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
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

            var totalRows = artifactsDeleted + telemetryDeleted;

            var sweepRow = RetentionSweepRun.Record(
                tablesSwept: "export_artifacts,audit_read_telemetry",
                rowsRemovedCount: totalRows,
                s3ObjectsRemovedCount: s3Removed,
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
                "RetentionSweepWorker pass complete: {RowsRemoved} rows + {S3Removed} S3 objects removed.",
                totalRows, s3Removed);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "RetentionSweepWorker pass failed.");
        }
    }

    private static string ExtractSha256(string s3Key)
    {
        // Key shape per ExportWorker: "exports/{user}/{req}.zip#sha256={sha}"
        var idx = s3Key.IndexOf("#sha256=", StringComparison.Ordinal);
        if (idx < 0) return string.Empty;
        return s3Key[(idx + "#sha256=".Length)..];
    }
}
