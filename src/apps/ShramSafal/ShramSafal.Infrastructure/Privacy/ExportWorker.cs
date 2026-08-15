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
//   2. Uploads via IRawBlobStore (content-addressed: the ZIP's SHA-256
//      is the object key) + records the path in ssf.export_artifacts.
//   3. Emits AuditEvent entityType=DataExport action=Generated.
//   4. Hands the data principal a download link — OR says it cannot.
//
// ── §P0.9: THE LINK THAT WAS NEVER A LINK ────────────────────────────
//
// Step 3 used to read: "Generates a 24h-TTL presigned URL (Phase 08:
// shape-only — the InMemoryRawBlobStore + the S3 adapter both expose a
// presigned URL; the real S3 presign lands when Bootstrapper wires the
// S3 adapter for the export bucket)."
//
// Every clause of that was false. Neither IRawBlobStore nor either of
// its implementations exposes a presigner — the interface has exactly
// three members (PutAsync / GetAsync / DereferenceAsync). Nothing was
// generated: the URL was a string concatenation carrying no signature
// and no credential. And it pointed at `agrisync-exports`, a bucket that
// does not exist; the bundle actually lands in the raw blob store's
// bucket under `raw/{sha256}`.
//
// So a 404 with no authority was persisted as the download link for a
// complete DPDP personal-data export — the most sensitive artefact this
// system produces — and the request was stamped Completed. The domain
// validated the string was non-empty, which guards the shape of a value
// whose whole job is to carry authority.
//
// Doctrine P5: truthful-missing beats fake-working. Until something can
// actually mint a signed URL, this worker now says so. What it does NOT
// do is change what the export contains — the ZIP is assembled exactly
// as before, uploaded exactly as before, and indexed in
// ssf.export_artifacts exactly as before, so an operator can still
// fulfil the request from a real artefact. Only the false claim that the
// farmer has a working download link is withdrawn. Removing a dead link
// is honesty; removing content would be a privacy-rights change and is
// not in this worker's gift.
//
// WIRING A REAL PRESIGNER is the way to make this Completed again: give
// the blob store a presign capability, hand the result to
// ExportRequest.MarkCompleted, and the domain guard will accept it
// because it will carry X-Amz-Signature. Nothing else here needs to move.

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

    /// <summary>
    /// The reason recorded on the request, in the audit ledger, and in the log
    /// when the bundle is built but no signed download link can be issued.
    /// Plain enough that a support conversation can repeat it verbatim.
    /// </summary>
    public const string NoSignerReason =
        "Your data export was assembled and stored, but we could not issue a download link for it: "
        + "no signed-link service is configured on this deployment. We have not given you a link that "
        + "would not work. Your data is unchanged and nothing has been deleted — contact support with "
        + "this request id and the export will be handed over.";

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
        // Content-addressed by ZIP SHA-256 (IRawBlobStore's contract).
        // Unchanged: the bundle is still assembled and still stored.
        var rawBlobStore = sp.GetRequiredService<IRawBlobStore>();
        var blobRef = await rawBlobStore.PutAsync(ms, "application/zip", ct).ConfigureAwait(false);

        // ── §P0.9 — index + subject linkage for the export ZIP ───────
        //
        // This is the second (and only other) IRawBlobStore.PutAsync site, and
        // the object it writes is the most sensitive artefact this system
        // produces: the farmer's ENTIRE exported dataset.
        //
        // It looks already-attributable, because ssf.export_artifacts carries a
        // user_id and ErasureWorker never deletes that table. But the row does
        // not outlive the object. RetentionSweepWorker:93-130 deletes
        // export_artifacts unconditionally at 7 days, while the paired S3
        // delete (S3RawBlobStore.DereferenceAsync — a hard DeleteObjectAsync) is
        // best-effort in a try/catch AND impossible in production, which holds
        // no s3:DeleteObject permission on either media bucket. So after day 7
        // the ZIP remains in the bucket with no export_artifacts row — the exact
        // §P0.9 failure mode, on a worse object, reached by a timer rather than
        // by an erasure request.
        //
        // The linkage row needs an index row for its FK, so this upserts both,
        // the same way the orchestrator does. Constructed directly on `admin`
        // rather than resolved from `sp` so the writes go through THIS worker's
        // admin-elevated context rather than a second one. Note there is no
        // ambient transaction on this path — ShramSafalAdminDbContextFactory
        // builds its options chain with no interceptor and this worker never
        // begins one, so each statement autocommits.
        //
        // Best-effort: a linkage failure must not fail a DPDP export the farmer
        // asked for.
        //
        // ⚠️ THIS FAILURE CURRENTLY HAS NO ALERTING DESTINATION. Do not read the
        // LogError below as "someone gets paged". Verified: production Serilog
        // (appsettings.Production.json:64-95) writes to Console and a rolling
        // file at /var/log/agrisync/api-.log with retainedFileCountLimit 7.
        // There is no CloudWatch Logs sink, no metric filter anywhere under
        // aws/ or .github/, and no log shipper — the single `awslogs` reference
        // belongs to an undeployed OTel collector that ships traces and metrics,
        // not logs. So this line lands in a file on the EC2 box and is deleted
        // after seven days.
        //
        // The missing piece is already named in the programme plan §12 as an
        // open item: the `raw_blob_write_failures` metric and alarm on the
        // existing CloudWatch → SNS path. Until that ships, a silent linkage
        // failure here is invisible — on the most sensitive artefact the system
        // produces. Error level is the right level; it is just not yet a
        // destination. (AiOrchestrator.cs:1505-1510 swallows the same way; that
        // is symmetry with an existing unalerted swallow, not evidence of a
        // landing place.)
        try
        {
            await new Persistence.Repositories.ShramSafalRepository(admin)
                .UpsertRawBlobIndexAsync(blobRef, userId, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "[export] §P0.9 subject linkage failed for export ZIP sha={Sha256} user={UserId} — the export still ships, but this blob is unattributable once its export_artifacts row is swept at 7 days.",
                blobRef.Sha256,
                userId);
        }

        // blobRef.Sha256 IS the object key in the content-addressed store
        // (`raw/{sha256}`). The synthetic prefix below is retained verbatim
        // because RetentionSweepWorker.ExtractSha256 parses this exact shape
        // to age the object out — changing it would strand every artefact.
        var s3Key = $"exports/{userId:N}/{requestId:N}.zip#sha256={blobRef.Sha256}";

        // Nothing in this process can mint a signed URL: IRawBlobStore has no
        // presign member, and neither implementation has one either. Recording
        // an expiry for a link that was never issued would be a second false
        // claim on top of the first, so the column stays NULL.
        const string insertArtifactSql = @"
