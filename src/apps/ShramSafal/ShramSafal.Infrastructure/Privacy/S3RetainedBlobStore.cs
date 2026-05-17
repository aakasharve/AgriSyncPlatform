// spec: voice-diary-e2e-2026-05-17 (B.11)
//
// Wave 1.B — REPLACES the throwing PendingRetainedBlobStore stub
// (Phase 08.7) with a real S3-backed adapter. Pattern mirrors
// S3RawBlobStore at Infrastructure/Storage/S3RawBlobStore.cs (cold-
// tier raw blobs):
//   - HEAD-then-PUT idempotency (repeat persists short-circuit)
//   - SSE-S3 (AES256) when no KmsKeyId configured; AWS-KMS when set
//   - Deterministic key shape (VoiceClipRetained.BuildS3Key)
//
// Reads + writes consult ssf.voice_clips_retained via
// ShramSafalDbContext for metadata projection / ownership check; the
// S3 client only handles the ciphertext bytes. Server NEVER decrypts
// (Phase 05.6 envelope-encryption invariant).
//
// Lifetime: Scoped (mirrors S3RawBlobStore registration which the
// supervisor brief explicitly cites — the IAmazonS3 client is HTTP-
// bound and DbContext is Scoped, so Scoped is idiomatic for this
// adapter).

using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Privacy;

public sealed class S3RetainedBlobStore : IRetainedBlobStore
{
    private readonly IAmazonS3 _s3;
    private readonly RetainedBlobStoreOptions _opt;
    private readonly ShramSafalDbContext _db;

    public S3RetainedBlobStore(
        IAmazonS3 s3,
        IOptions<RetainedBlobStoreOptions> opt,
        ShramSafalDbContext db)
    {
        _s3 = s3;
        _opt = opt.Value;
        _db = db;
    }

    public async Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
    {
        if (userId == Guid.Empty)
        {
            return;
        }

        // 1. Enumerate every retained clip metadata row for the user.
        //    We delete from S3 BEFORE removing the DB row so a crash
        //    mid-flow leaves an orphan row pointing at a missing S3
        //    object (recoverable: re-run sweeps the row away on the
        //    second pass), not the inverse (orphan S3 object that no
        //    DB row can locate — leaks indefinitely).
        var rows = await _db.VoiceClipsRetained
            .Where(c => c.UserId == userId)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (rows.Count == 0)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(_opt.BucketName))
        {
            // No bucket configured (dev). Drop the metadata rows so the
            // erasure manifest still completes; the S3 objects simply
            // don't exist.
            _db.VoiceClipsRetained.RemoveRange(rows);
            await _db.SaveChangesAsync(ct).ConfigureAwait(false);
            return;
        }

