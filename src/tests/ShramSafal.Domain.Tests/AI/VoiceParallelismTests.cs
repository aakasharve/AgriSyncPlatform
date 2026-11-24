// spec: voice-instant-phase-a-2026-11-23 (Task 5 / S5) - more speech pieces and more sorting segments at once.
//
// Authored from the acceptance criteria only. No AI is called: the segment call, the speech-to-text piece call and the
// two HTTP endpoints are all counting fakes. How many calls were in flight at once is proven with a barrier (calls wait
// until N are in flight, with a short safety timeout), so a "must reach 4" check does not depend on timing.
using System.Net;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Audio;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// Counts calls in flight. Every call waits (up to <paramref name="waitMs"/>) until <paramref name="releaseAt"/> calls
/// are in flight at once, then holds its slot a little longer so a limit that is too loose shows up as a higher peak.
/// </summary>
internal sealed class VsParallelProbe(int releaseAt, int holdMs = 30, int waitMs = 1000)
{
    private readonly TaskCompletionSource _reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _inFlight;
    private int _max;
    private int _total;

    public int Max => Volatile.Read(ref _max);

    public int Total => Volatile.Read(ref _total);

    public async Task EnterAndHoldAsync(CancellationToken ct)
    {
        var now = Interlocked.Increment(ref _inFlight);
        Interlocked.Increment(ref _total);
        int seen;
        do
        {
            seen = Volatile.Read(ref _max);
        }
        while (now > seen && Interlocked.CompareExchange(ref _max, now, seen) != seen);

        if (now >= releaseAt)
        {
            _reached.TrySetResult();
        }

        try
        {
            if (await Task.WhenAny(_reached.Task, Task.Delay(waitMs, ct)).ConfigureAwait(false) != _reached.Task)
            {
                // The limit is lower than the number this probe waits for: stop waiting, for this call and every later
                // one, so a failing run pays the wait once and not once per wave.
                _reached.TrySetResult();
            }

            await Task.Delay(holdMs, ct).ConfigureAwait(false);
        }
        finally
        {
            Interlocked.Decrement(ref _inFlight);
        }
    }
}

public sealed class VoiceParallelismTests
{
    private const string OneRow = """{"dayOutcome":"WORK_RECORDED","observations":[{"noteType":"observation","textRaw":"x"}],"confidence":0.9}""";

    // =====================================================================================================
    // ChunkedStructuring: how many segments are structured at once
    // =====================================================================================================

    /// <summary>A transcript of short English sentences, so a small segment budget cuts it into many segments.</summary>
    private static (string Transcript, int SegmentTokens, int Segments) ManySegments(int minSegments)
    {
        var transcript = string.Join(" ", Enumerable.Range(1, 64).Select(i => $"Row number {i} was watered today."));
        const int segmentTokens = 14; // about two sentences a segment
        var segments = ChunkedStructuring.Segment(transcript, segmentTokens).Count;
        Assert.True(segments >= minSegments, $"the fixture produced only {segments} segments, need {minSegments}");
        return (transcript, segmentTokens, segments);
    }

    private static async Task<(StructuredAnswer Answer, VsParallelProbe Probe, int Segments)> StructureAsync(
        int releaseAt,
        int? maxParallel,
        int minSegments = 12)
    {
        var (transcript, segmentTokens, segments) = ManySegments(minSegments);
        var probe = new VsParallelProbe(releaseAt);
        async Task<SegmentAnswer> Call(string text, CancellationToken ct)
        {
            await probe.EnterAndHoldAsync(ct);
            return SegmentAnswer.Ok(OneRow);
        }

        var answer = maxParallel is { } n
            ? await ChunkedStructuring.StructureAsync(transcript, segmentTokens, Call, NullLogger.Instance, CancellationToken.None, maxParallel: n)
            : await ChunkedStructuring.StructureAsync(transcript, segmentTokens, Call, NullLogger.Instance, CancellationToken.None);
        return (answer, probe, segments);
    }

    [Fact]
    public async Task With_maxParallel_4_no_more_than_four_segment_calls_run_at_once_and_more_than_two_do()
    {
        var (answer, probe, segments) = await StructureAsync(releaseAt: 4, maxParallel: 4);

        Assert.True(answer.IsSuccess, answer.Error);
        Assert.Equal(segments, probe.Total); // every segment was structured
        Assert.True(probe.Max <= 4, $"{probe.Max} segment calls were in flight at once; the limit is 4");
        Assert.True(probe.Max > 2, $"only {probe.Max} segment calls ran at once; with 4 allowed it should reach more than 2");
    }

