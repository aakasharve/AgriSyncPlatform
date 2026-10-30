using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR lane V-1 FIX PASS 3 (after the third live run, 2026-10-31). No AI is called here.
///
/// Live: the 619 s clip was structured in 6 complete Sarvam parts, but the merge took the LOWEST confidence (0.5),
/// the orchestrator called that "low confidence" (threshold 0.6) and handed the recording to Gemini, whose one-call
/// answer was cut off → HTTP 400; the whole recording was lost. Also: real ratios 8.6–12.9 (plan was 8.0), and a
/// context whose <c>profile</c> is <c>{}</c> crashed the parse with HTTP 500 (F74).
/// </summary>
public sealed class PlrV1FixPass3Tests
{
    private const string EthrelEntry = """{"inputs":[{"productName":"इथरेल","type":"other","method":"Spray","quantity":350,"unit":"ml"}]}""";

    // =====================================================================================================
    // 1. A complete long result is never thrown away for a fallback that cannot take it
    // =====================================================================================================

    [Fact]
    public async Task The_live_case_six_complete_sarvam_parts_at_low_confidence_are_kept_and_gemini_is_never_called()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var sarvam = SarvamProvider(new AnsweringChat(confidence: 0.5));
        var gemini = new FakeAiProvider(AiProviderType.Gemini);
        gemini.EnqueueVoiceResult(new VoiceParseCanonicalResult { Success = false, Error = "Gemini output was truncated at the max token limit." });
        var orchestrator = Orchestrator(sarvam, gemini, AiProviderType.Sarvam);

        var (result, _, providerUsed, fallbackUsed) = await orchestrator.ParseVoiceWithFallbackAsync(
            Guid.NewGuid(), Guid.NewGuid(), new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "system", "live-619", ct: CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.False(fallbackUsed);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        Assert.Equal(0, gemini.VoiceParseCallCount);
        Assert.True(result.StructuredParts > 1);
        Assert.Equal(0.5m, result.OverallConfidence); // kept as it is: the screen shows what is not sure
        var root = JsonNode.Parse(result.NormalizedJson!)!;
        Assert.Equal(result.StructuredParts, root["observations"]!.AsArray().Count); // one row per part, none lost
    }

    [Fact]
    public async Task A_low_confidence_long_result_is_kept_with_no_fallback_call()
    {
        var harness = Harness(AiProviderType.Gemini);
        harness.Primary.EnqueueVoiceResult(LowConfidence(parts: 6));
        harness.Fallback.EnqueueVoiceResult(new VoiceParseCanonicalResult { Success = true, NormalizedJson = "{}", OverallConfidence = 0.9m });

        var (result, jobId, _, fallbackUsed) = await Parse(harness, "long-low");

        Assert.True(result.Success);
        Assert.False(fallbackUsed);
        Assert.Equal(AiJobStatus.Succeeded, (await harness.Jobs.GetByIdAsync(jobId))!.Status);
        Assert.Equal(1, harness.Primary.VoiceParseCallCount);
        Assert.Equal(0, harness.Fallback.VoiceParseCallCount);
        Assert.Equal(0.5m, result.OverallConfidence);
    }

    [Fact]
    public async Task A_low_confidence_one_call_result_still_goes_to_the_fallback_as_before()
    {
        var harness = Harness(AiProviderType.Gemini);
        harness.Primary.EnqueueVoiceResult(LowConfidence(parts: 1));
        harness.Fallback.EnqueueVoiceResult(new VoiceParseCanonicalResult { Success = true, NormalizedJson = "{}", OverallConfidence = 0.9m });

        var (result, _, _, fallbackUsed) = await Parse(harness, "short-low");

        Assert.True(result.Success);
        Assert.True(fallbackUsed);
        Assert.Equal(1, harness.Fallback.VoiceParseCallCount);
    }

