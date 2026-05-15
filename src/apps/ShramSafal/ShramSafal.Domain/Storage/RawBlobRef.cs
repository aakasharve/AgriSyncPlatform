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
    /// Compute the SHA-256 (lowercase hex) of <paramref name="bytes"/> and pair it with
    /// a content-type-derived extension to produce a stable cold-tier object key of the
    /// form <c>raw/&lt;sha256&gt;.&lt;ext&gt;</c>. Unknown content types fall back to <c>.bin</c>.
    /// </summary>
    public static RawBlobRef FromBytes(ReadOnlySpan<byte> bytes, string contentType)
    {
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var ext = ExtensionFor(contentType);
        return new RawBlobRef(hash, $"raw/{hash}.{ext}", contentType, bytes.Length);
    }

    private static string ExtensionFor(string contentType) => contentType switch
    {
        "audio/opus" => "opus",
        "audio/webm" => "webm",
        "audio/wav" => "wav",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "bin",
    };
}
