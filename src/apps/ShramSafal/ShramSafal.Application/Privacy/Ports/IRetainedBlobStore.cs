// spec: data-principle-spine-2026-05-05/08.7
//
// Sub-phase 08.7 (per OQ-8 verdict) — port for deletion of retained-
// voice S3 objects keyed by user. Phase 08 ships the PORT plus a
// throwing stub adapter (PendingRetainedBlobStore); Phase 07 ships
// voice_clips_retained and REBINDS the adapter to a real
// implementation.
//
// The shape is intentionally "delete all retained voice for this user"
// (not per-clip): the only caller is ErasureWorker, which processes
// one ErasureRequest at a time and must purge every retained clip the
// user owns. Per-clip semantics would push the listing concern to the
// worker; the port owns it instead.
//
// Architecture rules:
//   - Pure Application port — no Infrastructure types.
//   - The throwing stub in Infrastructure carries a SpecPointer
//     comment to the Phase 07 rebind file so the search-and-replace
//     for that phase is obvious.

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
    /// <b>Phase 08 contract.</b> The stub implementation
    /// <c>PendingRetainedBlobStore</c> throws
    /// <see cref="NotImplementedException"/> until Phase 07 ships
    /// voice_clips_retained. <c>ErasureWorker</c> catches this and marks
    /// the per-request payload with <c>voice_clips_retained_deferred =
    /// true</c> so the request completes even when Phase 07 lands late
    /// — but the obligation is impossible to forget at the call site.
    /// </para>
    /// </summary>
    Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct);
}
