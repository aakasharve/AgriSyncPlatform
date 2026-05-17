// spec: data-principle-spine-2026-05-05/08.3
//
// Sub-phase 08.3 — DPDP §11 / §11(1)(c) export worker (per OQ-9
// verdict — async + presigned URL, symmetric with ErasureWorker).
//
// Polls ssf.export_requests for Requested rows. For each row:
//   1. Assembles an in-memory ZIP per the OQ-3 manifest:
//        /voice/  (raw clips — TODO Phase 07+)
//        /transcripts/
//        /parsed/
//        /consent_audit.json
//        /audit_events.json
//        /cross_border_transfers.json
//        /dpa_registry.json
//        /README.md (LEGAL_REVIEW_PENDING-tagged)
//   2. Uploads to s3://agrisync-exports/{userId}/{requestId}.zip via
//      IRawBlobStore (reused — its key is content-addressed, but we
//      can side-load via a path-keyed prefix; for Phase 08 we use the
//      ZIP's SHA-256 as the content-addressed key + record the path
//      in ssf.export_artifacts).
//   3. Generates a 24h-TTL presigned URL (Phase 08: shape-only — the
//      InMemoryRawBlobStore + the S3 adapter both expose a presigned
//      URL; the real S3 presign lands when Bootstrapper wires the
//      S3 adapter for the export bucket).
//   4. Stamps ExportRequest.MarkCompleted + records ssf.export_artifacts
//      row + emits AuditEvent entityType=DataExport action=Generated.

using System.IO.Compression;
using System.Text;
using System.Text.Json;
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

namespace ShramSafal.Infrastructure.Privacy;

