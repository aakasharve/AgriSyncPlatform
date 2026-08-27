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
// spec: dfes-companion-2026-07-11 (farm-memory) — ADR-DS-017.
// Two things changed here and they are worth separating.
//
// First, the "only caller is ErasureWorker" sentence above became
// briefly untrue: RetentionSweepWorker started calling this method with
// a candidate set it had computed PER CLIP, so one aged recording
// destroyed every recording its owner had. The sweep no longer deletes
// retained voice at all (ADR-DS-017 (b) — Farm Memory ends by the
// farmer's decision, never by a clock), which puts the sentence back in
// force: whole-user is the right shape precisely because erasure and
// account closure are the only two things that legitimately mean "all
// of it".
//
// Second, the method used to return a bare Task, so a caller could not
// tell "I deleted the audio" from "I dropped the pointer and left the
// audio where it was". ErasureWorker then reported a completed purge
// either way. It now returns RetainedVoiceDeletionOutcome so the caller
// can say only what actually happened — founder ITEM 4's HARD RULE and
// doctrine P4.
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
    /// <returns>
    /// What actually happened, so the caller can report the truth rather
    /// than its intent. See <see cref="RetainedVoiceDeletionOutcome"/>.
    /// </returns>
    Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct);

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
/// spec: dfes-companion-2026-07-11 (farm-memory) — what a retained-voice
/// deletion actually did, as opposed to what it was asked to do.
///
/// <para>
/// The distinction is load-bearing rather than decorative. Deleting a
/// retained clip means removing two separate things from two separate
/// stores: the ciphertext in the bucket and the metadata row that points
/// at it. Before this type existed the port returned a bare
/// <see cref="Task"/>, so every path — object deleted, nothing there to
/// begin with, and bucket not configured so nothing was even attempted —
/// came back identical, and the callers reported all three as a
/// completed deletion. Founder ITEM 4 carries a HARD RULE against
/// exactly that: never tell a farmer something is deleted while the
/// active copy is knowingly retained. Doctrine P4 says the same thing
/// about numbers.
/// </para>
/// </summary>
public enum RetainedVoiceDeletionStatus
{
    /// <summary>
    /// At least one clip was found and removed — object and row both.
    /// The only status a caller may report to a principal as "deleted".
    /// </summary>
    Deleted,

    /// <summary>
    /// The user owned no retained clips. Nothing was removed because
    /// there was nothing to remove; a repeat call after a successful
    /// delete lands here, which is what makes the operation idempotent.
    /// Safe to report as "no retained voice remains".
    /// </summary>
    NothingToDelete,

    /// <summary>
    /// Rows exist but no bucket is configured, so the audio could not be
    /// touched. NOTHING is removed in this case — not even the metadata
    /// row. Dropping the row while the object may still be sitting in a
    /// bucket would destroy the only pointer to it, making the audio
    /// simultaneously unreachable by the farmer and undeleted in fact:
    /// the worst of both, and unrecoverable on retry. A caller seeing
    /// this MUST NOT report a completed deletion.
    ///
    /// <para>
    /// That the object is still there is not speculation.
    /// <c>PersistAsync</c> refuses to write while <c>BucketName</c> is
    /// blank, so a <c>voice_clips_retained</c> row can only have been
    /// created while a bucket WAS configured — which means the object
    /// was written too. Rows present on this branch therefore point at
    /// audio that exists.
    /// </para>
    ///
    /// <para>
    /// And the branch is reachable by a documented procedure, not only
    /// by a typo: <c>aws/voice-retained/README.md:148</c> offers blanking
    /// <c>RetainedBlobStore__BucketName</c> and redeploying as a "safer
    /// alternative", whose stated effect is "clips remain in S3
    /// untouched". Removing the rows here would make that supported
    /// rollback silently destroy the farmer's index to their own audio.
    /// </para>
    /// </summary>
    SkippedNoBucketConfigured,
}

/// <summary>
/// Result of a retained-voice deletion. Carries the counts alongside the
/// status so an audit row can record magnitude, not just outcome.
/// </summary>
/// <param name="Status">Which of the three things happened.</param>
/// <param name="BlobsDeleted">
/// Objects the adapter issued a delete for and did not see refused. An
/// object already absent counts here: a re-run finding it gone is the
/// deletion succeeding, not failing.
/// </param>
/// <param name="MetadataRowsRemoved">
/// Rows removed from <c>ssf.voice_clips_retained</c>. Equals
/// <paramref name="BlobsDeleted"/> on the happy path; zero whenever the
/// blob half could not be performed.
/// </param>
public sealed record RetainedVoiceDeletionOutcome(
    RetainedVoiceDeletionStatus Status,
    int BlobsDeleted,
    int MetadataRowsRemoved)
{
    /// <summary>The user held no retained clips.</summary>
    public static readonly RetainedVoiceDeletionOutcome Nothing =
        new(RetainedVoiceDeletionStatus.NothingToDelete, 0, 0);

    /// <summary>Both halves removed for <paramref name="count"/> clips.</summary>
    public static RetainedVoiceDeletionOutcome Removed(int count) =>
        new(RetainedVoiceDeletionStatus.Deleted, count, count);

    /// <summary>
    /// <paramref name="clipsLeftInPlace"/> clips could not be touched
    /// because no bucket is configured. Nothing was removed.
    /// </summary>
    public static RetainedVoiceDeletionOutcome SkippedNoBucket(int clipsLeftInPlace) =>
        new(RetainedVoiceDeletionStatus.SkippedNoBucketConfigured, 0, 0)
        {
            ClipsLeftInPlace = clipsLeftInPlace,
        };

    /// <summary>
    /// How many clips the caller asked about that are still present and
    /// still pointed at by a live row. Non-zero only on
    /// <see cref="RetainedVoiceDeletionStatus.SkippedNoBucketConfigured"/>.
    /// </summary>
    public int ClipsLeftInPlace { get; init; }

    /// <summary>
    /// True when the caller may honestly say the retained voice is gone.
    /// False means an active copy may survive and must not be described
    /// as deleted (founder ITEM 4 HARD RULE).
    /// </summary>
    public bool CanBeReportedAsDeleted =>
        Status is RetainedVoiceDeletionStatus.Deleted
                or RetainedVoiceDeletionStatus.NothingToDelete;
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
