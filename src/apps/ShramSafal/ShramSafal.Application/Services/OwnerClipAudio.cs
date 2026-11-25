using System.Buffers.Binary;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice")

/// <summary>What the server found out about an uploaded clip from the file itself: its canonical type and its length.</summary>
public sealed record OwnerClipAudio(string MimeType, int DurationMs);

/// <summary>
/// Reads an uploaded owner clip. Accepts audio only (m4a / mp4, mpeg, ogg, webm, wav), at most 5 MB and 90 seconds, and refuses anything else with words. The type is the FILE's:
/// the bytes must be what the declared type says (a text file named .m4a is refused), and the length is measured from the container (never taken from the sender). There is no
/// transcoding and no synthesis here: the bytes stored are exactly the bytes sent.
/// </summary>
public static class OwnerClipAudioProbe
{
    public static ScheduleOwnerProblem? Read(ReadOnlySpan<byte> bytes, string? declaredMime, out OwnerClipAudio? audio)
    {
        audio = null;
        if (bytes.Length == 0)
        {
            return new("OwnerClipEmpty", "The clip is empty.");
        }

        if (bytes.Length > ScheduleOwnerClip.MaxBytes)
        {
            return new("OwnerClipTooBig", $"A clip is at most {ScheduleOwnerClip.MaxBytes / (1024 * 1024)} MB.");
        }

        var declared = Canonical(declaredMime);
        if (declared is null)
        {
            return new("OwnerClipNotAudio", "Only audio is accepted: m4a or mp4, mpeg, ogg, webm or wav.");
        }

        var (found, durationMs) = Sniff(bytes);
        if (found is null || found != declared)
        {
            return new("OwnerClipNotAudio", "The file is not the audio its type says: only m4a or mp4, mpeg, ogg, webm or wav audio is accepted.");
        }

        if (durationMs is null or <= 0)
        {
            return new("OwnerClipLengthUnknown", "The length of the clip could not be read from the file, so it was not accepted.");
        }

        if (durationMs > ScheduleOwnerClip.MaxDurationMs)
        {
            return new("OwnerClipTooLong", $"A clip is at most {ScheduleOwnerClip.MaxDurationMs / 1000} seconds.");
        }

        audio = new OwnerClipAudio(found, durationMs.Value);
        return null;
    }

    /// <summary>The canonical type of a declared type (parameters dropped), or null when it is not an accepted audio type.</summary>
    public static string? Canonical(string? declared)
    {
        var type = declared?.Split(';')[0].Trim().ToLowerInvariant();
        return type switch
        {
            "audio/mp4" or "audio/x-m4a" or "audio/m4a" or "audio/aac" => "audio/mp4",
            "audio/mpeg" or "audio/mp3" => "audio/mpeg",
            "audio/ogg" or "audio/opus" => "audio/ogg",
            "audio/webm" => "audio/webm",
            "audio/wav" or "audio/x-wav" or "audio/wave" or "audio/vnd.wave" => "audio/wav",
            _ => null,
        };
    }

    private static (string? Mime, int? DurationMs) Sniff(ReadOnlySpan<byte> b)
    {
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b.Slice(8, 4).SequenceEqual("WAVE"u8))
        {
            return ("audio/wav", WavMs(b));
        }

        if (b.Length >= 12 && b.Slice(4, 4).SequenceEqual("ftyp"u8))
        {
            return ("audio/mp4", Mp4Ms(b));
        }

        if (b.Length >= 4 && b[..4].SequenceEqual("OggS"u8))
        {
            return ("audio/ogg", OggMs(b));
        }

        if (b.Length >= 4 && b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3)
        {
            return ("audio/webm", WebmMs(b));
        }

        if (b.Length >= 3 && (b[..3].SequenceEqual("ID3"u8) || (b[0] == 0xFF && (b[1] & 0xE0) == 0xE0)))
        {
            return ("audio/mpeg", Mp3Ms(b));
        }

