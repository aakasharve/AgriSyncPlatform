using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.Audio;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR lane V-1 (register F67) — a recording longer than Sarvam's 30 s REST limit is transcribed in pieces of at most
/// 25 s, cut at the quietest point, with no gap and no overlap, joined in order, ALL OR NOTHING. The splitter is
/// tested with REAL ffmpeg on generated audio (noise / tone "speech" with true-zero pauses between); speech-to-text is
/// faked (no AI is called). Without ffmpeg on PATH these tests report Skipped, never Passed.
/// </summary>
public sealed class PlrV1AudioSplitTests
{
    private const int Rate = AudioSplitter.SampleRate;

    // ------------------------------------------------------------------ real ffmpeg: where the cuts go

    [SkippableFact]
    public async Task A_70s_recording_is_four_pieces_of_at_most_25s_cut_in_the_pauses_with_no_gap_and_no_overlap()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, pauses) = await GenerateAsync(Pattern(70));

        var split = await Splitter().SplitAsync(AudioSplitter.ToWav(pcm, Rate), "audio/wav", CancellationToken.None);

        AssertCoversExactly(split, pcm, expectedPieces: 4);
        AssertCutsInPauses(split, pauses);
    }

    [SkippableFact]
    public async Task A_125s_recording_is_six_pieces_of_at_most_25s_cut_in_the_pauses_with_no_gap_and_no_overlap()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, pauses) = await GenerateAsync(Pattern(125));

        var split = await Splitter().SplitAsync(AudioSplitter.ToWav(pcm, Rate), "audio/wav", CancellationToken.None);

        AssertCoversExactly(split, pcm, expectedPieces: 6);
        AssertCutsInPauses(split, pauses);
    }

    [SkippableFact]
    public async Task A_recording_under_28s_is_not_split()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, _) = await GenerateAsync(Pattern(20));

        var split = await Splitter().SplitAsync(AudioSplitter.ToWav(pcm, Rate), "audio/wav", CancellationToken.None);

        Assert.False(split.IsSplit);
        Assert.False(split.IsTooLong);
    }

    [SkippableFact]
    public async Task A_compressed_webm_recording_is_split_too()
    {
        // What the phone really uploads: Opus in WebM. ffmpeg decodes it; the pieces still cover it all.
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, _) = await GenerateAsync(Pattern(70));
        var webm = await RunFfmpegAsync(AudioSplitter.ToWav(pcm, Rate), "-i", "pipe:0", "-c:a", "libopus", "-b:a", "24k", "-f", "webm", "pipe:1");

        var split = await Splitter().SplitAsync(webm, "audio/webm;codecs=opus", CancellationToken.None);

        Assert.Equal(4, split.Pieces.Count);
        Assert.All(split.Pieces, p => Assert.True(p.Seconds <= AudioSplitter.MaxPieceSeconds));
        AssertConsecutive(split);
        Assert.InRange(split.TotalSamples / (double)Rate, 69.5, 70.5);
    }

    // ------------------------------------------------------------------ real ffmpeg + faked speech-to-text, end to end

    [SkippableFact]
    public async Task Through_the_stt_client_each_piece_is_one_request_and_the_words_join_in_order()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, _) = await GenerateAsync(Pattern(70));
        var wav = AudioSplitter.ToWav(pcm, Rate);
        var expected = (await Splitter().SplitAsync(wav, "audio/wav", CancellationToken.None)).Pieces
            .Select(p => WordFor(p.Wav))
            .ToList();
        var stt = new FakeStt(async (file, _) =>
        {
            // Later pieces answer FIRST: the join must still follow the recording's order.
            await Task.Delay(file.Length % 3 == 0 ? 5 : 60);
            return Ok(WordFor(file));
        });

        var result = await Client(stt).TranscribeAsync(new MemoryStream(wav), "audio/wav", "mr-IN", CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(string.Join(" ", expected), result.Transcript);
        Assert.Equal(4, stt.Files.Count);
        Assert.All(stt.Files, f =>
        {
            Assert.Equal("audio/wav", f.ContentType);
            Assert.True(DataSeconds(f.Bytes) <= AudioSplitter.MaxPieceSeconds, $"a piece of {DataSeconds(f.Bytes)} s was sent");
        });
        Assert.True(stt.MaxInFlight <= 2, $"{stt.MaxInFlight} pieces were in flight at once");
    }

    [SkippableFact]
    public async Task Through_the_stt_client_one_failed_piece_fails_the_whole_recording()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, _) = await GenerateAsync(Pattern(70));
        var wav = AudioSplitter.ToWav(pcm, Rate);
        var third = (await Splitter().SplitAsync(wav, "audio/wav", CancellationToken.None)).Pieces[2].Wav;
        var stt = new FakeStt((file, _) => Task.FromResult(
            file.AsSpan().SequenceEqual(third)
                ? new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("{\"error\":{\"message\":\"boom\"}}") }
                : Ok("शब्द")));

        var result = await Client(stt).TranscribeAsync(new MemoryStream(wav), "audio/wav", "mr-IN", CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Transcript); // never the other pieces' words as a success
        Assert.Contains("part 3 of 4", result.Error, StringComparison.Ordinal);
        Assert.Contains("boom", result.Error, StringComparison.Ordinal);
    }

    [SkippableFact]
    public async Task Through_the_stt_client_a_rate_limited_piece_is_tried_once_more()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, _) = await GenerateAsync(Pattern(70));
        var wav = AudioSplitter.ToWav(pcm, Rate);
        var first = 0;
        var stt = new FakeStt((file, _) =>
        {
            if (Interlocked.Increment(ref first) == 1)
            {
                var limited = new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Content = new StringContent("{\"message\":\"rate limit\"}") };
                limited.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromMilliseconds(10));
                return Task.FromResult(limited);
            }

            return Task.FromResult(Ok("शब्द"));
        });

        var result = await Client(stt).TranscribeAsync(new MemoryStream(wav), "audio/wav", "mr-IN", CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(5, stt.Files.Count); // four pieces, one of them twice
    }

    [SkippableFact]
    public async Task Through_the_stt_client_a_short_recording_goes_as_today_one_request_with_the_original_bytes()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH — the splitter cannot be proven here.");
        var (pcm, _) = await GenerateAsync(Pattern(20));
        var wav = AudioSplitter.ToWav(pcm, Rate);
        var stt = new FakeStt((_, _) => Task.FromResult(Ok("आज पाणी दिलं")));

        var result = await Client(stt).TranscribeAsync(new MemoryStream(wav), "audio/wav", "mr-IN", CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("आज पाणी दिलं", result.Transcript);
        var only = Assert.Single(stt.Files);
        Assert.Equal(wav, only.Bytes);
        Assert.Equal("audio.webm", only.FileName); // unchanged from before this lane
    }

    // ------------------------------------------------------------------ the join rule, speech-to-text faked directly

    [Fact]
    public async Task Pieces_join_in_recording_order_even_when_they_finish_out_of_order()
    {
        var pieces = Pieces(4);
        var result = await SarvamSttClient.TranscribePiecesAsync(
            pieces,
            async (p, ct) =>
            {
                await Task.Delay((4 - p.Index) * 20, ct);
                return SttCallOutcome.Succeeded($"p{p.Index}", "mr-IN", null);
            },
            maxParallel: 4,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("p0 p1 p2 p3", result.Transcript);
    }

    [Fact]
    public async Task One_failed_piece_fails_all_and_stops_the_rest()
    {
        var started = 0;
        var result = await SarvamSttClient.TranscribePiecesAsync(
            Pieces(10),
            async (p, ct) =>
            {
                Interlocked.Increment(ref started);
                await Task.Delay(10, ct);
                return p.Index == 1
                    ? SttCallOutcome.Failed("Sarvam STT call failed with status 503.", retryable: true)
                    : SttCallOutcome.Succeeded($"p{p.Index}", null, null);
            },
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Transcript);
        Assert.Contains("part 2 of 10", result.Error, StringComparison.Ordinal);
        Assert.True(started < 10, $"all {started} pieces were still sent after one failed");
    }

    [Fact]
    public async Task A_piece_that_throws_fails_all()
    {
        var result = await SarvamSttClient.TranscribePiecesAsync(
            Pieces(3),
            (p, _) => p.Index == 2 ? throw new InvalidOperationException("socket closed") : Task.FromResult(SttCallOutcome.Succeeded("x", null, null)),
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Contains("part 3 of 3", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_piece_with_no_words_is_a_failure_unless_it_is_a_pause()
    {
        var speechEmpty = await SarvamSttClient.TranscribePiecesAsync(
            Pieces(3),
            (p, _) => Task.FromResult(SttCallOutcome.Succeeded(p.Index == 1 ? string.Empty : "शब्द", null, null)),
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);
        var pauseEmpty = await SarvamSttClient.TranscribePiecesAsync(
            Pieces(3, quietIndex: 1),
            (p, _) => Task.FromResult(SttCallOutcome.Succeeded(p.Index == 1 ? string.Empty : $"p{p.Index}", null, null)),
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.False(speechEmpty.IsSuccess);
        Assert.Contains("no words for part 2 of 3", speechEmpty.Error, StringComparison.Ordinal);
        Assert.True(pauseEmpty.IsSuccess);
        Assert.Equal("p0 p2", pauseEmpty.Transcript);
    }

    [Fact]
    public async Task A_recording_that_is_all_pause_has_no_transcript_and_says_so()
    {
        var result = await SarvamSttClient.TranscribePiecesAsync(
            Pieces(2, quietIndex: 0, alsoQuiet: 1),
            (_, _) => Task.FromResult(SttCallOutcome.Succeeded(string.Empty, null, null)),
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Contains("Sarvam STT did not return a transcript.", result.Error, StringComparison.Ordinal);
        Assert.Equal(ShramSafal.Application.Contracts.Dtos.TranscribeFailureCodes.PartFailed, result.FailureCode);
    }

    // ------------------------------------------------------------------ the plan, on PCM the test makes itself

    [Fact]
    public void Ten_minutes_of_unbroken_sound_is_still_cut_into_pieces_of_at_most_25s_covering_all_of_it()
    {
        var pcm = new short[600 * Rate];
        var random = new Random(7);
        for (var i = 0; i < pcm.Length; i++)
        {
            pcm[i] = (short)random.Next(-8000, 8000);
        }

        var ranges = AudioSplitter.PlanPieces(pcm, Rate);

        Assert.Equal(28, ranges.Count); // ceil(600 / 22)
        Assert.Equal(0, ranges[0].Start);
        Assert.Equal(pcm.Length, ranges[^1].End);
        for (var i = 0; i < ranges.Count; i++)
        {
            var seconds = (ranges[i].End - ranges[i].Start) / (double)Rate;
            Assert.InRange(seconds, AudioSplitter.MinPieceSeconds, AudioSplitter.MaxPieceSeconds);
            if (i > 0)
            {
                Assert.Equal(ranges[i - 1].End, ranges[i].Start);
            }
        }
    }

    [Theory]
    [InlineData(20.0)]
    [InlineData(28.0)]
    public void Up_to_28s_the_plan_is_one_piece(double seconds)
    {
        var ranges = AudioSplitter.PlanPieces(new short[(int)(seconds * Rate)], Rate);

        var only = Assert.Single(ranges);
        Assert.Equal(0, only.Start);
        Assert.Equal((int)(seconds * Rate), only.End);
    }

    [Fact]
    public async Task A_long_pause_inside_a_recording_is_marked_quiet_so_its_empty_words_are_not_a_failure()
    {
        // 20 s speech, 50 s of silence (he stopped to look at the vines), 20 s speech.
        var pcm = new short[90 * Rate];
        var random = new Random(3);
        for (var i = 0; i < pcm.Length; i++)
        {
            var t = i / (double)Rate;
            pcm[i] = t is >= 20 and < 70 ? (short)0 : (short)random.Next(-6000, 6000);
        }

        var split = await new AudioSplitter(new PcmTranscoder(pcm), NullLogger<AudioSplitter>.Instance)
            .SplitAsync([1], "audio/webm", CancellationToken.None);

        Assert.True(split.IsSplit);
        Assert.Contains(split.Pieces, p => p.IsQuiet);
        Assert.False(split.Pieces[0].IsQuiet);
        Assert.False(split.Pieces[^1].IsQuiet);
        Assert.All(split.Pieces.Where(p => p.IsQuiet), p => Assert.True(p.StartSample >= 20 * Rate && p.EndSample <= 70 * Rate));
    }

    [Fact]
    public async Task Longer_than_15_minutes_is_refused_not_split()
    {
        var split = await new AudioSplitter(new PcmTranscoder(new short[(int)(AudioSplitter.MaxSplitSeconds * Rate) + Rate]), NullLogger<AudioSplitter>.Instance)
            .SplitAsync([1], "audio/webm", CancellationToken.None);

        Assert.True(split.IsTooLong);
    }

    [Fact]
    public async Task Audio_that_cannot_be_decoded_goes_unsplit_as_before()
    {
        var split = await new AudioSplitter(new ThrowingTranscoder(), NullLogger<AudioSplitter>.Instance)
            .SplitAsync([0x10, 0x20], "audio/webm", CancellationToken.None);

        Assert.False(split.IsSplit);
        Assert.False(split.IsTooLong);
    }

    // ------------------------------------------------------------------ assertions

    private static void AssertCoversExactly(AudioSplit split, short[] input, int expectedPieces)
    {
        Assert.True(split.IsSplit);
        Assert.Equal(expectedPieces, split.Pieces.Count);
        Assert.Equal(input.Length, split.TotalSamples);
        AssertConsecutive(split);

        // The pieces, laid end to end, ARE the input: no gap, no overlap, nothing changed.
        var joined = split.Pieces.SelectMany(p => DataSamples(p.Wav)).ToArray();
        Assert.Equal(input.Length, joined.Length);
        Assert.True(joined.AsSpan().SequenceEqual(input), "the pieces laid end to end differ from the recording");
        Assert.All(split.Pieces, p => Assert.InRange(p.Seconds, AudioSplitter.MinPieceSeconds, AudioSplitter.MaxPieceSeconds));
        Assert.All(split.Pieces, p => Assert.Equal(p.EndSample - p.StartSample, DataSamples(p.Wav).Length));
    }

    private static void AssertConsecutive(AudioSplit split)
    {
        Assert.Equal(0, split.Pieces[0].StartSample);
        Assert.Equal(split.TotalSamples, split.Pieces[^1].EndSample);
        for (var i = 1; i < split.Pieces.Count; i++)
        {
            Assert.Equal(i, split.Pieces[i].Index);
            Assert.Equal(split.Pieces[i - 1].EndSample, split.Pieces[i].StartSample);
        }

        Assert.Equal(split.TotalSamples, split.Pieces.Sum(p => p.EndSample - p.StartSample));
    }

    private static void AssertCutsInPauses(AudioSplit split, IReadOnlyList<(int Start, int End)> pauses)
    {
        foreach (var cut in split.Pieces.Skip(1).Select(p => p.StartSample))
        {
            Assert.True(
                pauses.Any(q => cut >= q.Start && cut <= q.End),
                $"the cut at {cut / (double)Rate:0.00} s is not in a pause");
        }
    }

    // ------------------------------------------------------------------ generated audio (real ffmpeg)

    /// <summary>"Speech" of 6 s (pink noise or a tone, alternately) and a 1.5 s true-zero pause, repeated.</summary>
    private static List<(bool Speech, double Seconds)> Pattern(double totalSeconds)
    {
        var parts = new List<(bool, double)>();
        var at = 0.0;
        while (at < totalSeconds - 1e-9)
        {
            var speech = Math.Min(6.0, totalSeconds - at);
            parts.Add((true, speech));
            at += speech;
            if (at >= totalSeconds - 1e-9)
            {
                break;
            }

            var pause = Math.Min(1.5, totalSeconds - at);
            parts.Add((false, pause));
            at += pause;
        }

        return parts;
    }

    /// <summary>Real ffmpeg: anoisesrc / sine for speech, anullsrc for pauses, concat — sample-exact 16 kHz mono.</summary>
    private static async Task<(short[] Pcm, List<(int Start, int End)> Pauses)> GenerateAsync(List<(bool Speech, double Seconds)> pattern)
    {
        var args = new List<string> { "-hide_banner", "-loglevel", "error" };
        var filter = new StringBuilder();
        var pauses = new List<(int, int)>();
        var at = 0;
        for (var i = 0; i < pattern.Count; i++)
        {
            var (speech, seconds) = pattern[i];
            var samples = (int)Math.Round(seconds * Rate);
            var source = !speech
                ? $"anullsrc=r={Rate}:cl=mono"
                : i % 4 == 0 ? $"anoisesrc=c=pink:r={Rate}:a=0.3:seed={i + 1}" : $"sine=frequency={180 + (i * 15)}:sample_rate={Rate}";
            args.AddRange(["-f", "lavfi", "-i", source]);
            filter.Append($"[{i}:a]atrim=end_sample={samples},asetpts=PTS-STARTPTS[a{i}];");
            if (!speech)
            {
                pauses.Add((at, at + samples));
            }

            at += samples;
        }

        for (var i = 0; i < pattern.Count; i++)
        {
            filter.Append($"[a{i}]");
        }

        filter.Append($"concat=n={pattern.Count}:v=0:a=1[out]");
        args.AddRange(["-filter_complex", filter.ToString(), "-map", "[out]", "-ac", "1", "-ar", Rate.ToString(), "-f", "s16le", "pipe:1"]);

        var bytes = await RunFfmpegAsync(null, args.ToArray());
        var pcm = MemoryMarshal.Cast<byte, short>(bytes.AsSpan(0, bytes.Length & ~1)).ToArray();
        Assert.Equal(at, pcm.Length);
        return (pcm, pauses);
    }

    private static async Task<byte[]> RunFfmpegAsync(byte[]? stdin, params string[] args)
    {
        var psi = new ProcessStartInfo("ffmpeg")
        {
            RedirectStandardInput = stdin is not null,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        if (args.Length == 0 || args[0] != "-hide_banner")
        {
            psi.ArgumentList.Add("-hide_banner");
            psi.ArgumentList.Add("-loglevel");
            psi.ArgumentList.Add("error");
        }

        if (stdin is null)
        {
            psi.ArgumentList.Add("-nostdin");
        }

        foreach (var arg in args)
        {
            psi.ArgumentList.Add(arg);
        }

        using var process = Process.Start(psi)!;
        var stderr = process.StandardError.ReadToEndAsync();
        await using var output = new MemoryStream();
        var copy = process.StandardOutput.BaseStream.CopyToAsync(output);
        if (stdin is not null)
        {
            await process.StandardInput.BaseStream.WriteAsync(stdin);
            process.StandardInput.Close();
        }

        await copy;
        await process.WaitForExitAsync();
        Assert.True(process.ExitCode == 0, $"ffmpeg failed: {await stderr}");
        return output.ToArray();
    }

    private static bool FfmpegOnPath()
    {
        var names = OperatingSystem.IsWindows() ? new[] { "ffmpeg.exe" } : ["ffmpeg"];
        return (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Any(dir => names.Any(n => File.Exists(Path.Combine(dir.Trim(), n))));
    }

    // ------------------------------------------------------------------ helpers

    private static AudioSplitter Splitter() =>
        new(new FfmpegAudioTranscoder(NullLogger<FfmpegAudioTranscoder>.Instance), NullLogger<AudioSplitter>.Instance);

    private static SarvamSttClient Client(FakeStt stt) => new(
        Options.Create(new SarvamOptions
        {
            ApiSubscriptionKey = "k-test",
            SttEndpoint = "https://unit.test/stt",
            SttModel = "saaras:test",
            SttMode = "codemix",
            SttLanguage = "mr-IN",
            TimeoutSeconds = 30,
            SttMaxParallelPieces = 2,
        }),
        new StaticHttpClientFactory(new HttpClient(stt)),
        NullLogger<SarvamSttClient>.Instance,
        Splitter());

    private static HttpResponseMessage Ok(string transcript) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($"{{\"transcript\":\"{transcript}\",\"language_code\":\"mr-IN\"}}", Encoding.UTF8, "application/json"),
    };

    private static string WordFor(byte[] file) => "p" + Convert.ToHexString(SHA256.HashData(file))[..8];

    private static short[] DataSamples(byte[] wav)
    {
        Assert.Equal("RIFF", Encoding.ASCII.GetString(wav, 0, 4));
        Assert.Equal("data", Encoding.ASCII.GetString(wav, 36, 4));
        var size = BinaryPrimitives.ReadInt32LittleEndian(wav.AsSpan(40));
        Assert.Equal(wav.Length - 44, size);
        return MemoryMarshal.Cast<byte, short>(wav.AsSpan(44)).ToArray();
    }

    private static double DataSeconds(byte[] wav) => DataSamples(wav).Length / (double)Rate;

    private static List<AudioPiece> Pieces(int count, int quietIndex = -1, int alsoQuiet = -1) =>
        Enumerable.Range(0, count)
            .Select(i => new AudioPiece(i, i * Rate, (i + 1) * Rate, [], i == quietIndex || i == alsoQuiet))
            .ToList();

    /// <summary>Speech-to-text, faked at the HTTP edge: records every file sent and how many were in flight.</summary>
    private sealed class FakeStt(Func<byte[], CancellationToken, Task<HttpResponseMessage>> answer) : HttpMessageHandler
    {
        private int _inFlight;

        public ConcurrentQueue<(byte[] Bytes, string? ContentType, string? FileName)> FilesQueue { get; } = new();

        public List<(byte[] Bytes, string? ContentType, string? FileName)> Files => [.. FilesQueue];

        public int MaxInFlight { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var now = Interlocked.Increment(ref _inFlight);
            lock (FilesQueue)
            {
                MaxInFlight = Math.Max(MaxInFlight, now);
            }

            try
            {
                var file = ((MultipartFormDataContent)request.Content!)
                    .First(p => p.Headers.ContentDisposition?.Name?.Trim('"') == "file");
                var bytes = await file.ReadAsByteArrayAsync(cancellationToken);
                FilesQueue.Enqueue((bytes, file.Headers.ContentType?.MediaType, file.Headers.ContentDisposition?.FileName?.Trim('"')));
                return await answer(bytes, cancellationToken);
            }
            finally
            {
                Interlocked.Decrement(ref _inFlight);
            }
        }
    }

    /// <summary>Hands the splitter PCM the test made, as if ffmpeg had decoded it.</summary>
    private sealed class PcmTranscoder(short[] pcm) : IAudioTranscoder
    {
        public async IAsyncEnumerable<ReadOnlyMemory<byte>> ToPcm16kMonoAsync(
            Stream sourceAudio,
            string sourceMimeType,
            int targetSampleRateHz = 16000,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            var bytes = MemoryMarshal.AsBytes(pcm.AsSpan()).ToArray();
            for (var offset = 0; offset < bytes.Length; offset += 65536)
            {
                yield return bytes.AsMemory(offset, Math.Min(65536, bytes.Length - offset));
            }

            await Task.CompletedTask;
        }
    }

    private sealed class ThrowingTranscoder : IAudioTranscoder
    {
        public async IAsyncEnumerable<ReadOnlyMemory<byte>> ToPcm16kMonoAsync(
            Stream sourceAudio,
            string sourceMimeType,
            int targetSampleRateHz = 16000,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            await Task.CompletedTask;
            throw new InvalidOperationException("ffmpeg transcode failed (exit 1): invalid data");
#pragma warning disable CS0162 // an iterator needs a yield
            yield break;
#pragma warning restore CS0162
        }
    }
}
