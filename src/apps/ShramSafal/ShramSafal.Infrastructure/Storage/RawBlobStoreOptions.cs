namespace ShramSafal.Infrastructure.Storage;

/// <summary>
/// Options bound from <c>RawBlobStore</c> configuration section. Drives the
/// <see cref="S3RawBlobStore"/> cold-tier adapter. Sub-phase 02.1 of
/// DATA_PRINCIPLE_SPINE_2026-05-05.
/// </summary>
// spine-02.1 Delta 4: RawBlobStore section landed in
// appsettings.Development.example.json (this commit). appsettings.Development.json
// (live, not in git) is owned by the developer's local env — implementor-backend
// does NOT touch it per project hygiene.
public sealed class RawBlobStoreOptions
{
    /// <summary>S3 bucket holding the cold-tier raw blobs (one per region).</summary>
    public string BucketName { get; init; } = "agrisync-raw-ap-south-1";

    /// <summary>AWS region for the bucket.</summary>
    public string Region { get; init; } = "ap-south-1";

    /// <summary>
    /// Production: real KMS alias (e.g. <c>alias/agrisync-raw-blob-cmk</c>). Dev: null
    /// (or whitespace) — falls back to AES256 SSE so local development against
    /// minio / a real S3 dev bucket doesn't require a provisioned KMS key. Mirrors
    /// the pattern in <see cref="S3AttachmentStorageService"/>.
    /// </summary>
    public string? KmsKeyId { get; init; }
}