        return (null, null);
    }

    // ---- wav: byte rate of the fmt chunk, size of the data chunk ----
    private static int? WavMs(ReadOnlySpan<byte> b)
    {
        long byteRate = 0;
        var pos = 12;
        while (pos + 8 <= b.Length)
        {
            var id = b.Slice(pos, 4);
            var size = (long)BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(pos + 4, 4));
            var body = pos + 8;
            if (id.SequenceEqual("fmt "u8) && body + 12 <= b.Length)
            {
                byteRate = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(body + 8, 4));
            }
            else if (id.SequenceEqual("data"u8))
            {
                var available = b.Length - body;
                var data = size > available ? available : size;
                return byteRate <= 0 ? null : (int)Math.Min(int.MaxValue, data * 1000 / byteRate);
            }

            pos = (int)Math.Min(int.MaxValue, body + size + (size & 1));
        }

        return null;
    }

    // ---- mp4 / m4a: moov > mvhd (timescale, duration) ----
    private static int? Mp4Ms(ReadOnlySpan<byte> b) => Mp4Walk(b, 0, b.Length, depth: 0);

    private static int? Mp4Walk(ReadOnlySpan<byte> b, int start, int end, int depth)
    {
        var pos = start;
        while (pos + 8 <= end)
        {
            long size = BinaryPrimitives.ReadUInt32BigEndian(b.Slice(pos, 4));
            var type = b.Slice(pos + 4, 4);
            var header = 8;
            if (size == 1 && pos + 16 <= end)
            {
                size = (long)BinaryPrimitives.ReadUInt64BigEndian(b.Slice(pos + 8, 8));
                header = 16;
            }
            else if (size == 0)
            {
                size = end - pos;
            }

            if (size < header || pos + size > end)
            {
                return null;
            }

            var body = pos + header;
            var bodyEnd = (int)(pos + size);
            if (type.SequenceEqual("moov"u8) && depth == 0)
            {
                return Mp4Walk(b, body, bodyEnd, depth + 1);
            }

            if (type.SequenceEqual("mvhd"u8) && depth == 1 && body + 20 <= bodyEnd)
            {
                var version = b[body];
                long timescale;
                long duration;
                if (version == 1 && body + 32 <= bodyEnd)
                {
                    timescale = BinaryPrimitives.ReadUInt32BigEndian(b.Slice(body + 20, 4));
                    duration = (long)BinaryPrimitives.ReadUInt64BigEndian(b.Slice(body + 24, 8));
                }
                else if (version == 0 && body + 20 <= bodyEnd)
                {
                    timescale = BinaryPrimitives.ReadUInt32BigEndian(b.Slice(body + 12, 4));
                    duration = BinaryPrimitives.ReadUInt32BigEndian(b.Slice(body + 16, 4));
                }
                else
                {
                    return null;
                }

                return timescale <= 0 ? null : (int)Math.Min(int.MaxValue, duration * 1000 / timescale);
            }

            pos = bodyEnd;
        }

        return null;
    }

    // ---- ogg: the last page's granule position over the sample rate (opus: 48000 less the pre-skip) ----
    private static int? OggMs(ReadOnlySpan<byte> b)
    {
        double rate = 0;
        long preSkip = 0;
        var head = b[..Math.Min(b.Length, 512)];
        var opus = head.IndexOf("OpusHead"u8);
        if (opus >= 0 && opus + 12 <= head.Length)
        {
            rate = 48000;
            preSkip = BinaryPrimitives.ReadUInt16LittleEndian(head.Slice(opus + 10, 2));
        }
        else
        {
            var vorbis = head.IndexOf("\u0001vorbis"u8);
            if (vorbis >= 0 && vorbis + 16 <= head.Length)
            {
                rate = BinaryPrimitives.ReadUInt32LittleEndian(head.Slice(vorbis + 12, 4));
            }
        }

        if (rate <= 0)
        {
            return null;
        }

        for (var i = b.Length - 14; i >= 0; i--)
        {
            if (b[i] == 'O' && b[i + 1] == 'g' && b[i + 2] == 'g' && b[i + 3] == 'S')
            {
                var granule = BinaryPrimitives.ReadInt64LittleEndian(b.Slice(i + 6, 8));
                if (granule <= 0)
                {
                    return null;
                }

                return (int)Math.Min(int.MaxValue, (granule - preSkip) * 1000.0 / rate);
            }
        }

        return null;
    }

    // ---- webm: Segment > Info > TimecodeScale and Duration ----
    private static int? WebmMs(ReadOnlySpan<byte> span)
    {
        var b = span.ToArray(); // a local function cannot capture a span
        long scale = 1_000_000;
        double? duration = null;
        var pos = 0;
        // top level: EBML header, then the Segment; descend into Segment (18 53 80 67) and Info (15 49 A9 66)
        void Walk(int start, int end, int depth)
        {
            var p = start;
            while (p < end)
            {
                if (!TryVint(b, p, keepMarker: true, out var id, out var idLen) || !TryVint(b, p + idLen, keepMarker: false, out var size, out var sizeLen))
                {
                    return;
                }

                var body = p + idLen + sizeLen;
                var unknown = size == (1L << (7 * sizeLen)) - 1;
                var bodyEnd = unknown || body + size > end ? end : (int)(body + size);
                if (id == 0x18538067 && depth == 0)
                {
                    Walk(body, bodyEnd, 1);
                }
                else if (id == 0x1549A966 && depth == 1)
                {
                    Walk(body, bodyEnd, 2);
                }
                else if (id == 0x2AD7B1 && depth == 2)
                {
                    long v = 0;
                    for (var i = body; i < bodyEnd; i++)
                    {
                        v = (v << 8) | b[i];
                    }

                    scale = v;
                }
                else if (id == 0x4489 && depth == 2)
                {
                    if (bodyEnd - body == 4)
                    {
                        duration = BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32BigEndian(b.AsSpan(body, 4)));
                    }
                    else if (bodyEnd - body == 8)
                    {
                        duration = BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64BigEndian(b.AsSpan(body, 8)));
                    }
                }

                p = bodyEnd;
            }
        }

        Walk(pos, b.Length, 0);
        return duration is { } d && d > 0 ? (int)Math.Min(int.MaxValue, d * scale / 1_000_000.0) : null;
    }

    private static bool TryVint(ReadOnlySpan<byte> b, int pos, bool keepMarker, out long value, out int length)
    {
        value = 0;
        length = 0;
        if (pos >= b.Length)
        {
            return false;
        }

        var first = b[pos];
        var len = 1;
        var mask = 0x80;
        while (len <= 8 && (first & mask) == 0)
        {
            len++;
            mask >>= 1;
        }

        if (len > 8 || pos + len > b.Length)
        {
            return false;
        }

        long v = keepMarker ? first : first & (mask - 1);
        for (var i = 1; i < len; i++)
        {
            v = (v << 8) | b[pos + i];
        }

        value = v;
        length = len;
        return true;
    }

    // ---- mpeg audio layer III: a Xing / Info frame count, else the first frame's bit rate over the file size ----
    private static readonly int[] V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    private static readonly int[] V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    private static readonly int[] Rates1 = [44100, 48000, 32000];

    private static int? Mp3Ms(ReadOnlySpan<byte> b)
    {
        var pos = 0;
        if (b.Length >= 10 && b[..3].SequenceEqual("ID3"u8))
        {
            pos = 10 + ((b[6] & 0x7F) << 21 | (b[7] & 0x7F) << 14 | (b[8] & 0x7F) << 7 | (b[9] & 0x7F));
        }

        while (pos + 4 <= b.Length && !(b[pos] == 0xFF && (b[pos + 1] & 0xE0) == 0xE0))
        {
            pos++;
        }

        if (pos + 4 > b.Length)
        {
            return null;
        }

        var h = b.Slice(pos, 4);
        var versionBits = (h[1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        var layerBits = (h[1] >> 1) & 3; // 1 = layer III
        var bitrateIndex = h[2] >> 4;
        var rateIndex = (h[2] >> 2) & 3;
        if (versionBits == 1 || layerBits != 1 || bitrateIndex is 0 or 15 || rateIndex == 3)
        {
            return null;
        }

        var mpeg1 = versionBits == 3;
        var sampleRate = Rates1[rateIndex] / (mpeg1 ? 1 : versionBits == 2 ? 2 : 4);
        var samplesPerFrame = mpeg1 ? 1152 : 576;
        var bitrate = (mpeg1 ? V1L3 : V2L3)[bitrateIndex] * 1000L;

        // A Xing / Info header near the start of the first frame carries the frame count.
        var window = b.Slice(pos, Math.Min(b.Length - pos, 64));
        var tag = window.IndexOf("Xing"u8);
        if (tag < 0)
        {
            tag = window.IndexOf("Info"u8);
        }

        if (tag >= 0 && tag + 12 <= window.Length && (BinaryPrimitives.ReadUInt32BigEndian(window.Slice(tag + 4, 4)) & 1) == 1)
        {
            var frames = BinaryPrimitives.ReadUInt32BigEndian(window.Slice(tag + 8, 4));
            return frames == 0 ? null : (int)Math.Min(int.MaxValue, frames * (long)samplesPerFrame * 1000 / sampleRate);
        }

        return (int)Math.Min(int.MaxValue, (b.Length - pos) * 8L * 1000 / bitrate);
    }
}
