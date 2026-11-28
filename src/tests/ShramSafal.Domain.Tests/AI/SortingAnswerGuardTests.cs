// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (CTO scope add, 28 Nov 2026, after the 20-sample test).
//
// Two silent-loss bugs and one enforcement, each asserted by what comes out of the pipeline, not by a bare throw:
//   1. An answer that is not valid JSON (live: a stray `- "femaleCount": 3` line) or is empty was saved as an EMPTY successful
//      WORK_RECORDED day. It is now a failed call: one retry, then the backup sorter; if that fails too the note is kept
//      for later (the unheard-voice path), never a day.
//   2. A key repeated with a different value kept the LAST one (live: Sarvam "inputs":[2 products] then "inputs":[]), so the
//      saved log had no products and the call still reported success. Now a failed call, handled the same way; a key
//      repeated with the same value is collapsed. Both are logged with the provider name.
//   3. Gemini gets an enforced response schema for the sorting call (the skeleton; rows stay open).
// Fakes only: a stub HTTP wire for Gemini and for the Sarvam chat endpoint, scripted fakes elsewhere. No network, no database.
using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Gemini;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class SortingAnswerGuardTests
{
    // The sorting prompt asks for a dayOutcome; the verification prompt asks for a score and no day.
    private const string SortingPrompt = """Sort the transcript. Output: {"dayOutcome":"WORK_RECORDED","labour":[],"inputs":[]}""";
    private const string VerificationPrompt = """Judge the parse. Reply with ONE JSON object: {"confidence": 0.5, "summary": "x"}""";

    private const string GoodLabourAnswer =
        """{"dayOutcome":"WORK_RECORDED","labour":[{"maleCount":4,"femaleCount":3,"gender":"mixed"}],"confidence":0.9}""";

    // The live 3.5 Flash-Lite case: a stray line inside the array, so the whole answer is not JSON and the labour was lost.
    private const string StrayLineAnswer = """
        {"dayOutcome":"WORK_RECORDED","labour":[{"maleCount":4}
        - "femaleCount": 3
        ]}
        """;

    private const string TruncatedAnswer = """{"dayOutcome":"WORK_RECORDED","labour":[{"maleCount":4""";

    // The live Sarvam case: two products, then the same key again, empty.
    private const string TwoProductsThenEmptyInputs =
        """{"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","dosePerLitre":4,"doseUnit":"ml"},{"productName":"Dormex","quantity":1,"unit":"L"}],"labour":[],"inputs":[]}""";

    private const string SameInputsTwice =
        """{"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","dosePerLitre":4,"doseUnit":"ml"}],"inputs":[{"productName":"Ethrel","dosePerLitre":4,"doseUnit":"ml"}]}""";

    // ----------------------------------------------------------------------------------------------------- fakes

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public ConcurrentQueue<string> Lines { get; } = new();

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Enqueue($"{logLevel}: {formatter(state, exception)}");

        public string[] Matching(string text) => Lines.Where(l => l.Contains(text, StringComparison.Ordinal)).ToArray();
    }

    private static string GeminiBody(string answerText) =>
        JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = answerText } } }, finishReason = "STOP" } },
        });

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    /// <summary>The real Gemini adapter on a stub wire: records every request, answers call n with <paramref name="answer"/>(n).</summary>
    private sealed class GeminiWire
    {
        private int _calls;

        public GeminiWire(Func<int, string> answer, GeminiOptions? options = null)
        {
            options ??= new GeminiOptions { ApiKey = "test-key", BaseUrl = "https://unit.test", TimeoutSeconds = 5 };
            var handler = new StubHttpMessageHandler(request =>
            {
                Requests.Enqueue(request.Content!.ReadAsStringAsync().GetAwaiter().GetResult());
                return Json(GeminiBody(answer(Interlocked.Increment(ref _calls))));
            });
            Provider = new GeminiAiProvider(
                Microsoft.Extensions.Options.Options.Create(options),
                new StaticHttpClientFactory(new HttpClient(handler) { BaseAddress = new Uri("https://unit.test") }),
                new AiResponseNormalizer(),
                Log,
                new ThrowingAdminDbContextFactory());
        }

        public CapturingLogger<GeminiAiProvider> Log { get; } = new();

        public GeminiAiProvider Provider { get; }

        public ConcurrentQueue<string> Requests { get; } = new();

        public int Calls => Volatile.Read(ref _calls);

        public Task<VoiceParseCanonicalResult> SortAsync(string prompt = SortingPrompt, string transcript = "आज चार पुरुष आणि तीन महिला कामाला होत्या.") =>
            Provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "mr-IN", prompt, CancellationToken.None);
    }

    /// <summary>The real Sarvam adapter on a stub chat endpoint: answers call n with <paramref name="answer"/>(n).</summary>
    private sealed class SarvamWire
    {
        private int _calls;

        public SarvamWire(Func<int, string> answer)
        {
            var handler = new StubHttpMessageHandler(_ => Json(JsonSerializer.Serialize(new
            {
                choices = new[] { new { message = new { role = "assistant", content = answer(Interlocked.Increment(ref _calls)) }, finish_reason = "stop" } },
                usage = new { prompt_tokens = 10, completion_tokens = 5, total_tokens = 15 },
            })));
            var options = Microsoft.Extensions.Options.Options.Create(new SarvamOptions
            {
                ApiSubscriptionKey = "test-key",
                ChatEndpoint = "https://unit.test/v1/chat/completions",
                ChatTimeoutSeconds = 5,
            });
            var factory = new StaticHttpClientFactory(new HttpClient(handler));
            Provider = new SarvamAiProvider(
                new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
                new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
                new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
                options,
                new AiResponseNormalizer(),
                Log);
        }

        public CapturingLogger<SarvamAiProvider> Log { get; } = new();

        public SarvamAiProvider Provider { get; }

        public int Calls => Volatile.Read(ref _calls);

        public Task<VoiceParseCanonicalResult> SortAsync(string prompt = SortingPrompt) =>
            Provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes("आज चार पुरुष आणि तीन महिला कामाला होत्या.")), "text/plain", "mr-IN", prompt, CancellationToken.None);
    }

    private static JsonArray LabourOf(VoiceParseCanonicalResult result) =>
        JsonNode.Parse(result.NormalizedJson!)!.AsObject()["labour"]!.AsArray();

    // =========================================================================================== bug 1: a broken answer

    [Theory]
    [InlineData(StrayLineAnswer)]
    [InlineData(TruncatedAnswer)]
    [InlineData("I could not sort this transcript.")]
    public async Task Gemini_AnAnswerThatIsNotJson_IsAFailedCall_AfterOneRetry_NeverAnEmptyWorkDay(string broken)
    {
        var wire = new GeminiWire(_ => broken);

        var result = await wire.SortAsync();

        Assert.False(result.Success);
        Assert.Null(result.NormalizedJson); // no day of any kind came out
        Assert.Equal(2, wire.Calls); // the call and its one retry
        var classifier = new AiFailureClassifier();
        var failureClass = classifier.ClassifyProviderError(result.Error);
        Assert.Equal(AiFailureClass.ParseFailure, failureClass);
        Assert.True(classifier.IsFallbackEligible(failureClass)); // so the backup sorter runs next
        Assert.Contains(wire.Log.Matching("[answer-check] provider=Gemini"), l => l.Contains("problem=Unparseable", StringComparison.Ordinal) || l.Contains("problem=Empty", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Gemini_ABrokenFirstAnswer_IsRecoveredByTheRetry_WithTheLabourIntact()
    {
        var wire = new GeminiWire(call => call == 1 ? StrayLineAnswer : GoodLabourAnswer);

        var result = await wire.SortAsync();

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, wire.Calls);
        Assert.Single(LabourOf(result)); // the labour the stray line used to cost
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"summary":"","labour":[],"inputs":[]}""")] // names no day outcome and holds no work
    [InlineData("""{"dayOutcome":"","irrigation":[]}""")]
    public async Task Gemini_AnEmptyAnswer_WithNoDayOutcome_IsAFailedCall_NotAWorkDay(string empty)
    {
        var wire = new GeminiWire(_ => empty);

        var result = await wire.SortAsync();

        Assert.False(result.Success);
        Assert.Null(result.NormalizedJson);
        Assert.Equal(2, wire.Calls);
    }

    [Fact]
    public async Task Gemini_AStatedDayOutcome_IsNeverSecondGuessed_EvenOnAnEmptyDay()
    {
        // A farmer who says nothing happened is a real answer: dayOutcome says so and the day stays that day.
        var wire = new GeminiWire(_ => """{"dayOutcome":"NO_WORK_PLANNED","summary":"","labour":[],"inputs":[]}""");

        var result = await wire.SortAsync();

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, wire.Calls);
        Assert.Equal("NO_WORK_PLANNED", JsonNode.Parse(result.NormalizedJson!)!["dayOutcome"]!.GetValue<string>());
    }

    [Fact]
    public async Task TheVerificationAnswer_WhichHasNoDayOutcome_StillWorks()
    {
        var wire = new GeminiWire(_ => """{"confidence":0.8,"summary":"mostly supported"}""");

        var result = await wire.SortAsync(VerificationPrompt);

        Assert.True(result.Success, result.Error);
        Assert.Equal(0.8m, result.OverallConfidence);
    }

    [Fact]
    public async Task Sarvam_AnAnswerThatIsNotJson_IsAFailedCall_AfterOneRetry_NeverAnEmptyWorkDay()
    {
        var wire = new SarvamWire(_ => StrayLineAnswer);

        var result = await wire.SortAsync();

        Assert.False(result.Success);
        Assert.Null(result.NormalizedJson);
        Assert.Equal(2, wire.Calls);
        Assert.NotEmpty(wire.Log.Matching("[answer-check] provider=Sarvam"));
    }

    // =========================================================================================== bug 2: repeated keys

    [Fact]
    public async Task Gemini_AKeyRepeatedWithADifferentValue_IsAFailedCall_NotTheLastValue()
    {
        var wire = new GeminiWire(_ => TwoProductsThenEmptyInputs);

        var result = await wire.SortAsync();

        Assert.False(result.Success);
        Assert.Null(result.NormalizedJson);
        Assert.Equal(2, wire.Calls);
        var line = Assert.Single(wire.Log.Matching("problem=ConflictingDuplicateKeys").Where(l => l.StartsWith("Warning", StringComparison.Ordinal)).Take(1));
        Assert.Contains("provider=Gemini", line, StringComparison.Ordinal);
        Assert.Contains("$.inputs", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sarvam_TheLiveCase_TwoProductsThenAnEmptyInputsList_IsAFailedCall_NotASaveWithNoProducts()
    {
        var wire = new SarvamWire(_ => TwoProductsThenEmptyInputs);

        var result = await wire.SortAsync();

        Assert.False(result.Success);
        Assert.Null(result.NormalizedJson); // the products are not "saved as none"
        Assert.Equal(2, wire.Calls); // the call and its one retry
        var line = Assert.Single(wire.Log.Matching("problem=ConflictingDuplicateKeys").Take(1));
        Assert.Contains("provider=Sarvam", line, StringComparison.Ordinal);
        Assert.Contains("$.inputs", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sarvam_ARepeatedKeyThatWasRight_OnTheRetry_KeepsBothProducts()
    {
        var good = TwoProductsThenEmptyInputs.Replace(""","inputs":[]}""", "}", StringComparison.Ordinal);
        var wire = new SarvamWire(call => call == 1 ? TwoProductsThenEmptyInputs : good);

        var result = await wire.SortAsync();

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, wire.Calls);
        Assert.Equal(2, JsonNode.Parse(result.NormalizedJson!)!["inputs"]!.AsArray().Count);
    }

    [Theory]
    [InlineData("Gemini")]
    [InlineData("Sarvam")]
    public async Task AKeyRepeatedWithTheSameValue_IsCollapsedSilently_TheAnswerIsKept_AndLogged(string provider)
    {
        VoiceParseCanonicalResult result;
        string[] logged;
        int calls;
        if (provider == "Gemini")
        {
            var wire = new GeminiWire(_ => SameInputsTwice);
            result = await wire.SortAsync();
            logged = wire.Log.Matching("problem=IdenticalRepeatedKeys");
            calls = wire.Calls;
        }
        else
        {
            var wire = new SarvamWire(_ => SameInputsTwice);
            result = await wire.SortAsync();
            logged = wire.Log.Matching("problem=IdenticalRepeatedKeys");
            calls = wire.Calls;
        }

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, calls); // no retry: nothing was wrong with the content
        Assert.Single(JsonNode.Parse(result.NormalizedJson!)!["inputs"]!.AsArray());
        var line = Assert.Single(logged);
        Assert.Contains($"provider={provider}", line, StringComparison.Ordinal);
    }

    // =========================================================================================== enforced response schema

    [Fact]
    public async Task Gemini_SendsAnEnforcedResponseSchema_ForTheSortingCall_WithOpenRows()
    {
        var wire = new GeminiWire(_ => GoodLabourAnswer);

        var result = await wire.SortAsync();

        Assert.True(result.Success, result.Error);
        using var doc = JsonDocument.Parse(Assert.Single(wire.Requests));
        var config = doc.RootElement.GetProperty("generationConfig");
        Assert.Equal("application/json", config.GetProperty("responseMimeType").GetString());
        var schema = config.GetProperty("responseJsonSchema");

        Assert.Equal("object", schema.GetProperty("type").GetString());
        Assert.Equal(["dayOutcome"], schema.GetProperty("required").EnumerateArray().Select(e => e.GetString()!).ToArray());
        Assert.True(schema.GetProperty("additionalProperties").GetBoolean()); // keys not named here stay free

        var properties = schema.GetProperty("properties");
        Assert.Equal(
            AiResponseNormalizer.AllowedDayOutcomes.Order(StringComparer.Ordinal).ToArray(),
            properties.GetProperty("dayOutcome").GetProperty("enum").EnumerateArray().Select(e => e.GetString()!).ToArray());

        foreach (var bucket in new[] { "cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses", "observations", "plannedTasks" })
        {
            var rows = properties.GetProperty(bucket);
            Assert.Equal("array", rows.GetProperty("type").GetString());
            var item = rows.GetProperty("items");
            Assert.Equal("object", item.GetProperty("type").GetString());
            // OPEN rows: a field the prompt asks for (mixId, carrierVolume, sourceText...) is never dropped for want of a name here.
            Assert.True(item.GetProperty("additionalProperties").GetBoolean());
            Assert.False(item.TryGetProperty("properties", out _));
        }
    }

    [Fact]
    public async Task Gemini_SendsNoSchema_ForThePromptThatDoesNotAskForADay_OrWhenTheSettingIsOff()
    {
        var verification = new GeminiWire(_ => """{"confidence":0.8,"summary":"ok"}""");
        await verification.SortAsync(VerificationPrompt);
        using (var doc = JsonDocument.Parse(Assert.Single(verification.Requests)))
        {
            Assert.False(doc.RootElement.GetProperty("generationConfig").TryGetProperty("responseJsonSchema", out _));
        }

        var off = new GeminiWire(
            _ => GoodLabourAnswer,
            new GeminiOptions { ApiKey = "test-key", BaseUrl = "https://unit.test", TimeoutSeconds = 5, StructurerResponseSchema = false });
        var result = await off.SortAsync();
        Assert.True(result.Success, result.Error);
        using var offDoc = JsonDocument.Parse(Assert.Single(off.Requests));
        var config = offDoc.RootElement.GetProperty("generationConfig");
        Assert.False(config.TryGetProperty("responseJsonSchema", out _));
        Assert.Equal("application/json", config.GetProperty("responseMimeType").GetString()); // JSON mode stays
    }

    [Fact]
    public void TheShippedSchemaFlag_DefaultsToOn()
    {
        Assert.True(new GeminiOptions().StructurerResponseSchema);
    }

    // =========================================================================================== whole pipeline

    private static VoiceStructurerOptions Pilot() => new() { Provider = "Gemini", Fallback = "Sarvam" };

    private static (AiOrchestrator Orchestrator, VsJobs Jobs) Pipeline(IAiProvider gemini, IAiProvider sarvam, string transcript)
    {
        var log = new VsLog();
        var jobs = new VsJobs(VsConfig.SarvamSarvam(), log);
        var orchestrator = new AiOrchestrator(
            [sarvam, gemini],
            [new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words(transcript)), log)],
            jobs,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            new VsBlobStore(log: log),
            new RecordingShramSafalRepository(),
            NullLogger<AiOrchestrator>.Instance,
            Microsoft.Extensions.Options.Options.Create(Pilot()));
        return (orchestrator, jobs);
    }

    private static Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> Run(AiOrchestrator orchestrator, string key) =>
        orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream([1, 2, 3, 4]),
            "audio/webm",
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            key);

    [Fact]
    public async Task WholePipeline_ABrokenFirstAnswer_EndsInTheBackupSortersResult_NotAnEmptyDay()
    {
        const string heard = "आज चार पुरुष आणि तीन महिलांनी मातीची भर घातली.";
        var gemini = new GeminiWire(_ => StrayLineAnswer); // broken on the call and on its retry
        var sarvam = new VsProvider(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(
            VsProvider.GoodAnswer() with { NormalizedJson = GoodLabourAnswer, ModelUsed = "saaras:v4+sarvam-105b-conversations" }));
        var (orchestrator, jobs) = Pipeline(gemini.Provider, sarvam, heard);

        var (result, jobId, providerUsed, fallbackUsed) = await Run(orchestrator, "guard-pipeline-1");

        Assert.True(result.Success, result.Error);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        Assert.True(fallbackUsed);
        Assert.Equal(2, gemini.Calls); // the call and its one retry, and no more
        var call = Assert.Single(sarvam.Calls); // the backup sorted the same words, once, as text
        Assert.Equal("text/plain", call.Mime);
        Assert.Equal(heard, call.Text);
        // The result is the backup's real day, with the labour in it: not an empty WORK_RECORDED day.
        Assert.Single(LabourOf(result));
        Assert.Equal("Sarvam", result.StageTimings!.StructProvider);
        Assert.True(result.StageTimings.StructFallbackUsed);
        Assert.Equal(AiJobStatus.FallbackSucceeded, (await jobs.GetByIdAsync(jobId))!.Status);
    }

    [Fact]
    public async Task WholePipeline_ABrokenFirstAnswer_RecoveredByTheRetry_NeverReachesTheBackup()
    {
        var gemini = new GeminiWire(call => call == 1 ? StrayLineAnswer : GoodLabourAnswer);
        var sarvam = new VsProvider(AiProviderType.Sarvam);
        var (orchestrator, _) = Pipeline(gemini.Provider, sarvam, "आज चार पुरुष आणि तीन महिला.");

        var (result, _, providerUsed, fallbackUsed) = await Run(orchestrator, "guard-pipeline-2");

        Assert.True(result.Success, result.Error);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.False(fallbackUsed);
        Assert.Equal(2, gemini.Calls);
        Assert.Empty(sarvam.Calls);
        Assert.Single(LabourOf(result));
    }

    [Fact]
    public async Task WholePipeline_WhenEveryAnswerIsBroken_TheNoteIsKeptForLater_NotSavedAsAnEmptyDay()
    {
        // Gemini: not JSON, twice. Sarvam (the real adapter): the live duplicate-key case, twice. Nothing can be trusted.
        var gemini = new GeminiWire(_ => StrayLineAnswer);
        var sarvam = new SarvamWire(_ => TwoProductsThenEmptyInputs);
        var (orchestrator, jobs) = Pipeline(gemini.Provider, sarvam.Provider, "आज इथरेल आणि डॉरमेक्स मारले.");

        var (result, jobId, _, _) = await Run(orchestrator, "guard-pipeline-3");

        Assert.False(result.Success); // never a successful day
        Assert.Null(result.NormalizedJson); // and no day of any kind to save
        Assert.True(result.Retryable); // the endpoint answers 503, the phone keeps the note and sends it again (the unheard-voice path)
        Assert.Equal("आज इथरेल आणि डॉरमेक्स मारले.", result.TranscriptCodemix); // his words stay on the job
        Assert.Equal(2, gemini.Calls);
        Assert.Equal(2, sarvam.Calls);
        Assert.Equal(AiJobStatus.Failed, (await jobs.GetByIdAsync(jobId))!.Status);
        // The reason is the kind of failure the phone treats as "the AI failed this time" (HTTP 400 + AiParsingFailed / 503).
        Assert.Contains("parse failure", result.Error, StringComparison.Ordinal);
        Assert.NotEmpty(sarvam.Log.Matching("[answer-check] provider=Sarvam"));
        Assert.NotEmpty(gemini.Log.Matching("[answer-check] provider=Gemini"));
    }
}
