// spec: voice-diary-e2e-2026-05-17 (B.11)

namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// Options bound from the <c>RetainedBlobStore</c> configuration
/// section. Drives the <see cref="S3RetainedBlobStore"/> adapter that
/// holds Voice Diary clips beyond the 30-day local journal.
///
/// <para>
/// Mirrors <c>RawBlobStoreOptions</c> at
/// <c>Infrastructure/Storage/RawBlobStoreOptions.cs</c>: bucket name +
/// region + nullable KMS key. KmsKeyId is intentionally optional —
/// when null/whitespace the adapter falls back to AES256 SSE so dev /
/// local environments without a provisioned CMK still work.
/// Production overrides via env var (<c>RetainedBlobStore__BucketName</c>
/// + <c>RetainedBlobStore__KmsKeyId</c>) at Kiro deploy time.
/// </para>
/// </summary>
public sealed class RetainedBlobStoreOptions
{
    /// <summary>S3 bucket holding retained-tier voice clips.</summary>
    public string BucketName { get; init; } = string.Empty;

    /// <summary>AWS region for the bucket. Defaults to ap-south-1.</summary>
    public string Region { get; init; } = "ap-south-1";

    /// <summary>
    /// Production: real KMS alias (e.g. <c>alias/agrisync-voice-retained-cmk</c>).
    /// Dev: null/whitespace — adapter falls back to AES256 SSE.
    /// </summary>
    public string? KmsKeyId { get; init; }
}
