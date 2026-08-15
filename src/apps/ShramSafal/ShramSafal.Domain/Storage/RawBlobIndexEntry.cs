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

    /// <summary>
    /// ⚠️ <b>DEAD — zero production call sites as of §P0.9.</b> Do not read this
    /// as the mechanism by which ref counts move.
    ///
    /// <para>
    /// <c>ShramSafalRepository.UpsertRawBlobIndexAsync</c> used to call this
    /// after an EF read. That read was RLS-filtered, so a second farmer uploading
    /// identical bytes could not see the existing row, took the INSERT branch and
    /// died on <c>23505</c>. The increment is now a single atomic
    /// <c>UPDATE ssf.raw_blob_index SET ref_count = ref_count + 1</c> in SQL,
    /// which also removes the read-modify-write lost-update race this method had.
    /// </para>
    ///
    /// <para>
    /// Kept rather than deleted only so the aggregate still expresses the
    /// invariant in one place. If you are looking for live behaviour it is in the
    /// repository, not here.
    /// </para>
    /// </summary>
    public void IncrementRefCount() => RefCount++;

    /// <summary>
    /// ⚠️ <b>DEAD — zero call sites anywhere, and never had any.</b> Nothing in
    /// the system decrements a ref count.
    ///
    /// <para>
    /// The only deletion path, <c>S3RawBlobStore.DereferenceAsync</c>, hard-deletes
    /// the S3 object and never touches <c>ref_count</c> ("Phase 02 leaves
    /// dereference as a hard-delete; Phase 08 introduces ref-counted erasure" —
    /// Phase 08 did not). So <c>ref_count</c> is a monotonically increasing
    /// persist-event counter, not a live reference count: it cannot reach zero and
    /// therefore cannot answer "is it safe to delete this blob?". Answer that from
    /// <c>ssf.raw_blob_subjects</c> — distinct live subjects — instead.
    /// </para>
    /// </summary>
    public void DecrementRefCount()
    {
        if (RefCount <= 0)
        {
            throw new InvalidOperationException("RawBlobIndexEntry ref count below zero — caller violated content-addressed lifecycle invariant.");
        }
        RefCount--;
    }
}
