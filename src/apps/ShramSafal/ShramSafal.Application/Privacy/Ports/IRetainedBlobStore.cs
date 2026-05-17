// spec: data-principle-spine-2026-05-05/08.7 (initial delete-only port)
// spec: voice-diary-e2e-2026-05-17 (B.4) — extended with persist + read methods
//
// Sub-phase 08.7 (per OQ-8 verdict) shipped the delete-only stub. Wave
// 1.B of the Voice Diary ship extends the port with the three methods
// the feature actually needs (persist + by-id read + by-range list);
// the existing delete signature is preserved verbatim so the
// ErasureWorker (Phase 08.2) keeps working unchanged.
//
// The shape is intentionally "delete all retained voice for this user"
// (not per-clip): the only caller of the delete path is ErasureWorker,
// which processes one ErasureRequest at a time and must purge every
// retained clip the user owns. Per-clip semantics would push the
// listing concern to the worker; the port owns it instead.
//
// Architecture rules:
//   - Pure Application port — no Infrastructure types.
//   - Result types live alongside in this file so the port is
//     self-contained at the Application boundary (mirrors how the
//     sibling IRawBlobStore co-locates RawBlobRef under Domain.Storage
//     but keeps the port shape thin).
//   - Callers pass callerUserId on read paths for app-layer auth (RLS
//     hardening of ssf.voice_clips_retained lands in Phase 07; this
//     ship's defence is the handler boundary).

using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.Privacy.Ports;

public interface IRetainedBlobStore
{
    /// <summary>
    /// Delete every retained voice clip in S3 belonging to
    /// <paramref name="userId"/>. Called by <c>ErasureWorker</c> as
    /// part of the DPDP §12 ANONYMIZE manifest (per DS-017 rule (c) the
    /// retained voice tier carries personal content and MUST be purged,
    /// not anonymized — there is nothing to anonymize in raw audio).
    ///
    /// <para>
    /// <b>Voice Diary ship contract (voice-diary-e2e-2026-05-17).</b>
    /// The throwing stub <c>PendingRetainedBlobStore</c> is DELETED in
    /// this ship; <c>S3RetainedBlobStore</c> replaces it. ErasureWorker
    /// no longer needs to catch <see cref="NotImplementedException"/>;
    /// the real adapter walks <c>ssf.voice_clips_retained</c>, deletes
    /// every S3 object, and removes the DB rows in the same logical
    /// pass. If the bucket is empty or no rows match, the method
    /// completes successfully (idempotent on second call).
    /// </para>
    /// </summary>
    Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct);

    /// <summary>
    /// Persist a single retained voice clip. <paramref name="metadata"/>
    /// carries the row to land in <c>ssf.voice_clips_retained</c>
    /// (clipId PK comes from the client per supervisor risk #1 — the
    /// client-supplied Dexie <c>voiceClips.id</c> is the same PK on the
    /// retained tier so the frontend's unified view de-dups cleanly).
    /// <paramref name="cipherBytes"/> is the sealed AES-GCM ciphertext
    /// produced by the frontend's <c>voiceEnvelope.seal()</c>; the
    /// adapter uploads to S3 under
    /// <c>retained/{userId}/{clipId}.bin</c> with SSE-S3 server-side
    /// encryption + content-type <c>application/octet-stream</c>.
    /// Returns the persisted clip id (echoes the input).
    ///
    /// <para>
    /// Idempotent on (userId, clipId): a repeated persist for an
    /// already-stored clip is a no-op and returns the same id (HEAD
    /// short-circuit pattern mirrors <c>S3RawBlobStore.PutAsync</c>).
    /// </para>
    /// </summary>
    Task<Guid> PersistAsync(
        VoiceClipRetained metadata,
        byte[] cipherBytes,
        CancellationToken ct);

    /// <summary>
    /// Fetch a single retained clip by id. Returns <c>null</c> when no
    /// row matches OR when <paramref name="callerUserId"/> does not own
    /// the row (app-layer auth — RLS hardening lands in Phase 07).
    /// </summary>
    Task<RetainedClipResult?> GetByIdAsync(
        Guid clipId,
        Guid callerUserId,
        CancellationToken ct);

    /// <summary>
    /// List metadata for every retained clip belonging to
    /// <paramref name="userId"/> whose <c>recorded_at</c> falls in
    /// [<paramref name="from"/>, <paramref name="to"/>] inclusive.
    /// Returned in descending recorded-at order (newest first) so the
    /// mobile-web calendar view can paint without re-sorting.
    /// </summary>
    Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
        Guid userId,
        DateOnly from,
        DateOnly to,
        CancellationToken ct);
}

/// <summary>
/// Single-clip projection returned by
/// <see cref="IRetainedBlobStore.GetByIdAsync"/>. Carries the sealed
/// ciphertext bytes alongside the envelope metadata the frontend
/// needs to call <c>voiceEnvelope.open()</c> client-side; the server
/// NEVER decrypts (envelope keys are tenant-scoped and held by the
/// browser per Phase 05.6 doctrine).
/// </summary>
public sealed record RetainedClipResult(
    Guid ClipId,
    Guid UserId,
    DateTime RecordedAtUtc,
    string S3Key,
    string DekId,
    string IvBase64,
    string AuthTagBase64,
    int DurationSeconds,
    string Language,
    byte[] CipherBytes);

/// <summary>
/// List-item projection used by
/// <see cref="IRetainedBlobStore.GetByRangeAsync"/>. Omits the
/// ciphertext (caller fetches each clip's bytes only when the user
/// taps play) so the calendar view paints in O(rows) without hauling
/// audio data across the wire.
/// </summary>
public sealed record VoiceClipRetainedListItem(
    Guid ClipId,
    DateTime RecordedAtUtc,
    int DurationSeconds,
    string Language,
    string S3Key);