    [Fact]
    public async Task When_the_option_is_absent_the_default_of_two_is_kept()
    {
        var (answer, probe, segments) = await StructureAsync(releaseAt: 2, maxParallel: null);

        Assert.True(answer.IsSuccess, answer.Error);
        Assert.Equal(segments, probe.Total);
        Assert.Equal(2, probe.Max);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public async Task A_setting_below_one_reads_as_the_default_of_two(int configured)
    {
        var (answer, probe, _) = await StructureAsync(releaseAt: 2, maxParallel: configured);

        Assert.True(answer.IsSuccess, answer.Error);
        Assert.Equal(2, probe.Max);
    }

    [Fact]
    public async Task One_means_one_at_a_time()
    {
        var (answer, probe, _) = await StructureAsync(releaseAt: 1, maxParallel: 1);

        Assert.True(answer.IsSuccess, answer.Error);
        Assert.Equal(1, probe.Max);
    }

    [Fact]
    public async Task A_typo_such_as_40_is_capped_at_the_ceiling_of_eight()
    {
        var (answer, probe, _) = await StructureAsync(releaseAt: 8, maxParallel: 40, minSegments: 20);

        Assert.True(answer.IsSuccess, answer.Error);
        Assert.True(probe.Max <= 8, $"{probe.Max} segment calls were in flight at once; the ceiling is 8");
        Assert.True(probe.Max > 4, $"only {probe.Max} segment calls ran at once; with 40 asked for the ceiling of 8 should be reached");
    }

    [Theory]
    [InlineData(int.MinValue, 2)]
    [InlineData(-5, 2)]
    [InlineData(-1, 2)]
    [InlineData(0, 2)]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 3)]
    [InlineData(4, 4)]
    [InlineData(7, 7)]
    [InlineData(8, 8)]
    [InlineData(9, 8)]
    [InlineData(40, 8)]
    [InlineData(int.MaxValue, 8)]
    public void ResolveMaxParallel_pins_the_default_the_floor_and_the_ceiling(int configured, int expected)
    {
        Assert.Equal(expected, ChunkedStructuring.ResolveMaxParallel(configured));
    }

    [Fact]
    public void The_default_is_two_and_the_ceiling_is_eight()
    {
        Assert.Equal(2, ChunkedStructuring.DefaultMaxParallel);
        Assert.Equal(8, ChunkedStructuring.MaxParallelCeiling);
        Assert.Equal(2, ChunkedStructuring.ResolveMaxParallel(0));
        Assert.Equal(8, ChunkedStructuring.ResolveMaxParallel(40));
    }

    [Fact]
    public async Task A_failing_segment_still_fails_the_whole_parse_when_four_run_at_once()
    {
        var (transcript, segmentTokens, _) = ManySegments(12);
        var calls = 0;

        var answer = await ChunkedStructuring.StructureAsync(
            transcript,
            segmentTokens,
            async (text, ct) =>
            {
                await Task.Yield();
                return Interlocked.Increment(ref calls) == 3
                    ? SegmentAnswer.Failed("provider said no", retryable: false)
                    : SegmentAnswer.Ok(OneRow);
            },
            NullLogger.Instance,
            CancellationToken.None,
            maxParallel: 4);

        Assert.False(answer.IsSuccess); // all or nothing, as before
        Assert.Null(answer.Content);
    }

    // =====================================================================================================
    // The option and its place in the settings
    // =====================================================================================================

    [Fact]
    public void The_structuring_option_defaults_to_two_and_reads_from_Ai_Structuring_MaxParallel()
    {
        Assert.Equal("Ai:Structuring", StructuringOptions.SectionName);
        Assert.Equal(2, new StructuringOptions().MaxParallel);

        var settings = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:Structuring:MaxParallel"] = "4" })
            .Build();
        var bound = new StructuringOptions();
        settings.GetSection(StructuringOptions.SectionName).Bind(bound);
        Assert.Equal(4, bound.MaxParallel);

        var absent = new StructuringOptions();
        new ConfigurationBuilder().Build().GetSection(StructuringOptions.SectionName).Bind(absent);
        Assert.Equal(2, absent.MaxParallel);
    }

    [Fact]
    public void The_speech_option_defaults_to_two_in_code_so_only_a_settings_file_that_names_it_changes_it()
    {
        Assert.Equal(2, new SarvamOptions().SttMaxParallelPieces);
        Assert.Equal("Sarvam", SarvamOptions.SectionName);
    }

    // =====================================================================================================
    // The Sarvam provider reads the option (the wiring, not just the helper)
    // =====================================================================================================

    [Fact]
    public async Task The_sarvam_provider_sorts_four_parts_at_once_when_the_option_says_four()
    {
        var (peak, parts) = await ProviderPeakAsync(maxParallel: 4, releaseAt: 4);

        Assert.True(peak <= 4, $"{peak} parts were in flight at once; the option says 4");
        Assert.True(peak > 2, $"only {peak} parts ran at once; the option says 4");
        Assert.True(parts >= 5, "the fixture should be a long note of at least five parts");
    }

    [Fact]
    public async Task The_sarvam_provider_keeps_two_at_once_when_the_option_is_not_given()
    {
        var (peak, _) = await ProviderPeakAsync(maxParallel: null, releaseAt: 2);

        Assert.Equal(2, peak);
    }

    private static async Task<(int Peak, int Parts)> ProviderPeakAsync(int? maxParallel, int releaseAt)
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var sarvamOptions = new SarvamOptions
        {
            ApiSubscriptionKey = "k-test",
            SttEndpoint = "https://unit.test/stt",
            ChatEndpoint = "https://unit.test/chat",
            ChatModel = "sarvam-test",
            TimeoutSeconds = 10,
            ChatTimeoutSeconds = 10,
        };
        var parts = ChunkedStructuring.Segment(transcript, new StructuringBudget(sarvamOptions.ChatMaxTokens).SegmentTokens).Count;
        var probe = new VsParallelProbe(releaseAt);
        var chat = new VsCountingHandler(probe, _ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    choices = new[] { new { finish_reason = "stop", message = new { content = OneRow } } },
                    usage = new { completion_tokens = 300 },
                }),
                Encoding.UTF8,
                "application/json"),
        });
        var options = Options.Create(sarvamOptions);
        var factory = new StaticHttpClientFactory(new HttpClient(chat));
        var provider = new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance,
            maxParallel is { } n ? Options.Create(new StructuringOptions { MaxParallel = n }) : null);

        var result = await provider.ParseVoiceAsync(
            new MemoryStream(Encoding.UTF8.GetBytes(transcript)),
            "text/plain",
            "mr-IN",
            "system",
            CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.Equal(parts, probe.Total);
        return (probe.Max, parts);
    }

    // =====================================================================================================
    // Speech-to-text pieces
    // =====================================================================================================

    [Fact]
    public async Task Speech_pieces_run_four_at_once_when_the_limit_is_four_and_never_more()
    {
        var probe = new VsParallelProbe(releaseAt: 4);
        var pieces = Enumerable.Range(0, 12)
            .Select(i => new AudioPiece(i, i * AudioSplitter.SampleRate, (i + 1) * AudioSplitter.SampleRate, [], IsQuiet: false))
            .ToList();

        var result = await SarvamSttClient.TranscribePiecesAsync(
            pieces,
            async (piece, ct) =>
            {
                await probe.EnterAndHoldAsync(ct);
                return SttCallOutcome.Succeeded($"w{piece.Index}", "mr-IN", null);
            },
            maxParallel: 4,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(12, probe.Total);
        Assert.True(probe.Max <= 4, $"{probe.Max} pieces were in flight at once; the limit is 4");
        Assert.True(probe.Max > 2, $"only {probe.Max} pieces ran at once; with 4 allowed it should reach more than 2");
        // Joined in the order he spoke them, whichever finished first.
        Assert.Equal(string.Join(" ", Enumerable.Range(0, 12).Select(i => $"w{i}")), result.Transcript);
    }

    [Theory]
    [InlineData(4, 4)]
    [InlineData(2, 2)]
    public async Task The_speech_client_sends_as_many_pieces_at_once_as_SttMaxParallelPieces_says(int setting, int expectedPeak)
    {
        const int seconds = 140; // six pieces of at most 25 s
        var pcm = new short[seconds * AudioSplitter.SampleRate];
        var random = new Random(7);
        for (var i = 0; i < pcm.Length; i++)
        {
            pcm[i] = (short)random.Next(-18000, 18000); // loud, so no piece is taken for a pause
        }

        var probe = new VsParallelProbe(releaseAt: expectedPeak);
        var stt = new VsCountingHandler(probe, _ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"transcript":"शब्द","language_code":"mr-IN"}""", Encoding.UTF8, "application/json"),
        });
        var options = new SarvamOptions
        {
            ApiSubscriptionKey = "k-test",
            SttEndpoint = "https://unit.test/stt",
            SttModel = "saaras:test",
            SttMode = "codemix",
            SttLanguage = "mr-IN",
            TimeoutSeconds = 10,
            SttMaxParallelPieces = setting,
        };
        var client = new SarvamSttClient(
            Options.Create(options),
            new StaticHttpClientFactory(new HttpClient(stt)),
            NullLogger<SarvamSttClient>.Instance,
            new AudioSplitter(new VsPcmTranscoder(pcm), NullLogger<AudioSplitter>.Instance));

        var result = await client.TranscribeAsync(new MemoryStream([1, 2, 3]), "audio/webm", "mr-IN", CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.True(probe.Total >= 5, $"the fixture should be split into several pieces, got {probe.Total} requests");
        Assert.True(probe.Max <= setting, $"{probe.Max} pieces were in flight at once; SttMaxParallelPieces is {setting}");
        Assert.Equal(expectedPeak, probe.Max);
    }

    // =====================================================================================================
    // fakes
    // =====================================================================================================

    /// <summary>An HTTP edge that counts requests in flight (through the probe) and answers each one.</summary>
    private sealed class VsCountingHandler(VsParallelProbe probe, Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            await probe.EnterAndHoldAsync(cancellationToken).ConfigureAwait(false);
            return answer(request);
        }
    }

    /// <summary>Hands the splitter PCM the test made, as if ffmpeg had decoded it.</summary>
    private sealed class VsPcmTranscoder(short[] pcm) : IAudioTranscoder
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
}
