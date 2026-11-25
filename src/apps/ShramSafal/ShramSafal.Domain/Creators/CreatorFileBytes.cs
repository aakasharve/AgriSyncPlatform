using System.Buffers.Binary;

namespace ShramSafal.Domain.Creators;

// spec: plr-d10 schedule slice 15 (creator door, server half) - what a creator's file IS, read from its bytes (never its name or the type the browser said), and the removal
// of everything in a picture that can say where it was taken. Pure functions; nothing here reads the meaning of a file (no text recognition, no AI).

/// <summary>The three kinds of file the creator door takes.</summary>
public enum CreatorFileKind
{
    Unknown = 0,
    Pdf = 1,
    Jpeg = 2,
    Png = 3,
}

public static class CreatorFileBytes
{
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>PNG chunks that can carry text or EXIF (a place, a device, a person): removed. Pixels, palette, colour and transparency chunks are kept as they are.</summary>
    private static readonly HashSet<string> PngMetadataChunks = new(StringComparer.Ordinal) { "eXIf", "tEXt", "zTXt", "iTXt", "tIME" };

    public static string MimeOf(CreatorFileKind kind) => kind switch
    {
        CreatorFileKind.Pdf => "application/pdf",
        CreatorFileKind.Jpeg => "image/jpeg",
        CreatorFileKind.Png => "image/png",
        _ => "application/octet-stream",
    };

    /// <summary>The kind, from the first bytes alone: <c>%PDF-</c>, the JPEG start marker, or the PNG signature.</summary>
    public static CreatorFileKind Sniff(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 5 && bytes[..5].SequenceEqual("%PDF-"u8))
        {
            return CreatorFileKind.Pdf;
        }

        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
        {
            return CreatorFileKind.Jpeg;
        }

        if (bytes.Length >= PngSignature.Length && bytes[..PngSignature.Length].SequenceEqual(PngSignature))
        {
            return CreatorFileKind.Png;
        }

        return CreatorFileKind.Unknown;
    }

    /// <summary>
    /// The same picture without its metadata. JPEG: every APP1 segment (EXIF, where the GPS position lives, and XMP) and every comment is dropped. PNG: every text, time and
    /// EXIF chunk is dropped. Returns null when the bytes cannot be walked as that kind of picture (a broken or disguised file): the caller refuses it rather than keep bytes
    /// it could not clean. A PDF is returned as it is.
    /// </summary>
    public static byte[]? StripLocation(byte[] bytes, CreatorFileKind kind) => kind switch
    {
        CreatorFileKind.Jpeg => StripJpeg(bytes),
        CreatorFileKind.Png => StripPng(bytes),
        CreatorFileKind.Pdf => bytes,
        _ => null,
    };

    private static byte[]? StripJpeg(byte[] bytes)
    {
        using var output = new MemoryStream(bytes.Length);
        output.Write(bytes, 0, 2); // start of image
        var position = 2;
        while (position < bytes.Length)
        {
            if (bytes[position] != 0xFF)
            {
                return null;
            }

            // Fill bytes before a marker are allowed.
            var markerAt = position;
            while (markerAt < bytes.Length && bytes[markerAt] == 0xFF)
            {
                markerAt++;
            }

            if (markerAt >= bytes.Length)
            {
                return null;
            }

            var marker = bytes[markerAt];
            var segmentStart = markerAt - 1;

            if (marker == 0xD9)
            {
                // End of image: anything after it (a trailer some tools append) is not part of the picture and is dropped.
                output.WriteByte(0xFF);
                output.WriteByte(0xD9);
                return output.ToArray();
            }

            if (marker is >= 0xD0 and <= 0xD7 or 0x01)
            {
                output.WriteByte(0xFF);
                output.WriteByte(marker);
                position = markerAt + 1;
                continue;
            }

            if (markerAt + 2 >= bytes.Length)
            {
                return null;
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(markerAt + 1, 2));
            var segmentEnd = markerAt + 1 + length;
            if (length < 2 || segmentEnd > bytes.Length)
            {
                return null;
            }

            if (marker == 0xDA)
            {
                // Start of scan: the header, then the compressed picture up to the end marker. Copied whole.
                var end = FindEndOfImage(bytes, segmentEnd);
                if (end < 0)
                {
                    return null;
                }

                output.Write(bytes, segmentStart, end - segmentStart);
                output.WriteByte(0xFF);
                output.WriteByte(0xD9);
                return output.ToArray();
            }

            // APP1 = EXIF (with its GPS block) and XMP; APP13 = IPTC (place names); COM = free words. All dropped.
            var dropped = marker is 0xE1 or 0xED or 0xFE;
            if (!dropped)
            {
                output.WriteByte(0xFF);
                output.Write(bytes, markerAt, segmentEnd - markerAt);
            }

            position = segmentEnd;
        }

        return null;
    }

    /// <summary>The last end-of-image marker at or after <paramref name="from"/> (a progressive picture holds several scans; the picture ends at its last marker).</summary>
    private static int FindEndOfImage(byte[] bytes, int from)
    {
        for (var i = bytes.Length - 2; i >= from; i--)
        {
            if (bytes[i] == 0xFF && bytes[i + 1] == 0xD9)
            {
                return i;
            }
        }

        return -1;
    }

    private static byte[]? StripPng(byte[] bytes)
    {
        using var output = new MemoryStream(bytes.Length);
        output.Write(bytes, 0, PngSignature.Length);
        var position = PngSignature.Length;
        while (position + 12 <= bytes.Length)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(position, 4));
            if (length > int.MaxValue)
            {
                return null;
            }

            var total = 12L + length;
            if (position + total > bytes.Length)
            {
                return null;
            }

            var type = System.Text.Encoding.ASCII.GetString(bytes, position + 4, 4);
            if (!PngMetadataChunks.Contains(type))
            {
                output.Write(bytes, position, (int)total);
            }

            position += (int)total;
            if (type == "IEND")
            {
                return output.ToArray();
            }
        }

        return null;
    }
}
