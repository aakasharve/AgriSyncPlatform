using System.Net;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Audio;
using ShramSafal.Infrastructure.Integrations.Gemini;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR lanes V-1 + AI-2 FIX PASS (after the orchestrator's live run, 2026-10-31). No AI is called here.
///   B001 — a 10-minute transcript is structured in segments whose predicted answer fits, all or nothing;
///   B004 — only true near-silence may be an empty piece; a protocol failure is never "no words";
///   B005 — deterministic failures are never run again (no re-billed speech-to-text, no breaker hit for a refusal);
///   B007 — a successful audio parse never stores an empty transcript;
///   CorrectionGuard — the four live correction sentences come out right;
///   reviewer notes — DI registration, duration probe, decode gate, ffmpeg deadline, language of piece 1.
/// </summary>
public sealed class PlrV1FixPassTests(Xunit.Abstractions.ITestOutputHelper output)
{
    private const int Rate = AudioSplitter.SampleRate;

    // =====================================================================================================
    // B001 — chunked structuring
    // =====================================================================================================

    [Fact]
    public void A_realistic_ten_minute_transcript_is_segmented_so_every_predicted_answer_fits()
    {
        var transcript = TenMinuteTranscript();
        var budget = new StructuringBudget(new SarvamOptions().ChatMaxTokens);

        var segments = ChunkedStructuring.Segment(transcript, budget.SegmentTokens);

        // It is really ten minutes of speech, and as ONE answer it would not fit (the live 619 s failure).
        var words = transcript.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        Assert.InRange(words, 1000, 1600);
        Assert.True(StructuringBudget.PredictedAnswerTokens(StructuringBudget.EstimateTokens(transcript)) > 4096);

        Assert.InRange(segments.Count, 5, 30);
        Assert.Equal(transcript, string.Concat(segments)); // not a character lost or repeated
        foreach (var segment in segments)
        {
            var tokens = StructuringBudget.EstimateTokens(segment);
            Assert.True(tokens <= budget.SegmentTokens, $"a segment of ~{tokens} tokens is over the budget {budget.SegmentTokens}");
            // ...so its predicted answer uses at most half of the 4096-token limit: a 2x margin on the estimate.
            var planned = (int)(4096 * StructuringBudget.PlannedShareOfAnswer);
            Assert.True(StructuringBudget.PredictedAnswerTokens(tokens) <= planned, $"predicted {StructuringBudget.PredictedAnswerTokens(tokens)} > {planned}");
        }

        output.WriteLine($"10-minute fixture: {words} words, {transcript.Length} chars, ~{StructuringBudget.EstimateTokens(transcript)} tokens; "
            + $"one answer would be ~{StructuringBudget.PredictedAnswerTokens(StructuringBudget.EstimateTokens(transcript))} tokens; "
            + $"{segments.Count} segments, budget {budget.SegmentTokens}, largest ~{segments.Max(StructuringBudget.EstimateTokens)} tokens "
            + $"(predicted answer ~{StructuringBudget.PredictedAnswerTokens(segments.Max(StructuringBudget.EstimateTokens))}).");

        // Cut at sentence ends: every segment but the last ends a sentence.
        Assert.All(segments.Take(segments.Count - 1), s => Assert.Matches(@"[।.?!]\s*$", s));
    }

    [Fact]
    public void The_prompt_plus_one_segment_plus_the_answer_stays_inside_the_32K_context()
    {
        var prompt = new AiPromptBuilder().BuildVoiceParsingPrompt(new VoiceParseContext(
            AvailableCrops: [new CropInfo("c", "Grapes", [])],
            Profile: new FarmerProfileInfo([], [], [], null),
            FarmContext: null,
            FocusCategory: null,
            VocabDb: null));
        var budget = new StructuringBudget(4096);

        Assert.True(StructuringBudget.EstimateTokens(prompt) + budget.SegmentTokens + 4096 < 32_000);
    }

    [Fact]
    public void A_run_on_sentence_with_no_punctuation_is_cut_between_words_never_inside_one()
    {
        var text = string.Join(" ", Enumerable.Repeat("आज पाच बायका आल्या आणि त्यांनी द्राक्षाच्या बागेत खुरपणी केली", 120));

        var segments = ChunkedStructuring.Segment(text, 300);

        Assert.True(segments.Count > 1);
        Assert.Equal(text, string.Concat(segments));
        Assert.All(segments, s => Assert.True(StructuringBudget.EstimateTokens(s) <= 300));
        Assert.All(segments.Take(segments.Count - 1), s => Assert.EndsWith(" ", s));
    }

    [Fact]
    public void A_short_transcript_is_one_segment_sent_exactly_as_before()
    {
        const string words = "आज इथरेल 300 मिली फवारणी केली, पाणी 400 लिटर वापरलं.";

        Assert.Equal(words, Assert.Single(ChunkedStructuring.Segment(words, new StructuringBudget(4096).SegmentTokens)));
    }

    [Fact]
    public async Task Sarvam_structures_a_ten_minute_transcript_in_segments_two_at_a_time_and_merges_them_in_order()
    {
        var transcript = TenMinuteTranscript();
        var chat = new FakeChat(segment => Answer(
            $$"""{"dayOutcome":"WORK_RECORDED","summary":"भाग","observations":[{"noteType":"observation","textRaw":{{JsonSerializer.Serialize(First(segment))}},"sourceText":{{JsonSerializer.Serialize(First(segment))}}}],"missingSegments":["labour"],"confidence":0.9}"""));
        var provider = SarvamProvider(chat);

        var result = await provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "mr-IN", "system", CancellationToken.None);

        Assert.True(result.Success, result.Error);
        var segments = ChunkedStructuring.Segment(transcript, new StructuringBudget(4096).SegmentTokens);
        Assert.Equal(segments.Count, chat.Calls);
        Assert.True(chat.MaxInFlight <= 2, $"{chat.MaxInFlight} segments in flight");
        var root = JsonNode.Parse(result.NormalizedJson!)!;
        var notes = root["observations"]!.AsArray().Select(n => n!["textRaw"]!.GetValue<string>()).ToList();
        Assert.Equal(segments.Select(s => First(s.Trim())).ToList(), notes); // every segment's row, in spoken order
        Assert.Equal(transcript.Trim(), root["fullTranscript"]!.GetValue<string>()); // the WHOLE transcript
        Assert.Equal(new[] { "labour" }, root["missingSegments"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
    }

    [Fact]
    public async Task A_piece_still_cut_off_at_its_smallest_fails_the_whole_parse_visibly_never_a_partial_success()
    {
        // Fix pass 2: a cut-off answer is split in half (up to three times); a piece that is STILL cut off then fails
        // the whole parse — all or nothing.
        var transcript = TenMinuteTranscript();
        var segments = ChunkedStructuring.Segment(transcript, new StructuringBudget(4096).SegmentTokens);
        const int poisoned = 2;
        var third = segments[poisoned].Trim();
        // A sentence of the third segment said only once (the fixture repeats its plain sentences every minute): any
        // piece holding it is always cut off, however small.
        var poison = third.Split('।', StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim())
            .First(x => x.Length > 0 && transcript.Split(x).Length == 2);
        var chat = new FakeChat(segment => segment.Contains(poison, StringComparison.Ordinal)
            ? CutOff()
            : Answer("""{"dayOutcome":"WORK_RECORDED","observations":[]}"""));

        var result = await SarvamProvider(chat).ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "mr-IN", "system", CancellationToken.None);

        Assert.False(result.Success);
        Assert.Null(result.NormalizedJson);
        Assert.Contains($"part {poisoned + 1} of {segments.Count}", result.Error, StringComparison.Ordinal);
        Assert.Contains(SarvamChatClient.CutOffError, result.Error, StringComparison.Ordinal);
        Assert.Contains(AiErrorMarkers.NoRetry, result.Error, StringComparison.Ordinal);
        // A cut-off answer is never "tried once more" as it was: it is split instead.
        Assert.Equal(1, chat.CallsFor(segments[poisoned].Trim()));
    }

    [Fact]
    public async Task A_transient_segment_failure_is_tried_once_more()
    {
        var transcript = TenMinuteTranscript();
        var segments = ChunkedStructuring.Segment(transcript, new StructuringBudget(4096).SegmentTokens);
        var second = segments[1].Trim();
        var failedOnce = 0;
        var chat = new FakeChat(segment => segment == second && Interlocked.Increment(ref failedOnce) == 1
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("{\"message\":\"busy\"}") }
            : Answer("""{"dayOutcome":"WORK_RECORDED","observations":[]}"""));

        var result = await SarvamProvider(chat).ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "mr-IN", "system", CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, chat.CallsFor(second));
    }

    [Fact]
    public async Task A_correction_is_never_segmented()
    {
        var chat = new FakeChat(_ => Answer("""{"dayOutcome":"WORK_RECORDED","inputs":[]}"""));
        var longCorrection = TenMinuteTranscript();

        var result = await SarvamProvider(chat).ParseVoiceAsync(
            new MemoryStream(Encoding.UTF8.GetBytes(longCorrection)), "text/plain", "mr-IN", "x\n" + CorrectionPromptData.Heading + "\ny", CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, chat.Calls);
    }

    [Fact]
    public async Task Gemini_structures_a_long_typed_text_in_segments_too()
    {
        var transcript = TenMinuteTranscript();
        var calls = 0;
        var provider = GeminiProvider(_ =>
        {
            Interlocked.Increment(ref calls);
            return GeminiAnswer("""{"dayOutcome":"WORK_RECORDED","observations":[]}""");
        });

        var result = await provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "mr-IN", "system", CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.Equal(ChunkedStructuring.Segment(transcript, new StructuringBudget(new GeminiOptions().MaxTokens).SegmentTokens).Count, calls);
        Assert.True(calls > 1);
    }

    [Fact]
    public void Merge_defines_every_day_level_field_and_never_invents_or_drops()
    {
        var merged = ChunkedStructuring.Merge(
        [
            Obj("""{"summary":"पहिला","dayOutcome":"IRRELEVANT_INPUT","labour":[{"id":"l1","count":3}],"missingSegments":["irrigation","labour"],"confidence":0.9,"fieldConfidences":{"labour":0.8},"fullTranscript":"x"}"""),
            Obj("""{"summary":"दुसरा","dayOutcome":"WORK_RECORDED","labour":[{"id":"l1","count":5}],"missingSegments":["irrigation"],"confidence":0.7,"fieldConfidences":{"labour":0.95},"disturbance":{"reason":"motor_failure","severity":"LOW","blockedSegments":["irrigation"],"note":"मोटर बंद"}}"""),
            Obj("""{"summary":"","dayOutcome":"DISTURBANCE_RECORDED","disturbance":{"reason":"rain","severity":"HIGH","blockedSegments":["spraying"],"note":"पाऊस"},"referenced_date":"2026-10-30"}"""),
        ]);

        Assert.Equal("WORK_RECORDED", merged["dayOutcome"]!.GetValue<string>());
        Assert.Equal("पहिला दुसरा", merged["summary"]!.GetValue<string>());
        Assert.Equal(new[] { 3, 5 }, merged["labour"]!.AsArray().Select(r => r!["count"]!.GetValue<int>()).ToArray());
        Assert.Equal(new[] { "l1", "l1-p2" }, merged["labour"]!.AsArray().Select(r => r!["id"]!.GetValue<string>()).ToArray());
        Assert.Empty(merged["missingSegments"]!.AsArray()); // the third segment does not say irrigation was missing
        Assert.Equal(0.8, merged["confidence"]!.GetValue<double>()); // fix pass 3: row-weighted mean (1 row each), not the lowest
        Assert.Equal(0.8, merged["fieldConfidences"]!["labour"]!.GetValue<double>());
        Assert.False(merged.ContainsKey("fullTranscript"));
        Assert.Equal("2026-10-30", merged["referenced_date"]!.GetValue<string>());
        var disturbance = merged["disturbance"]!;
        Assert.Equal("motor_failure", disturbance["reason"]!.GetValue<string>());
        Assert.Equal("HIGH", disturbance["severity"]!.GetValue<string>());
        Assert.Equal("मोटर बंद | पाऊस", disturbance["note"]!.GetValue<string>());
        Assert.Equal(new[] { "irrigation", "spraying" }, disturbance["blockedSegments"]!.AsArray().Select(b => b!.GetValue<string>()).ToArray());
    }

    // =====================================================================================================
    // B004 — only real silence may be an empty piece
    // =====================================================================================================

    [Theory]
    [InlineData("{\"transcript\":\"आज पाणी दिलं\"}", "Words")]
    [InlineData("{\"results\":[{\"text\":\"आज\"}]}", "Words")]
    [InlineData("{\"transcript\":\"  \"}", "Empty")]
    [InlineData("{\"language_code\":\"mr-IN\"}", "Missing")]
    [InlineData("<html>gateway</html>", "Missing")]
    [InlineData("[]", "Missing")]
    public void A_200_without_a_transcript_field_is_a_protocol_failure_not_no_words(string body, string expected)
    {
        Assert.Equal(expected, SarvamSttClient.ReadTranscript(body, out _, out _).ToString());
    }

    [Fact]
    public async Task Soft_speech_is_never_a_pause_even_next_to_loud_speech_only_near_silence_is()
    {
        // 30 s loud speech (-10 dBFS), 30 s soft speech (about -35 dBFS), 30 s near-silence (about -65 dBFS).
        var random = new Random(11);
        var pcm = new short[90 * Rate];
        for (var i = 0; i < pcm.Length; i++)
        {
            var t = i / (double)Rate;
            var amplitude = t < 30 ? 18000 : t < 60 ? 1000 : 30;
            pcm[i] = (short)random.Next(-amplitude, amplitude);
        }

        var split = await new AudioSplitter(new PcmTranscoder(pcm), NullLogger<AudioSplitter>.Instance).SplitAsync([1], "audio/webm", CancellationToken.None);

        Assert.All(split.Pieces.Where(p => p.EndSample <= 60 * Rate && p.StartSample >= 30 * Rate), p => Assert.False(p.IsQuiet, $"soft speech {p.StartSample / Rate}-{p.EndSample / Rate} s taken for a pause"));
        Assert.All(split.Pieces.Where(p => p.StartSample >= 61 * Rate), p => Assert.True(p.IsQuiet));
        Assert.False(AudioSplitter.IsQuiet(32768 * Math.Pow(10, -35.0 / 20)));
        Assert.True(AudioSplitter.IsQuiet(32768 * Math.Pow(10, -60.0 / 20)));
    }

    [Fact]
    public async Task An_empty_soft_speech_piece_fails_the_recording()
    {
        var pieces = new List<AudioPiece> { new(0, 0, Rate, [], IsQuiet: false), new(1, Rate, 2 * Rate, [], IsQuiet: false) };

        var result = await SarvamSttClient.TranscribePiecesAsync(
            pieces,
            (p, _) => Task.FromResult(SttCallOutcome.Succeeded(p.Index == 1 ? string.Empty : "आज", null, null)),
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(TranscribeFailureCodes.PartFailed, result.FailureCode);
    }

    [SkippableFact]
    public async Task A_piece_answered_200_with_no_transcript_field_fails_the_recording_after_one_more_try()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH.");
        var wav = AudioSplitter.ToWav(Noise(70), Rate);
        var calls = 0;
        var stt = new StubStt(_ => Interlocked.Increment(ref calls) <= 2
            ? Json("{\"language_code\":\"mr-IN\"}")
            : Json("{\"transcript\":\"शब्द\"}"), parallel: false);

        var result = await SttClient(stt, parallel: 1).TranscribeAsync(new MemoryStream(wav), "audio/wav", "mr-IN", CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Transcript);
        Assert.Contains("without a transcript field", result.Error, StringComparison.Ordinal);
        Assert.Equal(TranscribeFailureCodes.PartFailed, result.FailureCode);
    }

    // =====================================================================================================
    // B005 — deterministic failures are classified, never re-run
    // =====================================================================================================

    [Fact]
    public async Task Over_fifteen_minutes_is_refused_deterministically()
    {
        var splitter = new AudioSplitter(new PcmTranscoder(new short[(int)(AudioSplitter.MaxSplitSeconds * Rate) + Rate]), NullLogger<AudioSplitter>.Instance);
        var client = new SarvamSttClient(Options.Create(SarvamOptionsForTest()), new StaticHttpClientFactory(new HttpClient(new StubStt(_ => Json("{}")))), NullLogger<SarvamSttClient>.Instance, splitter);

        var result = await client.TranscribeAsync(new MemoryStream([1, 2, 3]), "audio/webm", "mr-IN", CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(TranscribeFailureCodes.AudioTooLong, result.FailureCode);
        var classifier = new AiFailureClassifier();
        var failureClass = classifier.ClassifyProviderError(result.Error);
        Assert.Equal(AiFailureClass.UnsupportedInput, failureClass);
        Assert.False(classifier.IsRetryEligible(failureClass));
        Assert.False(classifier.IsFallbackEligible(failureClass));
    }

    [Theory]
    [InlineData(3, false)]
    [InlineData(6, true)]
    public async Task A_failed_piece_says_no_retry_and_a_long_recording_also_no_fallback(int pieceCount, bool noFallback)
    {
        var pieces = Enumerable.Range(0, pieceCount).Select(i => new AudioPiece(i, i * Rate, (i + 1) * Rate, [], false)).ToList();

        var result = await SarvamSttClient.TranscribePiecesAsync(
            pieces,
            (p, _) => Task.FromResult(p.Index == 1 ? SttCallOutcome.Failed("boom", retryable: false) : SttCallOutcome.Succeeded("x", null, null)),
            maxParallel: 2,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.Equal(TranscribeFailureCodes.PartFailed, result.FailureCode);
        Assert.Equal(pieceCount, result.Pieces);
        Assert.Contains(AiErrorMarkers.NoRetry, result.Error, StringComparison.Ordinal);
        Assert.Equal(noFallback, AiErrorMarkers.Has(result.Error, AiErrorMarkers.NoFallback));
    }

    [Fact]
    public async Task A_refused_input_is_not_retried_not_handed_on_and_does_not_trip_the_breaker()
    {
        var harness = Orchestrator(CreateConfig(maxRetries: 2, breakerThreshold: 1));
        harness.Gemini.EnqueueVoiceResult(Failed($"{AiErrorMarkers.InputRefused} Audio is longer than 15 minutes."));
        harness.Gemini.EnqueueVoiceResult(Success());

        var refused = await Parse(harness, "refused-1");
        var next = await Parse(harness, "refused-2");

        Assert.False(refused.Result.Success);
        Assert.False(refused.FallbackUsed);
        Assert.Equal(0, harness.Sarvam.VoiceParseCallCount); // not handed to the fallback
        // The breaker (threshold 1) did not open: the next recording goes to the primary again.
        Assert.True(next.Result.Success);
        Assert.False(next.FallbackUsed);
        Assert.Equal(2, harness.Gemini.VoiceParseCallCount); // one attempt each: the refusal was not retried
    }

    [Fact]
    public async Task A_no_retry_failure_is_tried_once_then_handed_to_the_fallback()
    {
        var harness = Orchestrator(CreateConfig(maxRetries: 2));
        harness.Gemini.EnqueueVoiceResult(Failed($"{AiErrorMarkers.NoRetry} Sarvam STT failed on part 2 of 3: timeout"));
        harness.Sarvam.EnqueueVoiceResult(Success());

        var result = await Parse(harness, "no-retry-1");

        Assert.True(result.Result.Success);
        Assert.True(result.FallbackUsed);
        Assert.Equal(1, harness.Gemini.VoiceParseCallCount);
    }

    [Fact]
    public async Task A_long_recordings_failure_is_not_handed_to_a_fallback_that_cannot_answer_it()
    {
        var harness = Orchestrator(CreateConfig(maxRetries: 2));
        harness.Gemini.EnqueueVoiceResult(Failed($"{AiErrorMarkers.NoRetry} {AiErrorMarkers.NoFallback} Structuring failed on part 3 of 9: timeout"));

        var result = await Parse(harness, "no-fallback-1");

        Assert.False(result.Result.Success);
        Assert.Equal(1, harness.Gemini.VoiceParseCallCount);
        Assert.Equal(0, harness.Sarvam.VoiceParseCallCount);
    }

    [Theory]
    [InlineData(6, 0)] // long: ends here, nothing else billed
    [InlineData(3, 1)] // short: the fallback provider only, never the primary speech-to-text again
    public async Task Two_stage_a_failed_piece_never_transcribes_the_recording_again(int pieces, int fallbackCalls)
    {
        var transcriber = new FakeTranscriber(new TranscribeResult
        {
            Success = false,
            Error = "[no-retry] Sarvam STT failed on part 2: boom",
            FailureCode = TranscribeFailureCodes.PartFailed,
            Pieces = pieces,
        });
        var harness = Orchestrator(TwoStageConfig(), transcriber);
        harness.Sarvam.EnqueueVoiceResult(Success());

        var result = await TwoStage(harness, $"two-stage-part-{pieces}");

        Assert.Equal(1, transcriber.Calls);
        Assert.Equal(0, harness.Gemini.VoiceParseCallCount); // the legacy primary (and its speech-to-text) never ran
        Assert.Equal(fallbackCalls, harness.Sarvam.VoiceParseCallCount);
        Assert.Equal(fallbackCalls == 1, result.Result.Success);
    }

    [Fact]
    public async Task Two_stage_a_long_recordings_structurer_failure_is_not_sent_round_again()
    {
        var transcriber = new FakeTranscriber(new TranscribeResult { Success = true, Transcript = "आज खूप काम झालं", Pieces = 9 });
        var harness = Orchestrator(TwoStageConfig(), transcriber);
        harness.Gemini.EnqueueVoiceResult(Failed("timeout transient failure")); // the structurer (Gemini here)
        harness.Gemini.EnqueueVoiceResult(Failed("timeout transient failure"));
        harness.Sarvam.EnqueueVoiceResult(Success());

        var result = await TwoStage(harness, "two-stage-long-structurer");

        Assert.False(result.Result.Success);
        Assert.Equal(0, harness.Sarvam.VoiceParseCallCount);
    }

    // =====================================================================================================
    // B007 — a successful audio parse never stores an empty transcript
    // =====================================================================================================

    [Fact]
    public async Task A_gemini_audio_parse_without_a_transcript_is_a_visible_failure()
    {
        var provider = GeminiProvider(_ => GeminiAnswer("""{"dayOutcome":"WORK_RECORDED","irrigation":[{"durationHours":2}]}"""));

        var result = await provider.ParseVoiceAsync(new MemoryStream([1, 2, 3]), "audio/webm", "mr-IN", "system", CancellationToken.None);

        Assert.False(result.Success);
        Assert.Contains("no transcript", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_gemini_audio_parse_with_its_transcript_still_succeeds()
    {
        var provider = GeminiProvider(_ => GeminiAnswer("""{"dayOutcome":"WORK_RECORDED","fullTranscript":"आज दोन तास पाणी दिलं"}"""));

        var result = await provider.ParseVoiceAsync(new MemoryStream([1, 2, 3]), "audio/webm", "mr-IN", "system", CancellationToken.None);

        Assert.True(result.Success, result.Error);
    }

    // =====================================================================================================
    // CorrectionGuard — the four sentences of the live run
    // =====================================================================================================

    [Fact]
    public void Ethrel_350_not_400_ml_keeps_the_entrys_own_product_name()
    {
        var guarded = Guard(
            """{"inputs":[{"productName":"इथरेल","type":"other","method":"Spray","quantity":350,"unit":"ml","carrierMedium":"water","carrierVolume":400,"carrierUnit":"L"}]}""",
            "इथरेल 350 नाही, 400 मिली",
            """{"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","quantity":400,"unit":"ml","sourceText":"इथरेल 350 नाही, 400 मिली"}],"observations":[]}""");

        var row = guarded["inputs"]!.AsArray().Single()!;
        Assert.Equal("इथरेल", row["productName"]!.GetValue<string>());
        Assert.Equal(400, row["quantity"]!.GetValue<int>());
        Assert.Equal("ml", row["unit"]!.GetValue<string>());
        Assert.Equal(400, row["carrierVolume"]!.GetValue<int>()); // tank water kept
        Assert.Equal("L", row["carrierUnit"]!.GetValue<string>());
        Assert.Equal("Spray", row["method"]!.GetValue<string>());
    }

    [Fact]
    public void Water_2_hours_not_3_keeps_drip_and_makes_no_note()
    {
        var guarded = Guard(
            """{"irrigation":[{"method":"Drip","durationHours":2}]}""",
            "पाणी 2 तास नव्हतं, 3 तास दिलं",
            """{"dayOutcome":"WORK_RECORDED","irrigation":[{"method":"Flood","durationHours":3}],"observations":[{"noteType":"observation","textRaw":"पाणी 2 तास नव्हतं"}]}""");

        var row = guarded["irrigation"]!.AsArray().Single()!;
        Assert.Equal("Drip", row["method"]!.GetValue<string>());
        Assert.Equal(3, row["durationHours"]!.GetValue<int>());
        Assert.Empty(guarded["observations"]!.AsArray());
    }

    [Fact]
    public void Five_women_not_six_adds_no_activity_nobody_said()
    {
        var guarded = Guard(
            """{"labour":[{"type":"HIRED","gender":"female","femaleCount":5}]}""",
            "5 बायका नाही, 6 बायका होत्या",
            """{"dayOutcome":"WORK_RECORDED","labour":[{"type":"HIRED","femaleCount":6,"gender":"female","activity":"weeding"}]}""");

        var row = guarded["labour"]!.AsArray().Single()!.AsObject();
        Assert.Equal(6, row["femaleCount"]!.GetValue<int>());
        Assert.Equal("female", row["gender"]!.GetValue<string>());
        Assert.Equal("HIRED", row["type"]!.GetValue<string>());
        Assert.False(row.ContainsKey("activity"));
    }

    [Fact]
    public void Bavistin_was_not_it_was_saaf_is_the_same_row_with_saaf_and_no_issue_note()
    {
        var guarded = Guard(
            """{"inputs":[{"productName":"बाविस्टीन","type":"fungicide","method":"Spray","quantity":200,"unit":"g"}]}""",
            "बाविस्टीन नव्हतं, साफ मारलं होतं",
            """{"dayOutcome":"WORK_RECORDED","inputs":[],"observations":[{"noteType":"issue","textRaw":"बाविस्टीन नव्हतं"}]}""");

        var row = guarded["inputs"]!.AsArray().Single()!;
        Assert.Equal("साफ", row["productName"]!.GetValue<string>());
        Assert.Equal("fungicide", row["type"]!.GetValue<string>());
        Assert.Equal("Spray", row["method"]!.GetValue<string>());
        Assert.Equal(200, row["quantity"]!.GetValue<int>());
        Assert.Equal("g", row["unit"]!.GetValue<string>());
        Assert.Empty(guarded["observations"]!.AsArray());
    }

    [Fact]
    public void A_swap_the_model_did_answer_keeps_everything_but_the_product()
    {
        var guarded = Guard(
            """{"inputs":[{"productName":"बाविस्टीन","type":"fungicide","method":"Spray","quantity":200,"unit":"g"}]}""",
            "बाविस्टीन नव्हतं, साफ मारलं होतं",
            """{"inputs":[{"productName":"Saaf","rawProductName":"साफ","type":"pesticide","method":"Drenching","sourceText":"साफ मारलं होतं"}]}""");

        var row = guarded["inputs"]!.AsArray().Single()!;
        Assert.Equal("साफ", row["productName"]!.GetValue<string>());
        Assert.Equal("fungicide", row["type"]!.GetValue<string>());
        Assert.Equal("Spray", row["method"]!.GetValue<string>());
        Assert.Equal(200, row["quantity"]!.GetValue<int>());
        Assert.Equal("साफ मारलं होतं", row["sourceText"]!.GetValue<string>());
    }

    [Fact]
    public void A_new_condition_he_states_in_a_correction_stays_a_note()
    {
        var guarded = Guard(
            """{"irrigation":[{"method":"Drip","durationHours":2}]}""",
            "पाणी 2 तास नव्हतं, 3 तास दिलं. पानांवर डाग दिसले.",
            """{"irrigation":[{"method":"Drip","durationHours":3}],"observations":[{"noteType":"observation","textRaw":"पानांवर डाग दिसले"}]}""");

        Assert.Equal("पानांवर डाग दिसले", guarded["observations"]!.AsArray().Single()!["textRaw"]!.GetValue<string>());
    }

    [Fact]
    public void A_negation_about_something_not_in_the_entry_is_left_alone()
    {
        var guarded = Guard(
            """{"irrigation":[{"method":"Drip","durationHours":2}]}""",
            "पाऊस आला नाही, फवारणी केली",
            """{"irrigation":[{"method":"Drip","durationHours":2}],"observations":[{"noteType":"observation","textRaw":"पाऊस आला नाही"}]}""");

        Assert.Single(guarded["observations"]!.AsArray());
    }

    [Fact]
    public void A_unit_said_another_way_keeps_the_entrys_spelling()
    {
        var guarded = Guard(
            """{"inputs":[{"productName":"इथरेल","quantity":350,"unit":"ml"}]}""",
            "इथरेल 350 नाही, 400 मिली",
            """{"inputs":[{"productName":"इथरेल","quantity":400,"unit":"मिली"}]}""");

        Assert.Equal("ml", guarded["inputs"]![0]!["unit"]!.GetValue<string>());
    }

    // =====================================================================================================
    // Reviewer notes
    // =====================================================================================================

    [Fact]
    public void The_registered_stt_client_splits_long_recordings()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IOptions<SarvamOptions>>(Options.Create(SarvamOptionsForTest()));
        services.AddSingleton<IHttpClientFactory>(new StaticHttpClientFactory(new HttpClient()));
        DependencyInjection.AddVoiceTranscription(services);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var client = scope.ServiceProvider.GetRequiredService<SarvamSttClient>();

        // Deleting the AudioSplitter registration turns this red: the client would silently send every long
        // recording whole (and Sarvam refuses anything over 30 s).
        Assert.True(client.SplitsLongAudio);
    }

    [Fact]
    public void The_probe_reads_a_wav_length_exactly()
    {
        var wav = AudioSplitter.ToWav(new short[(int)(12.5 * Rate)], Rate);

        Assert.Equal(12.5, AudioDurationProbe.TryRead(wav)!.Value.TotalSeconds, 3);
    }

    [Fact]
    public void The_probe_reads_a_browser_style_webm_with_unknown_sizes_and_no_duration()
    {
        // What MediaRecorder writes: an unknown-size Segment and Clusters, no Duration — the last block's time counts.
        var webm = BrowserStyleWebm(seconds: 21.0, clusterSeconds: 5);

        Assert.Equal(21.0, AudioDurationProbe.TryRead(webm)!.Value.TotalSeconds, 1);
    }

    [SkippableFact]
    public async Task The_probe_reads_an_ffmpeg_webm()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH.");
        var webm = await Ffmpeg(AudioSplitter.ToWav(Noise(17), Rate), "-i", "pipe:0", "-c:a", "libopus", "-b:a", "24k", "-f", "webm", "pipe:1");

        Assert.Equal(17.0, AudioDurationProbe.TryRead(webm)!.Value.TotalSeconds, 0);
    }

    [Theory]
    [InlineData(new byte[] { 0x10, 0x20, 0x30 })]
    [InlineData(new byte[] { 0x1A, 0x45, 0xDF, 0xA3, 0xFF })]
    [InlineData(new byte[] { })]
    public void The_probe_gives_nothing_for_what_it_does_not_understand(byte[] bytes)
    {
        Assert.Null(AudioDurationProbe.TryRead(bytes));
    }

    [Fact]
    public async Task A_short_clip_the_probe_can_read_is_never_decoded()
    {
        var transcoder = new CountingTranscoder();
        var splitter = new AudioSplitter(transcoder, NullLogger<AudioSplitter>.Instance);

        var wav = await splitter.SplitAsync(AudioSplitter.ToWav(new short[20 * Rate], Rate), "audio/wav", CancellationToken.None);
        var webm = await splitter.SplitAsync(BrowserStyleWebm(seconds: 15, clusterSeconds: 5), "audio/webm", CancellationToken.None);

        Assert.False(wav.IsSplit);
        Assert.False(webm.IsSplit);
        Assert.Equal(0, transcoder.Calls);
    }

    [Fact]
    public async Task At_most_two_long_clips_are_decoded_at_once()
    {
        var transcoder = new CountingTranscoder(delay: TimeSpan.FromMilliseconds(150), pcm: new short[30 * Rate]);
        var splitter = new AudioSplitter(transcoder, NullLogger<AudioSplitter>.Instance);

        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => splitter.SplitAsync([1, 2, 3], "audio/webm", CancellationToken.None)));

        Assert.Equal(6, transcoder.Calls);
        Assert.True(transcoder.MaxInFlight <= AudioSplitter.MaxConcurrentDecodes, $"{transcoder.MaxInFlight} decodes at once");
    }

    [SkippableFact]
    public async Task A_hung_ffmpeg_decode_is_killed_at_its_deadline()
    {
        Skip.If(!FfmpegOnPath(), "ffmpeg is not on PATH.");
        var transcoder = new FfmpegAudioTranscoder(NullLogger<FfmpegAudioTranscoder>.Instance, TimeSpan.FromSeconds(1));
        var started = DateTime.UtcNow;

        await Assert.ThrowsAsync<TimeoutException>(async () =>
        {
            await foreach (var _ in transcoder.ToPcm16kMonoAsync(new NeverEndingStream(), "audio/webm", 16000, CancellationToken.None))
            {
            }
        });

        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(15));
    }

    [Fact]
    public async Task The_recordings_language_is_its_first_pieces_not_the_first_to_answer()
    {
        var pieces = Enumerable.Range(0, 3).Select(i => new AudioPiece(i, i * Rate, (i + 1) * Rate, [], false)).ToList();

        var result = await SarvamSttClient.TranscribePiecesAsync(
            pieces,
            async (p, ct) =>
            {
                await Task.Delay(p.Index == 0 ? 120 : 5, ct);
                return SttCallOutcome.Succeeded("x", p.Index == 0 ? "mr-IN" : "en-IN", null);
            },
            maxParallel: 3,
            NullLogger.Instance,
            CancellationToken.None);

        Assert.Equal("mr-IN", result.LanguageCode);
        Assert.Equal(3, result.Pieces);
    }

    [Fact]
    public void The_gemini_fallback_waits_two_minutes_by_default()
    {
        Assert.Equal(120, new GeminiOptions().TimeoutSeconds);
    }

    // =====================================================================================================
    // fixtures
    // =====================================================================================================

    /// <summary>About ten minutes of a farmer's day said aloud: Marathi with English words in it, numbers, names.</summary>
    internal static string TenMinuteTranscript()
    {
        string[] lines =
        [
            "आज सकाळी सात वाजता बागेत गेलो, सगळ्या ओळी फिरून पाहिल्या।",
            "पाच बायका आणि दोन पुरुष छाटणीला होते, त्यांनी दुपारपर्यंत काम केलं।",
            "इथरेल {0} मिली आणि बाविस्टीन {1} ग्रॅम एकत्र करून फवारणी केली, पाणी {2} लिटर वापरलं।",
            "ड्रिप ने {3} तास पाणी दिलं, मोटर नीट चालली।",
            "उत्तरेकडच्या प्लॉट मध्ये काही पानांवर डाग दिसले, उद्या कृषी सहाय्यकाला दाखवायचं आहे।",
            "spray साठी tractor चा blower वापरला, diesel {4} लिटर लागलं।",
            "दुकानदाराने सांगितलं म्हणून 19:19:19 {5} किलो ड्रिप मधून दिलं।",
            "विलास जाधव आणि संतू रोकडे आले होते, त्यांनी तारा बांधल्या।",
            "मजुरीचे प्रत्येकी {6} रुपये दिले, चहा नाश्त्याला दोनशे रुपये खर्च झाले।",
            "दुपारी थोडा वारा होता म्हणून फवारणी अर्धा तास थांबवली।",
            "खालच्या बाजूच्या ओळीत गवत खूप वाढलं आहे, पुढच्या आठवड्यात खुरपणी करायची आहे।",
            "आज light तीन तास गेली होती, त्यामुळे पाणी उशिरा सुरू झालं।",
        ];

        var builder = new StringBuilder();
        for (var minute = 0; minute < 10; minute++)
        {
            foreach (var line in lines)
            {
                builder.Append(string.Format(
                    System.Globalization.CultureInfo.InvariantCulture,
                    line,
                    250 + (minute * 10),
                    200 + minute,
                    400 + (minute * 20),
                    2 + (minute % 3),
                    5 + minute,
                    3 + (minute % 2),
                    300 + (minute * 5)));
                builder.Append(' ');
            }
        }

        return builder.ToString().TrimEnd();
    }

    private static string First(string segment) => segment.Length <= 24 ? segment : segment[..24];

    private static JsonObject Obj(string json) => JsonNode.Parse(json)!.AsObject();

    private static JsonObject Guard(string entry, string words, string answer)
    {
        using var doc = JsonDocument.Parse(entry);
        return JsonNode.Parse(CorrectionGuard.Apply(answer, doc.RootElement, words))!.AsObject();
    }

    private static short[] Noise(double seconds)
    {
        var random = new Random(5);
        var pcm = new short[(int)(seconds * Rate)];
        for (var i = 0; i < pcm.Length; i++)
        {
            pcm[i] = (short)random.Next(-9000, 9000);
        }

        return pcm;
    }

    /// <summary>A MediaRecorder-like WebM: EBML header, unknown-size Segment, Info with a timecode scale and no
    /// duration, then unknown-size Clusters of 20 ms Opus-sized SimpleBlocks.</summary>
    private static byte[] BrowserStyleWebm(double seconds, int clusterSeconds)
    {
        var ms = new MemoryStream();
        void Element(byte[] id, byte[] body)
        {
            ms.Write(id);
            ms.Write(Size(body.Length));
            ms.Write(body);
        }

        static byte[] Size(long n) => [0x01, .. BitConverter.GetBytes(n).Reverse().Skip(1)]; // an 8-byte size vint
        static byte[] Uint(long n) => [(byte)(n >> 24), (byte)(n >> 16), (byte)(n >> 8), (byte)n];

        Element([0x1A, 0x45, 0xDF, 0xA3], [0x42, 0x82, 0x84, (byte)'w', (byte)'e', (byte)'b', (byte)'m']);
        ms.Write([0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]); // Segment, unknown size
        var info = new MemoryStream();
        info.Write([0x2A, 0xD7, 0xB1, 0x84, .. Uint(1_000_000)]);
        Element([0x15, 0x49, 0xA9, 0x66], info.ToArray());
        var totalMs = (long)(seconds * 1000);
        for (long clusterStart = 0; clusterStart < totalMs; clusterStart += clusterSeconds * 1000)
        {
            ms.Write([0x1F, 0x43, 0xB6, 0x75, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]); // Cluster, unknown size
            ms.Write([0xE7, 0x84, .. Uint(clusterStart)]);
            for (long t = 0; t < clusterSeconds * 1000 && clusterStart + t < totalMs - 19; t += 20)
            {
                var block = new byte[] { 0x81, (byte)(t >> 8), (byte)t, 0x80, 0xFC, 0x01, 0x02, 0x03 };
                ms.Write([0xA3]);
                ms.Write(Size(block.Length));
                ms.Write(block);
            }
        }

        return ms.ToArray();
    }

    private static SarvamAiProvider SarvamProvider(FakeChat chat)
    {
        var options = Options.Create(SarvamOptionsForTest());
        var factory = new StaticHttpClientFactory(new HttpClient(chat));
        return new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);
    }

    private static GeminiAiProvider GeminiProvider(Func<HttpRequestMessage, HttpResponseMessage> answer)
    {
        var options = Options.Create(new GeminiOptions
        {
            ApiKey = "test-key",
            BaseUrl = "https://unit.test",
            StructurerModelId = "gemini-test",
            OcrModelId = "gemini-test",
            VoiceFallbackModelId = "gemini-test",
            TimeoutSeconds = 5,
        });
        var client = new HttpClient(new StubHttpMessageHandler(answer)) { BaseAddress = new Uri("https://unit.test") };
        return new GeminiAiProvider(options, new StaticHttpClientFactory(client), new AiResponseNormalizer(), NullLogger<GeminiAiProvider>.Instance, new ThrowingAdminDbContextFactory());
    }

    private static HttpResponseMessage GeminiAnswer(string json) => Json(JsonSerializer.Serialize(new
    {
        candidates = new[] { new { content = new { parts = new[] { new { text = json } } }, finishReason = "STOP" } },
    }));

    private static SarvamSttClient SttClient(StubStt stt, int parallel)
    {
        var options = SarvamOptionsForTest();
        options.SttMaxParallelPieces = parallel;
        return new SarvamSttClient(
            Options.Create(options),
            new StaticHttpClientFactory(new HttpClient(stt)),
            NullLogger<SarvamSttClient>.Instance,
            new AudioSplitter(new FfmpegAudioTranscoder(NullLogger<FfmpegAudioTranscoder>.Instance), NullLogger<AudioSplitter>.Instance));
    }

    private static SarvamOptions SarvamOptionsForTest() => new()
    {
        ApiSubscriptionKey = "k-test",
        SttEndpoint = "https://unit.test/stt",
        ChatEndpoint = "https://unit.test/chat",
        ChatModel = "sarvam-test",
        TimeoutSeconds = 10,
        ChatTimeoutSeconds = 10,
    };

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    private static HttpResponseMessage Answer(string content) => Json(JsonSerializer.Serialize(new
    {
        choices = new[] { new { finish_reason = "stop", message = new { content } } },
        usage = new { completion_tokens = 321 },
    }));

    private static HttpResponseMessage CutOff() => Json(
        """{"choices":[{"finish_reason":"length","message":{"content":"{\"observations\":[{\"textRaw\":\"अर्ध"}}]}""");

    private static bool FfmpegOnPath()
    {
        var names = OperatingSystem.IsWindows() ? new[] { "ffmpeg.exe" } : ["ffmpeg"];
        return (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Any(dir => names.Any(n => File.Exists(Path.Combine(dir.Trim(), n))));
    }

    private static async Task<byte[]> Ffmpeg(byte[] stdin, params string[] args)
    {
        var psi = new System.Diagnostics.ProcessStartInfo("ffmpeg") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in new[] { "-hide_banner", "-loglevel", "error" }.Concat(args))
        {
            psi.ArgumentList.Add(arg);
        }

        using var process = System.Diagnostics.Process.Start(psi)!;
        var stderr = process.StandardError.ReadToEndAsync();
        await using var output = new MemoryStream();
        var copy = process.StandardOutput.BaseStream.CopyToAsync(output);
        await process.StandardInput.BaseStream.WriteAsync(stdin);
        process.StandardInput.Close();
        await copy;
        await process.WaitForExitAsync();
        Assert.True(process.ExitCode == 0, await stderr);
        return output.ToArray();
    }

    // ------------------------------------------------------------------ orchestrator harness (as AiOrchestratorTests)

    private sealed record Harness(AiOrchestrator Orchestrator, FakeAiProvider Sarvam, FakeAiProvider Gemini);

    private static Harness Orchestrator(AiProviderConfig config, ITranscriberProvider? transcriber = null)
    {
        var sarvam = new FakeAiProvider(AiProviderType.Sarvam);
        var gemini = new FakeAiProvider(AiProviderType.Gemini);
        var orchestrator = new AiOrchestrator(
            [sarvam, gemini],
            transcriber is null ? [] : [transcriber],
            new InMemoryAiJobRepository(config),
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            new InMemoryRawBlobStore(),
            new RecordingShramSafalRepository(),
            NullLogger<AiOrchestrator>.Instance);
        return new Harness(orchestrator, sarvam, gemini);
    }

    private static AiProviderConfig CreateConfig(int maxRetries = 1, int breakerThreshold = 5)
    {
        var config = AiProviderConfig.CreateDefault();
        config.UpdateSettings(
            modifiedByUserId: Guid.NewGuid(),
            defaultProvider: AiProviderType.Gemini,
            fallbackEnabled: true,
            isAiProcessingDisabled: false,
            maxRetries: maxRetries,
            circuitBreakerThreshold: breakerThreshold,
            circuitBreakerResetSeconds: 60,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m);
        return config;
    }

    private static AiProviderConfig TwoStageConfig()
    {
        var config = CreateConfig();
        config.SetProviderTuple("Sarvam", "codemix", "Gemini", null);
        return config;
    }

    private static Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> Parse(Harness h, string key) =>
        h.Orchestrator.ParseVoiceWithFallbackAsync(Guid.NewGuid(), Guid.NewGuid(), new MemoryStream([1, 2, 3, 4]), "audio/webm", "system-prompt", key, ct: CancellationToken.None);

    private static Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> TwoStage(Harness h, string key) =>
        h.Orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream([1, 2, 3, 4]),
            "audio/webm",
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            key,
            ct: CancellationToken.None);

    private static VoiceParseCanonicalResult Failed(string error) => new() { Success = false, Error = error };

    private static VoiceParseCanonicalResult Success() => new()
    {
        Success = true,
        NormalizedJson = """{"summary":"ok","dayOutcome":"WORK_RECORDED","fullTranscript":"test","confidence":0.9}""",
        OverallConfidence = 0.9m,
    };

    // ------------------------------------------------------------------ fakes

    /// <summary>The Sarvam chat endpoint, faked: answers per segment, counts calls and how many were in flight.</summary>
    private sealed class FakeChat(Func<string, HttpResponseMessage> answer) : HttpMessageHandler
    {
        private readonly System.Collections.Concurrent.ConcurrentDictionary<string, int> _calls = new();
        private int _inFlight;
        private int _maxInFlight;

        public int Calls => _calls.Values.Sum();

        public int MaxInFlight => _maxInFlight;

        public int CallsFor(string segment) => _calls.TryGetValue(segment, out var n) ? n : 0;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var now = Interlocked.Increment(ref _inFlight);
            InterlockedMax(ref _maxInFlight, now);
            try
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                var user = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
                _calls.AddOrUpdate(user, 1, (_, n) => n + 1);
                await Task.Delay(15, cancellationToken);
                return answer(user);
            }
            finally
            {
                Interlocked.Decrement(ref _inFlight);
            }
        }
    }

    private sealed class StubStt(Func<byte[], HttpResponseMessage> answer, bool parallel = true) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            _ = parallel;
            var file = ((MultipartFormDataContent)request.Content!).First(p => p.Headers.ContentDisposition?.Name?.Trim('"') == "file");
            return answer(await file.ReadAsByteArrayAsync(cancellationToken));
        }
    }

    private sealed class FakeTranscriber(TranscribeResult result) : ITranscriberProvider
    {
        public int Calls { get; private set; }

        public AiProviderType ProviderType => AiProviderType.Sarvam;

        public bool SupportsStreaming => false;

        public Task<TranscribeResult> TranscribeAsync(Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(result);
        }

        public IAsyncEnumerable<string> TranscribeStreamAsync(Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct) =>
            throw new NotSupportedException();
    }

    private sealed class PcmTranscoder(short[] pcm) : IAudioTranscoder
    {
        public async IAsyncEnumerable<ReadOnlyMemory<byte>> ToPcm16kMonoAsync(Stream sourceAudio, string sourceMimeType, int targetSampleRateHz = 16000, [EnumeratorCancellation] CancellationToken ct = default)
        {
            await Task.CompletedTask;
            yield return MemoryMarshal.AsBytes(pcm.AsSpan()).ToArray();
        }
    }

    private sealed class CountingTranscoder(TimeSpan? delay = null, short[]? pcm = null) : IAudioTranscoder
    {
        private int _calls;
        private int _inFlight;
        private int _maxInFlight;

        public int Calls => _calls;

        public int MaxInFlight => _maxInFlight;

        public async IAsyncEnumerable<ReadOnlyMemory<byte>> ToPcm16kMonoAsync(Stream sourceAudio, string sourceMimeType, int targetSampleRateHz = 16000, [EnumeratorCancellation] CancellationToken ct = default)
        {
            Interlocked.Increment(ref _calls);
            InterlockedMax(ref _maxInFlight, Interlocked.Increment(ref _inFlight));
            try
            {
                await Task.Delay(delay ?? TimeSpan.Zero, ct);
            }
            finally
            {
                Interlocked.Decrement(ref _inFlight);
            }

            yield return MemoryMarshal.AsBytes((pcm ?? new short[Rate]).AsSpan()).ToArray();
        }
    }

    /// <summary>A source that never ends and never sends a byte: a stalled upload pipe.</summary>
    private sealed class NeverEndingStream : Stream
    {
        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => 0; set => throw new NotSupportedException(); }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int seen;
        do
        {
            seen = Volatile.Read(ref target);
            if (value <= seen)
            {
                return;
            }
        }
        while (Interlocked.CompareExchange(ref target, value, seen) != seen);
    }
}
