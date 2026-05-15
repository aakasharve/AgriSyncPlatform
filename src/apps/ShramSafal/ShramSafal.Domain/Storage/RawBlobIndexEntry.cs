namespace ShramSafal.Domain.Storage;

/// <summary>
/// Persisted ref-count entry for a content-addressed raw blob in S3.
/// Mapped to <c>ssf.raw_blob_index</c>. Created by Phase 02 sub-phase 02.2.
/// Domain factory <see cref="New"/> always sets <see cref="RefCount"/>=1;
/// the DB default value of 0 is a guard for raw INSERTs only.
/// </summary>
public sealed class RawBlobIndexEntry
{
    public string Sha256 { get; private set; } = string.Empty;
    public string S3Key { get; private set; } = string.Empty;
    public string ContentType { get; private set; } = string.Empty;
    public long SizeBytes { get; private set; }
    public DateTime FirstSeenUtc { get; private set; }
    public int RefCount { get; private set; }

    private RawBlobIndexEntry() { }

    public static RawBlobIndexEntry New(RawBlobRef r) => new()
    {
        Sha256 = r.Sha256,
        S3Key = r.S3Key,
        ContentType = r.ContentType,
        SizeBytes = r.SizeBytes,
        FirstSeenUtc = DateTime.UtcNow,
        RefCount = 1,
    };

    public void IncrementRefCount() => RefCount++;

    public void DecrementRefCount()
    {
        if (RefCount <= 0)
        {
            throw new InvalidOperationException("RawBlobIndexEntry ref count below zero — caller violated content-addressed lifecycle invariant.");
        }
        RefCount--;
    }
}