    [Fact]
    public async Task Two_stage_a_low_confidence_structure_in_parts_is_kept_too()
    {
        // Three speech-to-text pieces: few enough that the fallback provider WOULD be tried for a low-confidence answer.
        var harness = Harness(AiProviderType.Gemini, new SplitTranscriber(PlrV1FixPassTests.TenMinuteTranscript(), pieces: 3));
        harness.Primary.EnqueueVoiceResult(LowConfidence(parts: 2)); // the structurer (Gemini in this tuple)
        harness.Fallback.EnqueueVoiceResult(new VoiceParseCanonicalResult { Success = true, NormalizedJson = "{}", OverallConfidence = 0.9m });

        var (result, jobId, _, fallbackUsed) = await harness.Orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream([1, 2, 3, 4]),
            "audio/webm",
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            "two-stage-long-low",
            ct: CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.False(fallbackUsed);
        Assert.Equal(0, harness.Fallback.VoiceParseCallCount);
        Assert.Equal(AiJobStatus.Succeeded, (await harness.Jobs.GetByIdAsync(jobId))!.Status);
    }

    [Fact]
    public async Task The_sarvam_provider_says_how_many_parts_it_structured()
    {
        var chat = new AnsweringChat(confidence: 0.8);
        var provider = SarvamProvider(chat);

        var longResult = await provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(PlrV1FixPassTests.TenMinuteTranscript())), "text/plain", "mr-IN", "system", CancellationToken.None);
        var shortResult = await provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes("आज पाणी दिलं।")), "text/plain", "mr-IN", "system", CancellationToken.None);

        Assert.True(longResult.Success, longResult.Error);
        Assert.Equal(ChunkedStructuring.Segment(PlrV1FixPassTests.TenMinuteTranscript(), new StructuringBudget(4096).SegmentTokens).Count, longResult.StructuredParts);
        Assert.Equal(1, shortResult.StructuredParts);
    }

    // =====================================================================================================
    // 1b. The merged score: a row-weighted mean; per-field marks stay the lowest
    // =====================================================================================================

    [Fact]
    public void The_merged_score_is_the_mean_weighted_by_rows_and_each_fields_mark_stays_the_lowest()
    {
        var merged = ChunkedStructuring.Merge(
        [
            Obj("""{"confidence":0.5,"inputs":[{"productName":"इथरेल"}],"fieldConfidences":{"inputs":0.4}}"""),
            Obj("""{"confidence":0.9,"labour":[{"count":2},{"count":3}],"irrigation":[{"durationHours":2},{"durationHours":1}],"inputs":[{"productName":"साफ"}],"fieldConfidences":{"inputs":0.95,"labour":0.9}}"""),
            Obj("""{"confidence":0.6}"""), // no rows: weighs one
        ]);

        // (0.5 × 1 + 0.9 × 5 + 0.6 × 1) / 7 = 0.8
        Assert.Equal(0.8, merged["confidence"]!.GetValue<double>());
        Assert.Equal(0.4, merged["fieldConfidences"]!["inputs"]!.GetValue<double>());
        Assert.Equal(0.9, merged["fieldConfidences"]!["labour"]!.GetValue<double>());
    }

    [Fact]
    public void Six_good_parts_and_one_unsure_part_are_not_scored_as_the_unsure_one()
    {
        var parts = Enumerable.Range(0, 6)
            .Select(i => Obj($$"""{"confidence":{{(i == 2 ? "0.5" : "0.9")}},"observations":[{"textRaw":"{{i}}"},{"textRaw":"{{i}}b"}]}"""))
            .ToList();

        var merged = ChunkedStructuring.Merge(parts);

        Assert.True(merged["confidence"]!.GetValue<double>() >= 0.6, "a mostly sure long recording must not read as low confidence");
    }

    // =====================================================================================================
    // 2. The plan at the measured ratio
    // =====================================================================================================

    [Fact]
    public void The_plan_uses_11_and_the_worst_ratio_seen_live_still_fits_with_room()
    {
        Assert.Equal(11.0, StructuringBudget.AnswerTokensPerSpokenToken);
        var segment = new StructuringBudget(4096).SegmentTokens;
        Assert.Equal(187, segment);
        // The six live parts answered at 8.6 / 11.5 / 11.0 / 10.3 / 8.5 / 12.9 answer tokens a transcript token.
        foreach (var ratio in new[] { 8.6, 11.5, 11.0, 10.3, 8.5, 12.9 })
        {
            Assert.True(400 + (ratio * segment) < 4096 * 0.75, $"ratio {ratio}: {400 + (ratio * segment)} tokens");
        }
    }

    [Fact]
    public async Task At_the_worst_live_ratio_a_ten_minute_transcript_is_never_cut_off()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var cutOffs = 0;
        var calls = 0;

        var result = await ChunkedStructuring.StructureAsync(
            transcript,
            new StructuringBudget(4096).SegmentTokens,
            (text, _) =>
            {
                Interlocked.Increment(ref calls);
                if (400 + (StructuringBudget.EstimateTokens(text) * 12.9) > 4096)
                {
                    Interlocked.Increment(ref cutOffs);
                    return Task.FromResult(SegmentAnswer.CutOffAnswer(SarvamChatClient.CutOffError));
                }

                return Task.FromResult(SegmentAnswer.Ok("""{"observations":[{"textRaw":"x"}]}"""));
            },
            NullLogger.Instance,
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(0, cutOffs);
        Assert.Equal(ChunkedStructuring.Segment(transcript, new StructuringBudget(4096).SegmentTokens).Count, calls);
    }

    // =====================================================================================================
    // 3. F74 — a partial or older context never 500s, and correctionOf survives
    // =====================================================================================================

    public static TheoryData<string> PartialContexts() =>
    [
        """{"availableCrops":[],"profile":{}}""",
        """{"availableCrops":[null],"profile":{"motors":[null],"waterResources":null}}""",
        """{"availableCrops":[{"id":"c1","name":"Grapes"}],"profile":{"motors":null,"machineries":null},"farmContext":{},"vocabDb":{}}""",
        """{"availableCrops":[],"profile":{},"farmContext":{"selection":[{"cropId":"c1","cropName":"Grapes"},null]},"vocabDb":{"mappings":[null]}}""",
        """{"availableCrops":[],"profile":{"ledgerDefaults":{}}}""",
        """{"profile":{}}""",
        """{"availableCrops":{},"profile":{}}""",
        """{}""",
        "not json at all",
    ];

    [Theory]
    [MemberData(nameof(PartialContexts))]
    public void A_partial_or_older_context_builds_a_prompt_and_never_throws(string contextJson)
    {
        var context = ParseVoiceInputHandler.BuildPromptContext(contextJson, "शेत", "G1", "Grapes");

        foreach (var modular in new[] { false, true })
        {
            var prompt = Builder(modular).BuildVoiceParsingPrompt(context);
            Assert.Contains("Motors/Pumps:", prompt, StringComparison.Ordinal);
        }
    }

    [Theory]
    [MemberData(nameof(PartialContexts))]
    public void The_prompt_builder_itself_survives_a_context_bound_straight_from_a_request_body(string contextJson)
    {
        // The streaming and eval endpoints bind the context from the body and hand it straight to the builder.
        VoiceParseContext? bound;
        try
        {
            bound = JsonSerializer.Deserialize<VoiceParseContext>(contextJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (JsonException)
        {
            return; // the endpoint answers 400 for a body that is not a context; nothing reaches the builder
        }

        if (bound is null)
        {
            return;
        }

        foreach (var modular in new[] { false, true })
        {
            var prompt = Builder(modular).BuildVoiceParsingPrompt(bound);
            Assert.Contains("Water Sources:", prompt, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void A_partial_profile_reads_as_not_provided()
    {
        var context = ParseVoiceInputHandler.BuildPromptContext("""{"availableCrops":[{"id":"c1","name":"Grapes"}],"profile":{}}""", "शेत", "G1", "Grapes");

        var prompt = Builder(modular: false).BuildVoiceParsingPrompt(context);

        Assert.Contains("- Crops: [Grapes]", prompt, StringComparison.Ordinal); // the phone's crops are still used
        Assert.Contains("- Motors/Pumps: [Not provided]", prompt, StringComparison.Ordinal);
        Assert.Contains("- Water Sources: [Not provided]", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"availableCrops":[],"profile":{},"correctionOf":ENTRY}""")]              // usable once nulls are read as empty
    [InlineData("""{"profile":{},"correctionOf":ENTRY}""")]                                    // no crops: the server builds the context
    [InlineData("""{"availableCrops":{},"profile":{},"correctionOf":ENTRY}""")]                // a wrong shape: not readable as a context
    [InlineData("""{"availableCrops":[],"profile":"old","CorrectionOf":ENTRY}""")]             // an older/odd phone, any letter case
    [InlineData("""{"correctionOf":ENTRY}""")]                                                 // nothing but the correction
    public void CorrectionOf_survives_when_the_rest_of_the_context_is_unusable(string template)
    {
        var context = ParseVoiceInputHandler.BuildPromptContext(template.Replace("ENTRY", EthrelEntry, StringComparison.Ordinal), "शेत", "G1", "Grapes");

        Assert.NotNull(context.CorrectionOf);
        Assert.Equal(350, context.CorrectionOf!.Value.GetProperty("inputs")[0].GetProperty("quantity").GetInt32());
        var prompt = Builder(modular: false).BuildVoiceParsingPrompt(context);
        Assert.Contains("THIS REQUEST IS A CORRECTION", prompt, StringComparison.Ordinal);
        Assert.Contains("\"quantity\":350", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void When_the_server_builds_the_context_it_is_the_farm_it_knows_with_the_correction_attached()
    {
        var context = ParseVoiceInputHandler.BuildPromptContext($$"""{"availableCrops":{},"correctionOf":{{EthrelEntry}}}""", "शेत", "G1", "Grapes", "flowering");

        var selection = Assert.Single(context.FarmContext!.Selection);
        Assert.Equal("Grapes", selection.CropName);
        Assert.Equal(new[] { "G1" }, selection.SelectedPlotNames);
        Assert.Equal("flowering", context.CropStage);
        Assert.NotNull(context.CorrectionOf);
    }

    [Theory]
    [InlineData("""{"availableCrops":{},"correctionOf":"इथरेल 350"}""")]
    [InlineData("""{"availableCrops":{},"correctionOf":null}""")]
    [InlineData("not json at all")]
    public void No_correction_is_invented_from_a_context_without_one(string contextJson)
    {
        var context = ParseVoiceInputHandler.BuildPromptContext(contextJson, "शेत", "G1", "Grapes");

        Assert.Null(context.CorrectionOf);
        Assert.DoesNotContain("THIS REQUEST IS A CORRECTION", Builder(modular: false).BuildVoiceParsingPrompt(context), StringComparison.Ordinal);
    }

    [Fact]
    public void A_full_context_is_read_exactly_as_before()
    {
        var json = $$"""{"availableCrops":[{"id":"c1","name":"Grapes","plots":[]}],"profile":{"motors":[{"id":"m1","name":"मोटर","hp":5}],"waterResources":[{"id":"w1","name":"विहीर"}],"machineries":[],"ledgerDefaults":null},"farmContext":{"selection":[{"cropId":"c1","cropName":"Grapes","selectedPlotIds":["p1"],"selectedPlotNames":["G1"]}]},"focusCategory":null,"vocabDb":null,"correctionOf":{{EthrelEntry}}}""";

        var context = ParseVoiceInputHandler.BuildPromptContext(json, "शेत", "G1", "Grapes");
        var prompt = Builder(modular: false).BuildVoiceParsingPrompt(context);

        Assert.Contains("- Motors/Pumps: [मोटर (5HP, SourceId: unknown)]", prompt, StringComparison.Ordinal);
        Assert.Contains("- Water Sources: [विहीर]", prompt, StringComparison.Ordinal);
        Assert.Contains("- Crop: Grapes | Plots: G1", prompt, StringComparison.Ordinal);
        Assert.NotNull(context.CorrectionOf);
    }

    // =====================================================================================================
    // helpers
    // =====================================================================================================

    private sealed record OrchestratorHarness(AiOrchestrator Orchestrator, FakeAiProvider Primary, FakeAiProvider Fallback, InMemoryAiJobRepository Jobs);

    private static OrchestratorHarness Harness(AiProviderType primaryType, ITranscriberProvider? transcriber = null)
    {
        var primary = new FakeAiProvider(primaryType);
        var fallback = new FakeAiProvider(primaryType == AiProviderType.Gemini ? AiProviderType.Sarvam : AiProviderType.Gemini);
        var config = Config(primaryType);
        if (transcriber is not null)
        {
            config.SetProviderTuple("Sarvam", "codemix", primaryType.ToString(), null);
        }

        var jobs = new InMemoryAiJobRepository(config);
        var orchestrator = new AiOrchestrator(
            [primary, fallback],
            transcriber is null ? [] : [transcriber],
            jobs,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            new InMemoryRawBlobStore(),
            new RecordingShramSafalRepository(),
            NullLogger<AiOrchestrator>.Instance);
        return new OrchestratorHarness(orchestrator, primary, fallback, jobs);
    }

    private static AiOrchestrator Orchestrator(IAiProvider primary, IAiProvider fallback, AiProviderType primaryType) =>
        new(
            [primary, fallback],
            [],
            new InMemoryAiJobRepository(Config(primaryType)),
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            new InMemoryRawBlobStore(),
            new RecordingShramSafalRepository(),
            NullLogger<AiOrchestrator>.Instance);

    private static AiProviderConfig Config(AiProviderType primaryType)
    {
        var config = AiProviderConfig.CreateDefault();
        config.UpdateSettings(
            modifiedByUserId: Guid.NewGuid(),
            defaultProvider: primaryType,
            fallbackEnabled: true,
            isAiProcessingDisabled: false,
            maxRetries: 2,
            circuitBreakerThreshold: 5,
            circuitBreakerResetSeconds: 60,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m);
        return config;
    }

    private static Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> Parse(OrchestratorHarness h, string key) =>
        h.Orchestrator.ParseVoiceWithFallbackAsync(Guid.NewGuid(), Guid.NewGuid(), new MemoryStream([1, 2, 3, 4]), "audio/webm", "system-prompt", key, ct: CancellationToken.None);

    private static VoiceParseCanonicalResult LowConfidence(int parts) => new()
    {
        Success = true,
        NormalizedJson = """{"dayOutcome":"WORK_RECORDED","observations":[{"textRaw":"x"}],"confidence":0.5}""",
        OverallConfidence = 0.5m,
        StructuredParts = parts,
    };

    private static AiPromptBuilder Builder(bool modular) =>
        new(new AiPromptTemplateRegistry(), Options.Create(new AiPromptOptions { UseModularPrompt = modular }));

    private static JsonObject Obj(string json) => JsonNode.Parse(json)!.AsObject();

    private static SarvamAiProvider SarvamProvider(HttpMessageHandler chat)
    {
        var options = Options.Create(new SarvamOptions
        {
            ApiSubscriptionKey = "k-test",
            SttEndpoint = "https://unit.test/stt",
            ChatEndpoint = "https://unit.test/chat",
            ChatModel = "sarvam-test",
            TimeoutSeconds = 10,
            ChatTimeoutSeconds = 10,
        });
        var factory = new StaticHttpClientFactory(new HttpClient(chat));
        return new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);
    }

    /// <summary>The Sarvam chat endpoint, faked: every part answers one row, complete, at the given confidence.</summary>
    private sealed class AnsweringChat(double confidence) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var content = JsonSerializer.Serialize(new
            {
                dayOutcome = "WORK_RECORDED",
                observations = new[] { new { noteType = "observation", textRaw = "भाग" } },
                confidence,
            });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new { choices = new[] { new { finish_reason = "stop", message = new { content } } }, usage = new { completion_tokens = 900 } }),
                    Encoding.UTF8,
                    "application/json"),
            });
        }
    }

    private sealed class SplitTranscriber(string transcript, int pieces) : ITranscriberProvider
    {
        public AiProviderType ProviderType => AiProviderType.Sarvam;

        public bool SupportsStreaming => false;

        public Task<ShramSafal.Application.Contracts.Dtos.TranscribeResult> TranscribeAsync(Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct) =>
            Task.FromResult(new ShramSafal.Application.Contracts.Dtos.TranscribeResult { Success = true, Transcript = transcript, Pieces = pieces });

        public IAsyncEnumerable<string> TranscribeStreamAsync(Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
