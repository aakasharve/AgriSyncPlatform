// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146)
using System.Security.Cryptography;

namespace ShramSafal.Domain.Pictures;

/// <summary>
/// What a picture file may be. Pure: no I/O. The type is decided by the FIRST BYTES, never by a file name or a declared
/// content type (the attachment upload does the same); SVG and PDF are refused because they can carry script or links.
/// The server does not re-encode: it trusts only type, size and first bytes (spec B).
/// </summary>
public static class PictureRules
{
    /// <summary>The size the phone aims at (its resize step). Not enforced by the server.</summary>
    public const int NormalBytes = 256 * 1024;

    /// <summary>The hard cap: anything larger is refused. Accepted files between the two sizes are kept as they are.</summary>
    public const int MaxBytes = 512 * 1024;

    /// <summary>How many leading bytes <see cref="DetectContentType"/> needs.</summary>
    public const int HeaderBytes = 12;

    public const string Jpeg = "image/jpeg";
    public const string Png = "image/png";
    public const string Webp = "image/webp";

    /// <summary>
    /// The content type the first bytes prove (<c>image/jpeg</c>, <c>image/png</c> or <c>image/webp</c>), else <c>null</c>.
    /// A file that is anything else (SVG, PDF, HTML, a made-up name on random bytes) answers <c>null</c>.
    /// </summary>
    public static string? DetectContentType(ReadOnlySpan<byte> head)
    {
        if (head.Length >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF)
        {
            return Jpeg;
        }

        if (head.Length >= 8
            && head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47
            && head[4] == 0x0D && head[5] == 0x0A && head[6] == 0x1A && head[7] == 0x0A)
        {
            return Png;
        }

        // "RIFF" + 4 size bytes + "WEBP"
        if (head.Length >= 12
            && head[0] == (byte)'R' && head[1] == (byte)'I' && head[2] == (byte)'F' && head[3] == (byte)'F'
            && head[8] == (byte)'W' && head[9] == (byte)'E' && head[10] == (byte)'B' && head[11] == (byte)'P')
        {
            return Webp;
        }

        return null;
    }

    /// <summary>Lower-case hex SHA-256 of the file (the ETag, and the end of the storage key).</summary>
    public static string Sha256Hex(ReadOnlySpan<byte> content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

    /// <summary>
    /// <c>pictures/{kind}/{subject_id}/{sha256}.webp</c> through the existing attachment storage (same bucket, same encryption, a
    /// new key prefix). The extension is the one the spec fixed whatever the real type is: the type lives in the row.
    /// </summary>
    public static string StorageKeyFor(PictureKind kind, Guid subjectId, string sha256) =>
        $"pictures/{PictureKinds.ToWire(kind).ToLowerInvariant()}/{subjectId:N}/{sha256}.webp";
}