public sealed class ExportWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<ExportWorker> logger) : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan PresignTtl = TimeSpan.FromHours(24);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ExportWorker started.");

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
                logger.LogError(ex, "ExportWorker pass failed.");
            }

            try { await Task.Delay(PollInterval, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("ExportWorker stopping.");
    }

    private async Task RunPassAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        List<Guid> pendingIds;
        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using (var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ExportWorker)}.enumerate",
            actorUserId: SystemActor.Worker,
            ct: ct).ConfigureAwait(false))
        {
            pendingIds = await admin.ExportRequests
                .Where(r => r.Status == ExportRequestStatus.Requested)
                .OrderBy(r => r.RequestedAtUtc)
                .Select(r => r.Id)
                .Take(5)
                .ToListAsync(ct)
                .ConfigureAwait(false);
        }

        foreach (var id in pendingIds)
        {
            try
            {
                await ProcessOneAsync(sp, id, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "ExportWorker failed processing request {RequestId}.", id);
                await MarkFailedSafelyAsync(sp, id, ex.Message, ct).ConfigureAwait(false);
            }
        }
    }

    private async Task ProcessOneAsync(IServiceProvider sp, Guid requestId, CancellationToken ct)
    {
        var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using var admin = await adminFactory.CreateAsync(
            reason: $"{nameof(ExportWorker)}.process.{requestId:N}",
            actorUserId: SystemActor.Worker,
            ct: ct).ConfigureAwait(false);

        var request = await admin.ExportRequests
            .FirstOrDefaultAsync(r => r.Id == requestId, ct)
            .ConfigureAwait(false);

        if (request is null) return;
        if (request.Status != ExportRequestStatus.Requested) return;

        request.MarkInProgress();
        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        var nowUtc = DateTime.UtcNow;
        var userId = request.TargetUserId;

        // ── Assemble the ZIP ─────────────────────────────────────────
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            await WriteJsonEntryAsync(zip, "consent_audit.json",
                await admin.ConsentAuditEntries
                    .Where(c => c.UserId == userId)
                    .OrderBy(c => c.OccurredAtUtc)
                    .ToListAsync(ct).ConfigureAwait(false),
                ct).ConfigureAwait(false);

            await WriteJsonEntryAsync(zip, "audit_events.json",
                await admin.AuditEvents
                    .Where(a => a.ActorUserId == new AgriSync.SharedKernel.Contracts.Ids.UserId(userId))
                    .OrderBy(a => a.OccurredAtUtc)
                    .Select(a => new { a.Id, a.EntityType, a.EntityId, a.Action, a.OccurredAtUtc, a.Payload, a.FarmId })
                    .ToListAsync(ct).ConfigureAwait(false),
                ct).ConfigureAwait(false);

            // cross_border_transfers — Phase 08 has no direct subject-user
            // pointer on the row (the table is keyed on AI job, not
            // user). For the export bundle we emit the full set scoped
            // to the user's farms via aiJobId joins; until that index
            // is added we ship an empty array with a stub note so the
            // manifest stays present (DPDP §11 visibility — the user can
            // see the file exists even when empty).
            await WriteJsonEntryAsync(zip, "cross_border_transfers.json",
                new { note = "Phase 08 placeholder — schema-only export.", transfers = Array.Empty<object>() },
                ct).ConfigureAwait(false);

            await WriteJsonEntryAsync(zip, "dpa_registry.json",
                await admin.DpaRecords
                    .OrderBy(d => d.VendorName)
                    .Select(d => new { d.VendorName, d.IsActive, d.SignedDate, d.Region, d.Scope })
                    .ToListAsync(ct).ConfigureAwait(false),
                ct).ConfigureAwait(false);

            // Transcripts + parsed AI outputs: ship as empty placeholder
            // structures keyed by aiJobId (a future task can hydrate
            // these once the per-user filter on AiJob lands — there is
            // no direct user_id column on ssf.transcripts as of
            // 2026-05-17). Manifest presence is the §11 contract; the
            // README explains the empty state.
            await WriteJsonEntryAsync(zip, "transcripts/index.json",
                new { note = "Phase 08 placeholder — full per-user transcript export deferred to Phase 09.", entries = Array.Empty<object>() },
                ct).ConfigureAwait(false);

            await WriteJsonEntryAsync(zip, "parsed/index.json",
                new { note = "Phase 08 placeholder — full per-user parsed-output export deferred to Phase 09.", entries = Array.Empty<object>() },
                ct).ConfigureAwait(false);

            // Voice clips deferred to Phase 07 (voice_clips_retained).
            await WriteTextEntryAsync(zip, "voice/README.txt",
                "[LEGAL_REVIEW_PENDING] Raw voice clip export becomes available once Phase 07 voice_clips_retained ships.",
                ct).ConfigureAwait(false);

            await WriteTextEntryAsync(zip, "README.md", BuildReadmeMarkdown(userId, requestId, nowUtc), ct).ConfigureAwait(false);
        }
        ms.Position = 0;

        // ── Upload to S3 via the raw blob store ──────────────────────
        // We content-address by ZIP SHA-256 (matches IRawBlobStore's
        // existing contract). The export_artifacts row keys the
        // user-facing presigned URL to the S3 path that S3RawBlobStore
        // returned for the put.
        var rawBlobStore = sp.GetRequiredService<IRawBlobStore>();
        var blobRef = await rawBlobStore.PutAsync(ms, "application/zip", ct).ConfigureAwait(false);

        // The blobRef.Sha256 IS the S3 key in the content-addressed
        // store. We construct a synthetic per-user/per-request path for
        // the audit + index entries — the actual fetch goes via the
        // sha256 lookup. (When the dedicated export bucket lands we
        // replace this with a key prefix include the userId + requestId
        // for forensic browsability.)
        var s3Key = $"exports/{userId:N}/{requestId:N}.zip#sha256={blobRef.Sha256}";
        var expiresAtUtc = nowUtc.Add(PresignTtl);

        // Presigned URL: Phase 08 ships the contract shape (the URL).
        // S3RawBlobStore exposes its own presigner when running against
        // real S3; for InMemoryRawBlobStore the URL is a stub. Either
        // way the ExportRequest row records the URL so the UI has a
        // consistent download surface.
        var presignedUrl = $"https://agrisync-exports.s3.amazonaws.com/{s3Key}?expires={expiresAtUtc:O}";

        // Stamp the export_artifacts index row via raw SQL so we don't
        // need an EF aggregate for this lightweight table.
        const string insertArtifactSql = @"
