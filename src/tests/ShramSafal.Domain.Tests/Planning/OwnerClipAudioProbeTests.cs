// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice")
//
// An owner clip is accepted by what the FILE is, never by what its sender says: audio only (m4a / mp4, mpeg, ogg, webm, wav), at most 5 MB and 90 seconds, its length measured from the
// container. Every fixture is GENERATED here (a tone's header, a box, a page): no recording of any person exists in the repository.
using System.Buffers.Binary;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class OwnerClipAudioProbeTests
{
    private static byte[] Wav(int ms)
    {
        const int rate = 8000;
        var data = new byte[rate * 2 * ms / 1000];
        using var s = new MemoryStream();
        using var w = new BinaryWriter(s);
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + data.Length);
        w.Write("WAVEfmt "u8.ToArray());
        w.Write(16);
        w.Write((short)1);
        w.Write((short)1);
        w.Write(rate);
        w.Write(rate * 2);
        w.Write((short)2);
        w.Write((short)16);
        w.Write("data"u8.ToArray());
        w.Write(data.Length);
        w.Write(data);
        return s.ToArray();
    }

    private static byte[] Box(string type, byte[] payload)
    {
        var b = new byte[8 + payload.Length];
        BinaryPrimitives.WriteUInt32BigEndian(b, (uint)b.Length);
        System.Text.Encoding.ASCII.GetBytes(type).CopyTo(b, 4);
        payload.CopyTo(b, 8);
        return b;
    }

    private static byte[] Mp4(uint timescale, uint duration, bool version1 = false)
    {
        var mvhd = new byte[version1 ? 112 : 100];
        if (version1)
        {
            mvhd[0] = 1;
            BinaryPrimitives.WriteUInt32BigEndian(mvhd.AsSpan(20), timescale);
            BinaryPrimitives.WriteUInt64BigEndian(mvhd.AsSpan(24), duration);
        }
        else
        {
            BinaryPrimitives.WriteUInt32BigEndian(mvhd.AsSpan(12), timescale);
            BinaryPrimitives.WriteUInt32BigEndian(mvhd.AsSpan(16), duration);
        }

        var ftyp = Box("ftyp", [.. "M4A "u8.ToArray(), 0, 0, 0, 0, .. "M4A "u8.ToArray()]);
        return [.. ftyp, .. Box("moov", Box("mvhd", mvhd))];
    }

    private static byte[] OggOpus(int seconds)
    {
        byte[] Page(byte type, long granule, byte[] body)
        {
            var h = new byte[27 + 1 + body.Length];
            "OggS"u8.CopyTo(h);
            h[5] = type;
            BinaryPrimitives.WriteInt64LittleEndian(h.AsSpan(6), granule);
            h[26] = 1;
            h[27] = (byte)body.Length;
            body.CopyTo(h, 28);
            return h;
        }

        var head = new byte[19];
        "OpusHead"u8.CopyTo(head);
        head[8] = 1;
        head[9] = 1;
        BinaryPrimitives.WriteUInt16LittleEndian(head.AsSpan(10), 312);
        BinaryPrimitives.WriteUInt32LittleEndian(head.AsSpan(12), 48000);
        return [.. Page(2, 0, head), .. Page(4, 48000L * seconds + 312, new byte[10])];
    }

    private static byte[] WebM(float milliseconds)
    {
        var dur = new byte[4];
        BinaryPrimitives.WriteInt32BigEndian(dur, BitConverter.SingleToInt32Bits(milliseconds));
        byte[] scale = [0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40];
        byte[] duration = [0x44, 0x89, 0x84, .. dur];
        byte[] info = [0x15, 0x49, 0xA9, 0x66, (byte)(0x80 | (scale.Length + duration.Length)), .. scale, .. duration];
        byte[] segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, .. info];
        return [0x1A, 0x45, 0xDF, 0xA3, 0x80, .. segment];
    }

    private static byte[] Mp3(int seconds)
    {
        var bytes = new byte[16000 * seconds]; // 128 kbit/s, constant
        bytes[0] = 0xFF;
        bytes[1] = 0xFB;
        bytes[2] = 0x90;
        return bytes;
    }

    [Theory]
    [InlineData("wav", "audio/wav", 3000)]
    [InlineData("wav", "audio/x-wav", 3000)]
    [InlineData("mp4", "audio/mp4", 3000)]
    [InlineData("m4a", "audio/x-m4a; codecs=mp4a.40.2", 3000)]
    [InlineData("opus", "audio/ogg", 5000)]
    [InlineData("webm", "audio/webm;codecs=opus", 4000)]
    [InlineData("mp3", "audio/mpeg", 3000)]
    public void Reads_the_length_and_the_canonical_type_from_the_file(string kind, string declared, int expectedMs)
    {
        var bytes = kind switch
        {
            "wav" => Wav(3000),
            "mp4" or "m4a" => Mp4(1000, 3000),
            "opus" => OggOpus(5),
            "webm" => WebM(4000f),
            _ => Mp3(3),
        };

        var problem = OwnerClipAudioProbe.Read(bytes, declared, out var audio);

        Assert.Null(problem);
        Assert.NotNull(audio);
        Assert.InRange(audio!.DurationMs, expectedMs - 20, expectedMs + 20);
        Assert.Equal(OwnerClipAudioProbe.Canonical(declared), audio.MimeType);
    }

    [Fact]
    public void A_version_1_mp4_header_reads_too() =>
        Assert.Equal(2000, Read(Mp4(1000, 2000, version1: true), "audio/mp4").DurationMs);

    [Fact]
    public void The_ninety_second_edge_is_in_and_one_more_is_out()
    {
        Assert.Null(OwnerClipAudioProbe.Read(Wav(90_000), "audio/wav", out _));
        var problem = OwnerClipAudioProbe.Read(Wav(90_100), "audio/wav", out var audio);
        Assert.Null(audio);
        Assert.Equal("OwnerClipTooLong", problem!.Code);
        Assert.Contains("at most 90 seconds", problem.Message);
    }

    [Fact]
    public void More_than_five_megabytes_is_refused_with_words()
    {
        var big = new byte[ScheduleOwnerClip.MaxBytes + 1];
        Wav(1000).CopyTo(big, 0);
        var problem = OwnerClipAudioProbe.Read(big, "audio/wav", out _);
        Assert.Equal("OwnerClipTooBig", problem!.Code);
        Assert.Contains("at most 5 MB", problem.Message);
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/octet-stream")]
    [InlineData("video/mp4")]
    [InlineData("image/png")]
    [InlineData("")]
    [InlineData(null)]
    public void A_type_that_is_not_audio_is_refused_with_words(string? declared)
    {
        var problem = OwnerClipAudioProbe.Read(Wav(1000), declared, out var audio);
        Assert.Null(audio);
        Assert.Equal("OwnerClipNotAudio", problem!.Code);
        Assert.Contains("Only audio is accepted", problem.Message);
    }

    [Fact]
    public void Bytes_that_are_not_what_the_type_says_are_refused_with_words()
    {
        var text = System.Text.Encoding.UTF8.GetBytes("<html>not a recording</html>");
        foreach (var declared in new[] { "audio/wav", "audio/mp4", "audio/ogg", "audio/webm", "audio/mpeg" })
        {
            var problem = OwnerClipAudioProbe.Read(text, declared, out _);
            Assert.Equal("OwnerClipNotAudio", problem!.Code);
            Assert.Contains("is not the audio its type says", problem.Message);
        }

        // A real wav declared as mp4 is the wrong type as well.
        Assert.Equal("OwnerClipNotAudio", OwnerClipAudioProbe.Read(Wav(1000), "audio/mp4", out _)!.Code);
    }

    [Fact]
    public void A_clip_whose_length_cannot_be_read_is_not_accepted_on_the_senders_word()
    {
        // An mp4 with no moov box: audio by its bytes, but its length is unknown.
        var problem = OwnerClipAudioProbe.Read(Box("ftyp", [.. "M4A "u8.ToArray(), 0, 0, 0, 0]), "audio/mp4", out _);
        Assert.Equal("OwnerClipLengthUnknown", problem!.Code);
        Assert.Equal("OwnerClipEmpty", OwnerClipAudioProbe.Read([], "audio/wav", out _)!.Code);
    }

    private static OwnerClipAudio Read(byte[] bytes, string declared)
    {
        Assert.Null(OwnerClipAudioProbe.Read(bytes, declared, out var audio));
        return audio!;
    }

    [Fact]
    public void A_message_holds_its_three_kinds_and_nothing_else()
    {
        var chain = Guid.NewGuid();
        var by = new AgriSync.SharedKernel.Contracts.Ids.UserId(Guid.NewGuid());
        var clip = Guid.NewGuid();
        Assert.NotNull(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Tip, clip, null, null, null, null, null, by, DateTime.UtcNow, out _));
        Assert.NotNull(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Change, clip, Guid.NewGuid(), null, null, null, null, by, DateTime.UtcNow, out _));
        Assert.NotNull(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Look, clip, null, "होय", "नाही", Guid.NewGuid(), Guid.NewGuid(), by, DateTime.UtcNow, out _));

        // A change without a new version, a tip with answers, a look with one answer or the same twice, or without follow-ups: refused.
        Assert.Null(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Change, clip, null, null, null, null, null, by, DateTime.UtcNow, out var p1));
        Assert.Equal("OwnerMessageShape", p1!.Code);
        Assert.Null(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Tip, clip, null, "होय", "नाही", null, null, by, DateTime.UtcNow, out _));
        Assert.Null(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Look, clip, null, "होय", null, Guid.NewGuid(), Guid.NewGuid(), by, DateTime.UtcNow, out _));
        Assert.Null(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Look, clip, null, "होय", "होय", Guid.NewGuid(), Guid.NewGuid(), by, DateTime.UtcNow, out _));
        Assert.Null(ScheduleOwnerMessage.Create(Guid.NewGuid(), chain, Guid.NewGuid(), "t-a", ScheduleOwnerMessageKind.Look, clip, null, "होय", "नाही", null, null, by, DateTime.UtcNow, out _));
        Assert.False(ScheduleOwnerMessageKindWire.TryParse("advice", out _));
        Assert.False(ScheduleOwnerMessageKindWire.TryParse("speech", out _));
    }
}
