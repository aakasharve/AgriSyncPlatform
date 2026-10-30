using System.Buffers.Binary;

namespace ShramSafal.Infrastructure.Audio;

/// <summary>
/// PLR lane V-1 fix pass (review) — the length of a recording read from its container, without decoding it, so a
/// short clip (most of them) never starts ffmpeg just to find out it is short.
///
/// <list type="bullet">
///   <item>WAV: the data size over the byte rate (exact).</item>
///   <item>WebM / Matroska: the <c>Duration</c> in Info when the muxer wrote one; otherwise (the browser's
///   MediaRecorder writes none) the last block's time — cluster timecode plus the block's relative time — plus one
///   20 ms frame.</item>
/// </list>
/// Anything it does not understand gives <c>null</c>, and the caller decodes as before. It never throws.
/// </summary>
internal static class AudioDurationProbe
{
    private const uint EbmlId = 0x1A45DFA3;
    private const uint SegmentId = 0x18538067;
    private const uint InfoId = 0x1549A966;
    private const uint TimecodeScaleId = 0x2AD7B1;
    private const uint DurationId = 0x4489;
    private const uint ClusterId = 0x1F43B675;
    private const uint ClusterTimecodeId = 0xE7;
    private const uint SimpleBlockId = 0xA3;
    private const uint BlockGroupId = 0xA0;
    private const uint BlockId = 0xA1;
    private const double OneFrameMs = 20;

    /// <summary>Elements that sit beside clusters: one of them ends a cluster written with an unknown size.</summary>
    private static readonly HashSet<uint> SegmentLevelIds =
    [
        ClusterId, 0x1C53BB6B, 0x1254C367, InfoId, 0x1654AE6B, 0x114D9B74, 0x1043A770, 0x1941A469
    ];

