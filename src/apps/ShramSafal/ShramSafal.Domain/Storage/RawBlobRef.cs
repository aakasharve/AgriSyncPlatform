using System.Security.Cryptography;

namespace ShramSafal.Domain.Storage;

/// <summary>
/// Content-addressed reference to a raw payload byte-stream parked in the cold tier
/// (e.g. an S3 bucket). The <see cref="Sha256"/> is the natural primary key: identical
/// content always produces an identical <see cref="S3Key"/>, which is what makes
/// PUTs idempotent and de-duplicates repeat uploads of the same audio clip / photo.
/// Sub-phase 02.1 of DATA_PRINCIPLE_SPINE_2026-05-05.
/// </summary>
public sealed record RawBlobRef
{
    public string Sha256 { get; }
    public string S3Key { get; }
    public string ContentType { get; }
    public long SizeBytes { get; }

    private RawBlobRef(string sha256, string s3Key, string contentType, long sizeBytes)
    {
        Sha256 = sha256;
        S3Key = s3Key;
        ContentType = contentType;
        SizeBytes = sizeBytes;
    }

    /// <summary>
    /// Compute the SHA-256 (lowercase hex) of <paramref name="bytes"/> and produce a
    /// stable cold-tier object key of the form <c>raw/&lt;sha256&gt;</c>. Bytes are
    /// content-addressed by the SHA-256 alone — the extension was decorative and has
    /// been dropped (sub-phase 02-patch). Content type is preserved on the
    /// <see cref="ContentType"/> property (and stamped on the S3 object metadata and
    /// the <c>raw_blob_index.content_type</c> column by the calling adapter), so
    /// downstream readers retain MIME fidelity without round-tripping through the key.
    /// </summary>
    public static RawBlobRef FromBytes(ReadOnlySpan<byte> bytes, string contentType)
    {
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        return new RawBlobRef(hash, $"raw/{hash}", contentType, bytes.Length);
    }
}