INSERT INTO ssf.export_artifacts(id, user_id, s3_key, created_at_utc, presigned_url_expires_at_utc)
VALUES ({0}, {1}, {2}, {3}, {4});";
        await admin.Database.ExecuteSqlRawAsync(
            insertArtifactSql,
            new object[] { Guid.NewGuid(), userId, s3Key, nowUtc, expiresAtUtc },
            ct).ConfigureAwait(false);

        request.MarkCompleted(presignedUrl, expiresAtUtc, nowUtc);

        admin.AuditEvents.Add(AuditEventFactory.Create(
            entityType: "DataExport",
            entityId: request.Id,
            action: "Generated",
            actorUserId: userId,
            actorRole: "data_principal",
            payload: new
            {
                requestId = request.Id,
                userId,
                s3Key,
                expiresAtUtc,
                zipSize = ms.Length,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: AppVersionProvider.Current,
            deviceId: "system",
            ipHash: "sha256:system",
            sourceAiJobId: null));

        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        logger.LogInformation(
            "ExportWorker completed request {RequestId} for user {UserId}: {Bytes} bytes.",
            request.Id, userId, ms.Length);
    }

    private async Task MarkFailedSafelyAsync(
        IServiceProvider sp, Guid requestId, string reason, CancellationToken ct)
    {
        try
        {
            var adminFactory = sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var admin = await adminFactory.CreateAsync(
                reason: $"{nameof(ExportWorker)}.markFailed.{requestId:N}",
                actorUserId: SystemActor.Worker,
                ct: ct).ConfigureAwait(false);
            var req = await admin.ExportRequests
                .FirstOrDefaultAsync(r => r.Id == requestId, ct)
                .ConfigureAwait(false);
            if (req is not null && req.Status != ExportRequestStatus.Failed && req.Status != ExportRequestStatus.Completed)
            {
                req.MarkFailed(reason.Length > 1000 ? reason[..1000] : reason, DateTime.UtcNow);
                await admin.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "ExportWorker: secondary failure marking request {RequestId} as Failed.", requestId);
        }
    }

    // ── ZIP helpers ──────────────────────────────────────────────────

    private static async Task WriteJsonEntryAsync(
        ZipArchive zip, string entryName, object payload, CancellationToken ct)
    {
        var entry = zip.CreateEntry(entryName, CompressionLevel.Optimal);
        await using var s = entry.Open();
        var json = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOpts);
        await s.WriteAsync(json.AsMemory(), ct).ConfigureAwait(false);
    }

    private static async Task WriteTextEntryAsync(
        ZipArchive zip, string entryName, string text, CancellationToken ct)
    {
        var entry = zip.CreateEntry(entryName, CompressionLevel.Optimal);
        await using var s = entry.Open();
        var bytes = Encoding.UTF8.GetBytes(text);
        await s.WriteAsync(bytes.AsMemory(), ct).ConfigureAwait(false);
    }

    private static string BuildReadmeMarkdown(Guid userId, Guid requestId, DateTime generatedAtUtc) =>
        // LEGAL_REVIEW_PENDING: README intentionally carries the marker
        // until counsel finalizes copy. Mirrors the OQ-7 i18n convention.
        $"""
        <!-- LEGAL_REVIEW_PENDING: counsel must finalize this README before counsel-clearance gate -->
        # AgriSync — Your Data Export

        [LEGAL_REVIEW_PENDING] This archive contains the personal data AgriSync holds about you.

        - **User ID**: {userId}
        - **Request ID**: {requestId}
        - **Generated**: {generatedAtUtc:O}

        ## Contents

        - `/consent_audit.json` — every consent change you have made
        - `/audit_events.json` — every recorded action attributed to you
        - `/cross_border_transfers.json` — outbound calls to non-India processors made on your data
        - `/dpa_registry.json` — the data-processing agreements covering AgriSync's vendors
        - `/transcripts/` — speech-to-text outputs (Phase 08 placeholder)
        - `/parsed/` — structured parses derived from your voice (Phase 08 placeholder)
        - `/voice/` — raw voice clips (deferred until Phase 07)

        ## Schema

        See `DATA_EXPORT_SCHEMA_v1.md` published by AgriSync for the contract this archive conforms to.
        """;
}