    public static TimeSpan? TryRead(ReadOnlySpan<byte> audio)
    {
        try
        {
            return Wav(audio) ?? Matroska(audio);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static TimeSpan? Wav(ReadOnlySpan<byte> a)
    {
        if (a.Length < 12 || !a[..4].SequenceEqual("RIFF"u8) || !a.Slice(8, 4).SequenceEqual("WAVE"u8))
        {
            return null;
        }

        var byteRate = 0;
        var pos = 12;
        while (pos + 8 <= a.Length)
        {
            var id = a.Slice(pos, 4);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(a.Slice(pos + 4, 4));
            var body = pos + 8;
            if (id.SequenceEqual("data"u8))
            {
                if (byteRate <= 0)
                {
                    return null;
                }

                // A streamed WAV writes 0 or 0xFFFFFFFF here: the data then runs to the end.
                long dataBytes = size == 0 || size == uint.MaxValue || size > (uint)(a.Length - body) ? a.Length - body : size;
                return TimeSpan.FromSeconds((double)dataBytes / byteRate);
            }

            if (size > (uint)(a.Length - body))
            {
                return null;
            }

            if (id.SequenceEqual("fmt "u8) && size >= 16)
            {
                byteRate = BinaryPrimitives.ReadInt32LittleEndian(a.Slice(body + 8, 4));
            }

            pos = body + (int)size + (int)(size & 1);
        }

        return null;
    }

    private static TimeSpan? Matroska(ReadOnlySpan<byte> a)
    {
        var pos = 0;
        if (!ReadElement(a, ref pos, out var id, out var size, out var start) || id != EbmlId || size < 0)
        {
            return null;
        }

        pos = start + (int)size;
        if (!ReadElement(a, ref pos, out id, out size, out start) || id != SegmentId)
        {
            return null;
        }

        var segmentEnd = size < 0 ? a.Length : (int)Math.Min(a.Length, start + size);
        pos = start;
        double scaleNs = 1_000_000;
        long lastBlock = -1;
        while (pos < segmentEnd)
        {
            if (!ReadElement(a, ref pos, out id, out size, out start))
            {
                break;
            }

            if (id == ClusterId)
            {
                pos = ReadCluster(a, start, size < 0 ? segmentEnd : (int)Math.Min(segmentEnd, start + size), unknownSize: size < 0, ref lastBlock);
                continue;
            }

            if (size < 0)
            {
                return null;
            }

            var end = (int)Math.Min(segmentEnd, start + size);
            if (id == InfoId)
            {
                double? duration = null;
                var p = start;
                while (p < end && ReadElement(a, ref p, out var childId, out var childSize, out var childStart) && childSize >= 0)
                {
                    var value = a.Slice(childStart, (int)Math.Min(childSize, end - childStart));
                    if (childId == TimecodeScaleId)
                    {
                        scaleNs = ReadUnsigned(value);
                    }
                    else if (childId == DurationId)
                    {
                        duration = value.Length == 4 ? BinaryPrimitives.ReadSingleBigEndian(value) : BinaryPrimitives.ReadDoubleBigEndian(value);
                    }

                    p = childStart + (int)childSize;
                }

                if (duration is > 0)
                {
                    return TimeSpan.FromMilliseconds(duration.Value * scaleNs / 1_000_000.0);
                }
            }

            pos = end;
        }

        return lastBlock < 0 ? null : TimeSpan.FromMilliseconds((lastBlock * scaleNs / 1_000_000.0) + OneFrameMs);
    }

    /// <summary>Walks one cluster and returns where it ends (an unknown-size cluster ends at the next segment-level
    /// element).</summary>
    private static int ReadCluster(ReadOnlySpan<byte> a, int start, int end, bool unknownSize, ref long lastBlock)
    {
        long clusterTime = 0;
        var p = start;
        while (p < end)
        {
            var before = p;
            if (!ReadElement(a, ref p, out var id, out var size, out var dataStart))
            {
                return end;
            }

            if (unknownSize && SegmentLevelIds.Contains(id))
            {
                return before;
            }

            if (size < 0)
            {
                return end;
            }

            var length = (int)Math.Min(size, end - dataStart);
            var data = a.Slice(dataStart, length);
            if (id == ClusterTimecodeId)
            {
                clusterTime = (long)ReadUnsigned(data);
            }
            else if (id == SimpleBlockId)
            {
                lastBlock = Math.Max(lastBlock, clusterTime + BlockTime(data));
            }
            else if (id == BlockGroupId)
            {
                var q = 0;
                while (q < data.Length && ReadElement(data, ref q, out var childId, out var childSize, out var childStart) && childSize >= 0)
                {
                    if (childId == BlockId)
                    {
                        lastBlock = Math.Max(lastBlock, clusterTime + BlockTime(data.Slice(childStart, (int)Math.Min(childSize, data.Length - childStart))));
                    }

                    q = childStart + (int)childSize;
                }
            }

            p = dataStart + length;
        }

        return end;
    }

    /// <summary>A (Simple)Block's time relative to its cluster: after the track number, a signed 16-bit value.</summary>
    private static long BlockTime(ReadOnlySpan<byte> block)
    {
        var trackLength = VintLength(block[0]);
        return BinaryPrimitives.ReadInt16BigEndian(block.Slice(trackLength, 2));
    }

    private static int VintLength(byte first)
    {
        for (var i = 0; i < 8; i++)
        {
            if ((first & (0x80 >> i)) != 0)
            {
                return i + 1;
            }
        }

        throw new FormatException("Invalid EBML variable-length integer.");
    }

    /// <summary>One element header: its ID (marker kept), its data size (-1 = unknown) and where its data starts.</summary>
    private static bool ReadElement(ReadOnlySpan<byte> a, ref int pos, out uint id, out long size, out int dataStart)
    {
        id = 0;
        size = 0;
        dataStart = 0;
        if (pos >= a.Length)
        {
            return false;
        }

        var idLength = VintLength(a[pos]);
        if (idLength > 4 || pos + idLength > a.Length)
        {
            return false;
        }

        for (var i = 0; i < idLength; i++)
        {
            id = (id << 8) | a[pos + i];
        }

        var sizePos = pos + idLength;
        if (sizePos >= a.Length)
        {
            return false;
        }

        var sizeLength = VintLength(a[sizePos]);
        if (sizePos + sizeLength > a.Length)
        {
            return false;
        }

        long value = a[sizePos] & (0xFF >> sizeLength);
        var allOnes = value == (0xFF >> sizeLength);
        for (var i = 1; i < sizeLength; i++)
        {
            value = (value << 8) | a[sizePos + i];
            allOnes &= a[sizePos + i] == 0xFF;
        }

        size = allOnes ? -1 : value;
        dataStart = sizePos + sizeLength;
        pos = dataStart;
        return true;
    }

    private static double ReadUnsigned(ReadOnlySpan<byte> value)
    {
        ulong result = 0;
        foreach (var b in value)
        {
            result = (result << 8) | b;
        }

        return result;
    }
}