INSERT INTO ssf.export_artifacts(id, user_id, s3_key, created_at_utc, presigned_url_expires_at_utc)
VALUES ({0}, {1}, {2}, {3}, {4});";
        await admin.Database.ExecuteSqlRawAsync(
            insertArtifactSql,
            new object[] { Guid.NewGuid(), userId, s3Key, nowUtc, DBNull.Value },
            ct).ConfigureAwait(false);

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
                zipSize = ms.Length,
                // State the delivery outcome in the ledger rather than letting
                // "Generated" imply the farmer received anything.
                bundleStored = true,
                downloadLinkIssued = false,
                deliveryBlockedReason = NoSignerReason,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: AppVersionProvider.Current,
            deviceId: "system",
            ipHash: "sha256:system",
            sourceAiJobId: null));

        // The bundle exists; the farmer cannot reach it. From the data
        // principal's side the export did not complete, and that is what the
        // row now says. `MarkFailed` is reached from InProgress, so the FSM is
        // unchanged.
        request.MarkFailed(NoSignerReason, nowUtc);

        await admin.SaveChangesAsync(ct).ConfigureAwait(false);

        logger.LogWarning(
            "ExportWorker assembled request {RequestId} for user {UserId} ({Bytes} bytes, key {S3Key}) "
            + "but issued NO download link: no signer is wired. Request marked Failed rather than "
            + "recording an unsigned URL as a working link.",
            request.Id, userId, ms.Length, s3Key);
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

    // LEGAL_REVIEW_PENDING: README intentionally carries the marker
    // until counsel finalizes copy. Mirrors the OQ-7 i18n convention.
    //
    // (Comments moved above the signature from between `=>` and the expression:
    // `dotnet format` cannot lay that shape out and reports WHITESPACE errors it
    // will not auto-fix, which blocks the pre-commit hook for anyone who stages
    // this file. Pre-existing since before this task; whitespace only, no
    // semantic or output change to the exported README.)
    private static string BuildReadmeMarkdown(Guid userId, Guid requestId, DateTime generatedAtUtc) =>
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
