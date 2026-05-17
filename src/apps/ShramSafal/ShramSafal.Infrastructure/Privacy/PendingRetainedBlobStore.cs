// spec: data-principle-spine-2026-05-05/08.7
//
// Sub-phase 08.7 (per OQ-8 verdict) — throwing stub adapter for
// IRetainedBlobStore. Phase 08 binds this in Bootstrapper; Phase 07
// replaces the binding with an S3-backed implementation that walks
// voice_clips_retained, decrements raw_blob_index ref counts, and
// deletes the S3 objects via IRawBlobStore.DereferenceAsync.
//
// ErasureWorker (08.2) catches the NotImplementedException, logs a
// warning, and marks the ErasureRequest payload with
// voice_clips_retained_deferred=true — so the request completes even
// when Phase 07 lands after Phase 08 (the typical case during the
// trust-spine rollout).
//
// PHASE 07 REBIND POINT: replace the AddSingleton<IRetainedBlobStore,
// PendingRetainedBlobStore>() call in Bootstrapper/Program.cs with the
// real S3 adapter once Phase 07 lands.

using ShramSafal.Application.Privacy.Ports;

namespace ShramSafal.Infrastructure.Privacy;

public sealed class PendingRetainedBlobStore : IRetainedBlobStore
{
    public Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
    {
        throw new NotImplementedException(
            "Phase 07: voice_clips_retained not yet shipped. " +
            "ErasureWorker catches this and defers the voice-clip purge for this user " +
            $"(userId={userId}). Phase 07 rebinds the IRetainedBlobStore registration " +
            "in Bootstrapper/Program.cs to an S3-backed adapter that walks " +
            "voice_clips_retained, decrements raw_blob_index ref counts, and deletes " +
            "the S3 objects via IRawBlobStore.DereferenceAsync.");
    }
}