        foreach (var clip in rows)
        {
            try
            {
                await _s3.DeleteObjectAsync(_opt.BucketName, clip.S3Key, ct)
                    .ConfigureAwait(false);
            }
            catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // Already gone — fine. ErasureWorker's idempotency
                // story tolerates a re-run that finds the object
                // already deleted.
            }
        }

        _db.VoiceClipsRetained.RemoveRange(rows);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<Guid> PersistAsync(
        VoiceClipRetained metadata,
        byte[] cipherBytes,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        ArgumentNullException.ThrowIfNull(cipherBytes);

        if (cipherBytes.Length == 0)
        {
            throw new ArgumentException("cipherBytes is empty", nameof(cipherBytes));
        }

        if (string.IsNullOrWhiteSpace(_opt.BucketName))
        {
            throw new InvalidOperationException(
                "RetainedBlobStore:BucketName is not configured. Set the value via "
                + "appsettings RetainedBlobStore section or RetainedBlobStore__BucketName "
                + "env var before persisting a retained voice clip.");
        }

        // Idempotency: if a row already exists for the client-supplied
        // clipId we treat the persist as a no-op (the frontend may
        // re-fire the archive call after a flaky network — same Dexie
        // PK lands here and we must not double-write).
        var existing = await _db.VoiceClipsRetained
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.ClipId == metadata.ClipId, ct)
            .ConfigureAwait(false);
        if (existing is not null)
        {
            return existing.ClipId;
        }

        // HEAD-then-PUT short-circuit on the S3 side (defends against
        // a half-written previous run that landed the object but
        // crashed before the DB insert).
        try
        {
            await _s3.GetObjectMetadataAsync(_opt.BucketName, metadata.S3Key, ct)
                .ConfigureAwait(false);
            // Object already exists; skip the PUT but still insert
            // the metadata row below.
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            using var put = new MemoryStream(cipherBytes, writable: false);
            var request = new PutObjectRequest
            {
                BucketName = _opt.BucketName,
                Key = metadata.S3Key,
                ContentType = "application/octet-stream",
                InputStream = put,
                AutoCloseStream = false,
            };

            // Mirror S3RawBlobStore's KMS-vs-AES256 split so dev
            // (no provisioned CMK) still works.
            if (string.IsNullOrWhiteSpace(_opt.KmsKeyId))
            {
                request.ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256;
            }
            else
            {
                request.ServerSideEncryptionMethod = ServerSideEncryptionMethod.AWSKMS;
                request.ServerSideEncryptionKeyManagementServiceKeyId = _opt.KmsKeyId;
            }

            await _s3.PutObjectAsync(request, ct).ConfigureAwait(false);
        }

        await _db.VoiceClipsRetained.AddAsync(metadata, ct).ConfigureAwait(false);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        return metadata.ClipId;
    }

    public async Task<RetainedClipResult?> GetByIdAsync(
        Guid clipId,
        Guid callerUserId,
        CancellationToken ct)
    {
        if (clipId == Guid.Empty || callerUserId == Guid.Empty)
        {
            return null;
        }

        // App-layer ownership filter. RLS hardening lands in Phase 07;
        // this ship pins the auth check to the application boundary by
        // including the callerUserId in the WHERE clause.
        var row = await _db.VoiceClipsRetained
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.ClipId == clipId && c.UserId == callerUserId, ct)
            .ConfigureAwait(false);

        if (row is null)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(_opt.BucketName))
        {
            // Dev path with no bucket: return metadata + empty bytes
            // so the frontend can render the row but playback will
            // surface as "no audio available".
            return new RetainedClipResult(
                ClipId: row.ClipId,
                UserId: row.UserId,
                RecordedAtUtc: row.RecordedAtUtc,
                S3Key: row.S3Key,
                DekId: row.DekId,
                IvBase64: row.IvBase64,
                AuthTagBase64: row.AuthTagBase64,
                DurationSeconds: row.DurationSeconds,
                Language: row.Language,
                CipherBytes: Array.Empty<byte>());
        }

        byte[] cipher;
        try
        {
            using var resp = await _s3
                .GetObjectAsync(_opt.BucketName, row.S3Key, ct)
                .ConfigureAwait(false);
            using var ms = new MemoryStream();
            await resp.ResponseStream.CopyToAsync(ms, ct).ConfigureAwait(false);
            cipher = ms.ToArray();
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // Metadata row points at a missing object — surface as
            // "no clip found" rather than 500. ErasureWorker cleans
            // up this shape; production should never see it.
            return null;
        }

        return new RetainedClipResult(
            ClipId: row.ClipId,
            UserId: row.UserId,
            RecordedAtUtc: row.RecordedAtUtc,
            S3Key: row.S3Key,
            DekId: row.DekId,
            IvBase64: row.IvBase64,
            AuthTagBase64: row.AuthTagBase64,
            DurationSeconds: row.DurationSeconds,
            Language: row.Language,
            CipherBytes: cipher);
    }

    public async Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
        Guid userId,
        DateOnly from,
        DateOnly to,
        CancellationToken ct)
    {
        if (userId == Guid.Empty)
        {
            return Array.Empty<VoiceClipRetainedListItem>();
        }

        if (to < from)
        {
            return Array.Empty<VoiceClipRetainedListItem>();
        }

        var fromUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        // Inclusive on `to` — end-of-day exclusive ceiling.
        var toUtc = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var rows = await _db.VoiceClipsRetained
            .AsNoTracking()
            .Where(c => c.UserId == userId
                        && c.RecordedAtUtc >= fromUtc
                        && c.RecordedAtUtc < toUtc)
            .OrderByDescending(c => c.RecordedAtUtc)
            .Select(c => new VoiceClipRetainedListItem(
                c.ClipId,
                c.RecordedAtUtc,
                c.DurationSeconds,
                c.Language,
                c.S3Key))
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return rows;
    }
}
