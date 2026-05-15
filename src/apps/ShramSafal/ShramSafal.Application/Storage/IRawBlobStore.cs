using ShramSafal.Domain.Storage;

namespace ShramSafal.Application.Storage;

/// <summary>
/// Cold-tier raw-blob port. Implementations are content-addressed: the SHA-256 of the
/// payload bytes IS the object key, so concurrent writes of the same content are safe
/// and a successful PUT is naturally idempotent. Sub-phase 02.1 of
/// DATA_PRINCIPLE_SPINE_2026-05-05.
/// </summary>
public interface IRawBlobStore
{
    /// <summary>
    /// Upload <paramref name="payload"/> and return its content-addressed reference.
    /// Idempotent on content. Concurrent writers are safe because the key is
    /// content-addressed (SHA-256 of the payload bytes).
    /// </summary>
    Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct);

    /// <summary>
    /// Open a read stream for the blob identified by <paramref name="sha256"/>.
    /// Caller MUST dispose. The stream is backed by an HTTP response; failing to
    /// dispose leaks an SDK connection.
    /// </summary>
    Task<Stream> GetAsync(string sha256, CancellationToken ct);

    /// <summary>
    /// Best-effort hard-delete of the blob identified by <paramref name="sha256"/>.
    /// Phase 02 leaves this as a direct erase; Phase 08 introduces ref-counted erasure
    /// so callers can mark a reference "released" without violating any other
    /// outstanding references.
    /// </summary>
    Task DereferenceAsync(string sha256, CancellationToken ct);
}
