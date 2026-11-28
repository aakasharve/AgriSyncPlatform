// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (founder's sorting-model decision, 28 Nov 2026).
//
// The SORTING step (Marathi transcript text -> structured log JSON) moves to Google gemini-3.5-flash-lite for the pilot.
// Speech-to-text stays on Sarvam Saaras and Gemini NEVER receives a recording (the 23 Nov order, which this decision does
// not reverse for audio). Fakes only: a stub HTTP handler for the Gemini wire, scripted providers for the orchestrator.
// No real Gemini or Sarvam call, no network, no database.
using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Gemini;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class SortingModelGeminiTests
{
    // ---------------------------------------------------------------------------------------------- the Gemini wire

    private const string AnswerJson =
        """{"summary":"ok","dayOutcome":"WORK_RECORDED","cropActivities":[],"irrigation":[],"labour":[],"inputs":[],"machinery":[],"activityExpenses":[],"observations":[],"plannedTasks":[],"missingSegments":[],"unclearSegments":[],"questionsForUser":[],"fieldConfidences":{},"confidence":0.9,"fullTranscript":"x"}""";

    private static string GeminiBody(string answerText, string finishReason = "STOP") =>
        JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = answerText } } }, finishReason } },
            usageMetadata = new { promptTokenCount = 1200, cachedContentTokenCount = 1000, candidatesTokenCount = 300, thoughtsTokenCount = 0 },
        });

    private static HttpResponseMessage Ok(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    /// <summary>A Gemini provider on a stub wire that records every request and answers from <paramref name="respond"/>.</summary>
    private sealed class Wire
    {
        private int _calls;

        public Wire(Func<int, HttpResponseMessage> respond, GeminiOptions? options = null)
        {
            Options = options ?? new GeminiOptions { ApiKey = "test-key", BaseUrl = "https://unit.test", TimeoutSeconds = 5 };
            var handler = new StubHttpMessageHandler(request =>
            {
                var body = request.Content is null ? string.Empty : request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                Requests.Enqueue((request.RequestUri!.ToString(), body));
                return respond(Interlocked.Increment(ref _calls));
            });
            Provider = new GeminiAiProvider(
                Microsoft.Extensions.Options.Options.Create(Options),
                new StaticHttpClientFactory(new HttpClient(handler) { BaseAddress = new Uri("https://unit.test") }),
                new AiResponseNormalizer(),
                NullLogger<GeminiAiProvider>.Instance,
                new ThrowingAdminDbContextFactory());
        }

        public GeminiOptions Options { get; }

        public GeminiAiProvider Provider { get; }

        public ConcurrentQueue<(string Url, string Body)> Requests { get; } = new();

        public int Calls => Volatile.Read(ref _calls);

        public Task<VoiceParseCanonicalResult> SortAsync(string transcript, string prompt = "system-prompt") =>
            Provider.ParseVoiceAsync(
                new MemoryStream(Encoding.UTF8.GetBytes(transcript)),
                "text/plain",
                "mr-IN",
                prompt,
                CancellationToken.None);
    }

    /// <summary>About 90 seconds of Marathi speech: 30 sentences, ~600 estimated tokens (the old 4,096-token plan cut ~190).</summary>
    private static string NinetySecondTranscript()
    {
        string[] sentences =
        [
            "आज सकाळी सहा वाजता द्राक्षाच्या बागेत फवारणी केली.",
            "पंधरा मजूर होते आणि चार तास काम चाललं.",
            "टाकीत दोनशे लिटर पाणी घेतलं होतं.",
            "त्यात पंचवीस ग्रॅम औषध मिसळलं.",
            "नंतर दुपारी ठिबकने दोन तास पाणी सोडलं.",
            "संध्याकाळी बागेत फेरफटका मारला आणि पानं पाहिली.",
        ];
        var text = new StringBuilder();
        for (var i = 0; i < 30; i++)
        {
            text.Append(sentences[i % sentences.Length]).Append(' ');
        }

        return text.ToString().Trim();
    }

    [Fact]
    public void Gemini_MaySortTranscripts_ButCanNeverHandleARecording()
    {
        var provider = new Wire(_ => Ok(GeminiBody(AnswerJson))).Provider;

        // The audio question stays false (the 23 Nov order); the transcript question is the new, separate one.
        Assert.False(provider.CanHandle(AiOperationType.VoiceToStructuredLog));
        Assert.True(provider.CanStructureTranscript(AiOperationType.VoiceToStructuredLog));
        Assert.True(provider.CanHandle(AiOperationType.ReceiptToExpenseItems));
        Assert.True(provider.CanHandle(AiOperationType.PattiImageToSaleData));
    }

    [Theory]
    [InlineData("audio/webm")]
    [InlineData("audio/webm;codecs=opus")]
    [InlineData("audio/wav")]
    [InlineData("audio/mp4")]
    [InlineData("application/octet-stream")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Gemini_RefusesAnythingButText_BeforeASingleByteIsSent(string? mimeType)
    {
        var wire = new Wire(_ => Ok(GeminiBody(AnswerJson)));

        var result = await wire.Provider.ParseVoiceAsync(
            new MemoryStream([1, 2, 3, 4, 5, 6]),
            mimeType!,
            "mr-IN",
            "system-prompt",
            CancellationToken.None);

        Assert.False(result.Success);
        Assert.Equal(0, wire.Calls);
        Assert.Empty(wire.Requests);
        Assert.Equal(GeminiAiProvider.AudioRefusedError, result.Error);
        // "Unsupported input": never retried and never handed to another provider.
        Assert.Equal(AiFailureClass.UnsupportedInput, new AiFailureClassifier().ClassifyProviderError(result.Error));
    }

    [Fact]
    public async Task Gemini_SendsOnlyTheTranscriptText_ToTheConfiguredSortingModel_InJsonMode_WithThinkingOff()
    {
        var wire = new Wire(_ => Ok(GeminiBody(AnswerJson)));
        const string transcript = "आज पाच मजुरांनी द्राक्षाला पाणी दिलं.";

        var result = await wire.SortAsync(transcript, "the fixed sorting prompt");

        Assert.True(result.Success);
        Assert.Equal(GeminiOptions.DefaultStructurerModelId, result.ModelUsed);
        Assert.Equal("gemini-3.5-flash-lite", result.ModelUsed);

        var (url, body) = Assert.Single(wire.Requests);
        Assert.Contains("/models/gemini-3.5-flash-lite:generateContent", url, StringComparison.Ordinal);

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        // Only text, in one user turn: no inlineData, no audio part, no file part — anywhere in the request.
        Assert.DoesNotContain("inlineData", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("audio", body, StringComparison.OrdinalIgnoreCase);
        var userParts = root.GetProperty("contents")[0].GetProperty("parts");
        Assert.Equal(1, userParts.GetArrayLength());
        Assert.Equal(transcript, userParts[0].GetProperty("text").GetString());
        Assert.Equal(
            "the fixed sorting prompt",
            root.GetProperty("systemInstruction").GetProperty("parts")[0].GetProperty("text").GetString());

        var config = root.GetProperty("generationConfig");
        Assert.Equal("application/json", config.GetProperty("responseMimeType").GetString()); // structured-output (JSON) mode
        Assert.Equal(32_768, config.GetProperty("maxOutputTokens").GetInt32()); // within the model's 65,536 output limit
        Assert.Equal(0, config.GetProperty("thinkingConfig").GetProperty("thinkingBudget").GetInt32()); // thinking off
    }

    [Fact]
    public async Task Gemini_ThinkingAndOutputLimits_FollowTheSettings_AndStayInsideTheModelsLimits()
    {
        // A level replaces the budget; an absurd output cap is clamped to the model's 65,536.
        var level = new Wire(
            _ => Ok(GeminiBody(AnswerJson)),
            new GeminiOptions
            {
                ApiKey = "k",
                BaseUrl = "https://unit.test",
                StructurerThinkingLevel = "Low",
                StructurerMaxOutputTokens = 1_000_000,
            });
        await level.SortAsync("आज पाणी दिलं.");
        using (var doc = JsonDocument.Parse(level.Requests.Single().Body))
        {
            var config = doc.RootElement.GetProperty("generationConfig");
            Assert.Equal("low", config.GetProperty("thinkingConfig").GetProperty("thinkingLevel").GetString());
            Assert.False(config.GetProperty("thinkingConfig").TryGetProperty("thinkingBudget", out _));
            Assert.Equal(GeminiOptions.StructurerMaxOutputTokensCeiling, config.GetProperty("maxOutputTokens").GetInt32());
        }

        // A negative budget sends no thinking field at all (the model's own default).
        var unset = new Wire(
            _ => Ok(GeminiBody(AnswerJson)),
            new GeminiOptions { ApiKey = "k", BaseUrl = "https://unit.test", StructurerThinkingBudget = -1, StructurerMaxOutputTokens = 0 });
        await unset.SortAsync("आज पाणी दिलं.");
        using var doc2 = JsonDocument.Parse(unset.Requests.Single().Body);
        var config2 = doc2.RootElement.GetProperty("generationConfig");
        Assert.False(config2.TryGetProperty("thinkingConfig", out _));
        Assert.Equal(GeminiOptions.DefaultStructurerMaxOutputTokens, config2.GetProperty("maxOutputTokens").GetInt32());
    }

    [Fact]
    public async Task A_NinetySecondTranscript_IsSortedInOneGeminiCall_NotInPieces()
    {
        var transcript = NinetySecondTranscript();
        // Under the old 4,096-token answer plan this talk was cut into several blind pieces (accuracy risk D6-2).
        var oldPlanPieces = ChunkedStructuring.Segment(transcript, new StructuringBudget(4096).SegmentTokens);
        Assert.True(oldPlanPieces.Count >= 3, $"the sample must be long enough to have been split before: {oldPlanPieces.Count} pieces");

        var wire = new Wire(_ => Ok(GeminiBody(AnswerJson)));
        var result = await wire.SortAsync(transcript);

        Assert.True(result.Success);
        Assert.Equal(1, wire.Calls);
        Assert.Equal(1, result.StructuredParts);
        // And the whole talk went in that one call.
        using var doc = JsonDocument.Parse(wire.Requests.Single().Body);
        Assert.Equal(transcript, doc.RootElement.GetProperty("contents")[0].GetProperty("parts")[0].GetProperty("text").GetString());
    }

    [Fact]
    public async Task OnlyAnAnswerCutOffAtTheCap_IsSplitInHalf_AndTheSplitIsNeverSilent()
    {
        var wire = new Wire(call => call == 1
            ? Ok(GeminiBody("{\"summary\":\"cut", finishReason: "MAX_TOKENS"))
            : Ok(GeminiBody(AnswerJson)));

        var result = await wire.SortAsync(NinetySecondTranscript());

        Assert.True(result.Success);
        Assert.Equal(3, wire.Calls); // the whole talk first, then its two halves
        Assert.Equal(2, result.StructuredParts);
    }

    [Fact]
    public async Task A_5xx_GetsOneMoreTry_ThenFailsAsATransientFailure()
    {
        var wire = new Wire(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
        {
            Content = new StringContent("""{"error":{"message":"The model is overloaded."}}""", Encoding.UTF8, "application/json"),
        });

        var result = await wire.SortAsync("आज पाणी दिलं.");

        Assert.False(result.Success);
        Assert.Equal(2, wire.Calls);
        Assert.Contains("overloaded", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.True(new AiFailureClassifier().IsFallbackEligible(new AiFailureClassifier().ClassifyProviderError(result.Error)));
    }

    [Fact]
    public async Task InvalidJson_GetsOneMoreTry_And_ARecoveredAnswerIsKept()
    {
        var wire = new Wire(call => Ok(GeminiBody(call == 1 ? "this is not json" : AnswerJson)));

        var result = await wire.SortAsync("आज पाणी दिलं.");

        Assert.True(result.Success);
        Assert.Equal(2, wire.Calls);
    }

    [Fact]
    public async Task InvalidJson_AfterItsRetry_IsAParseFailure_ThatMayGoToTheBackupSorter()
    {
        var wire = new Wire(_ => Ok(GeminiBody("still not json")));

        var result = await wire.SortAsync("आज पाणी दिलं.");

        Assert.False(result.Success);
        Assert.Equal(2, wire.Calls);
        var classifier = new AiFailureClassifier();
        var failureClass = classifier.ClassifyProviderError(result.Error);
        Assert.Equal(AiFailureClass.ParseFailure, failureClass);
        Assert.True(classifier.IsFallbackEligible(failureClass));
    }

    [Fact]
    public async Task ATimeout_FailsWithoutHangingAround_AndMayGoToTheBackupSorter()
    {
        var wire = new Wire(_ => throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout of 60 seconds elapsing."));

        var result = await wire.SortAsync("आज पाणी दिलं.");

        Assert.False(result.Success);
        Assert.Equal(1, wire.Calls); // a timed-out call is not run again for another minute
        var classifier = new AiFailureClassifier();
        Assert.True(classifier.IsFallbackEligible(classifier.ClassifyProviderError(result.Error)));
    }

    // ---------------------------------------------------------------------------------------- the orchestrator's routing

    private static VoiceParseCanonicalResult GeminiAnswered(string model = "gemini-3.5-flash-lite", decimal confidence = 0.91m)
    {
        var good = VsProvider.GoodAnswer();
        return good with { ModelUsed = model, OverallConfidence = confidence };
    }

    private static VoiceParseCanonicalResult SarvamAnswered() =>
        VsProvider.GoodAnswer() with { ModelUsed = "saaras:v4+sarvam-105b-conversations" };

    private static VoiceStructurerOptions Pilot() => new() { Provider = "Gemini", Fallback = "Sarvam" };

    [Fact]
    public async Task Pilot_Gemini_SortsTheTranscriptSarvamHeard_AndNothingButText_AndSarvamIsNotCalled()
    {
        const string heard = "आज पाच मजुरांनी द्राक्षाला पाणी दिलं.";
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(GeminiAnswered()));
        var rig = VsRig.Create(
            transcriber: new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words(heard))),
            gemini: gemini,
            structurer: Pilot());

        var (result, jobId, providerUsed, fallbackUsed) = await rig.RunAsync("sort-gemini-1");

        Assert.True(result.Success);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.False(fallbackUsed);
        Assert.Equal(1, rig.Transcriber!.Calls); // speech-to-text: Sarvam's port, once
        Assert.Equal(0, rig.Sarvam.VoiceCalls); // the Sarvam sorter is not asked

        // Gemini got exactly one call, text only, carrying exactly the words Sarvam heard — never the recording.
        var call = Assert.Single(gemini.Calls);
        Assert.Equal("text/plain", call.Mime);
        Assert.Equal(heard, call.Text);

        // The server timing line names the sorting stage and the model that answered.
        Assert.NotNull(result.StageTimings);
        Assert.Equal(VoiceStageTimings.TwoStagePath, result.StageTimings!.Path);
        Assert.Equal("Gemini", result.StageTimings.StructProvider);
        Assert.Equal("gemini-3.5-flash-lite", result.StageTimings.StructModel);
        Assert.False(result.StageTimings.StructFallbackUsed);

        var job = await rig.JobAsync(jobId);
        Assert.Equal(AiJobStatus.Succeeded, job.Status);
    }

    [Theory]
    [InlineData("The operation was canceled.")] // a timeout
    [InlineData("Gemini call failed with status 503.")] // 5xx
    [InlineData("The model is overloaded.")] // 5xx with the provider's own words
    [InlineData("Gemini returned an answer that is not a JSON object (parse failure).")] // invalid JSON after its retry
    public async Task WhenGeminiFails_TheSameTranscriptIsSortedOnce_ByTheSarvamBackup_AndTheFarmerGetsAResult(string geminiError)
    {
        const string heard = "आज पाच मजुरांनी द्राक्षाला पाणी दिलं.";
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(VsProvider.Failed(geminiError)));
        var sarvam = new VsProvider(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(SarvamAnswered()));
        var rig = VsRig.Create(
            transcriber: new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words(heard))),
            sarvam: sarvam,
            gemini: gemini,
            structurer: Pilot());

        var (result, jobId, providerUsed, fallbackUsed) = await rig.RunAsync("sort-fallback-" + Math.Abs(geminiError.GetHashCode()));

        Assert.True(result.Success);
        Assert.True(fallbackUsed);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);

        // One Gemini try, one Sarvam backup: both text, both the SAME words, speech-to-text not run again.
        Assert.Equal(1, rig.Transcriber!.Calls);
        var geminiCall = Assert.Single(gemini.Calls);
        var sarvamCall = Assert.Single(sarvam.Calls);
        Assert.Equal("text/plain", geminiCall.Mime);
        Assert.Equal("text/plain", sarvamCall.Mime);
        Assert.Equal(heard, geminiCall.Text);
        Assert.Equal(heard, sarvamCall.Text);

        // Logged: which one answered.
        Assert.Equal("Sarvam", result.StageTimings!.StructProvider);
        Assert.Equal("saaras:v4+sarvam-105b-conversations", result.StageTimings.StructModel);
        Assert.True(result.StageTimings.StructFallbackUsed);

        var job = await rig.JobAsync(jobId);
        Assert.Equal(AiJobStatus.FallbackSucceeded, job.Status);
        Assert.Equal(2, job.TotalAttempts);
    }

    [Fact]
    public async Task WhenBothSortersFail_TheFarmerIsToldToTryAgain_AndTheRecordingAndWordsStayOnTheJob()
    {
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(VsProvider.Failed("Gemini call failed with status 503.")));
        var sarvam = new VsProvider(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(VsProvider.Failed("Sarvam chat call failed with status 503.")));
        var rig = VsRig.Create(sarvam: sarvam, gemini: gemini, structurer: Pilot());

        var (result, jobId, _, _) = await rig.RunAsync("sort-both-fail");

        Assert.False(result.Success);
        Assert.True(result.Retryable);
        Assert.Equal(VsTranscriber.DefaultTranscript, result.TranscriptCodemix);
        Assert.Single(gemini.Calls);
        Assert.Single(sarvam.Calls); // the backup is tried ONCE, never in a loop
        Assert.Equal(AiJobStatus.Failed, (await rig.JobAsync(jobId)).Status);
    }

    [Fact]
    public async Task AnUnsureAnswerFromGemini_IsKeptWithItsLowConfidenceMarks_NotHandedToTheBackup()
    {
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(GeminiAnswered(confidence: 0.30m)));
        var sarvam = new VsProvider(AiProviderType.Sarvam);
        var rig = VsRig.Create(sarvam: sarvam, gemini: gemini, structurer: Pilot());

        var (result, _, providerUsed, fallbackUsed) = await rig.RunAsync("sort-unsure");

        Assert.True(result.Success);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.False(fallbackUsed);
        Assert.Empty(sarvam.Calls);
    }

    [Fact]
    public async Task AFailureThatIsTheInputsFault_IsNotHandedOnToTheBackup()
    {
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(VsProvider.Failed(GeminiAiProvider.AudioRefusedError)));
        var sarvam = new VsProvider(AiProviderType.Sarvam);
        var rig = VsRig.Create(sarvam: sarvam, gemini: gemini, structurer: Pilot());

        var (result, _, _, _) = await rig.RunAsync("sort-input-fault");

        Assert.False(result.Success);
        Assert.Empty(sarvam.Calls);
    }

    [Fact]
    public async Task TheAdminKillSwitchForFallbacks_AlsoSwitchesOffTheBackupSorter()
    {
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(VsProvider.Failed("Gemini call failed with status 503.")));
        var sarvam = new VsProvider(AiProviderType.Sarvam);
        var rig = VsRig.Create(VsConfig.SarvamSarvam(fallbackEnabled: false), sarvam: sarvam, gemini: gemini, structurer: Pilot());

        var (result, _, _, _) = await rig.RunAsync("sort-no-fallback");

        Assert.False(result.Success);
        Assert.True(result.Retryable);
        Assert.Empty(sarvam.Calls);
    }

    [Theory]
    [InlineData("None")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("Gemini")] // the same provider as the first choice is no backup
    public async Task WithoutABackupSetting_AFailedSortingHasNoSecondSorter(string? fallback)
    {
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(VsProvider.Failed("Gemini call failed with status 503.")));
        var sarvam = new VsProvider(AiProviderType.Sarvam);
        var rig = VsRig.Create(
            sarvam: sarvam,
            gemini: gemini,
            structurer: new VoiceStructurerOptions { Provider = "Gemini", Fallback = fallback });

        var (result, _, _, _) = await rig.RunAsync("sort-no-backup-" + (fallback ?? "null"));

        Assert.False(result.Success);
        Assert.Empty(sarvam.Calls);
    }

    [Fact]
    public async Task WithNoStructurerSetting_TheDatabaseRowDecides_AsBeforeThisDecision()
    {
        // The row every environment holds today is Sarvam / Sarvam: with no Ai:Structurer setting Sarvam sorts, Gemini is not asked.
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true);
        var rig = VsRig.Create(gemini: gemini, structurer: null);

        var (result, _, providerUsed, _) = await rig.RunAsync("sort-db-row");

        Assert.True(result.Success);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        Assert.Single(rig.Sarvam.Calls);
        Assert.Empty(gemini.Calls);
    }

    [Fact]
    public async Task TheSettingBeatsTheDatabaseRow_SoTheRollbackIsASettingsChange()
    {
        // The row says Gemini; the setting says Sarvam (with Gemini as the text-only backup): the setting decides.
        var config = VsConfig.SarvamSarvam();
        config.SetProviderTuple("Sarvam", "codemix", "Gemini", null);
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(GeminiAnswered()));
        var sarvam = new VsProvider(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(VsProvider.Failed("Sarvam chat call failed with status 503.")));
        var rig = VsRig.Create(
            config,
            sarvam: sarvam,
            gemini: gemini,
            structurer: new VoiceStructurerOptions { Provider = "Sarvam", Fallback = "Gemini" });

        var (result, _, providerUsed, fallbackUsed) = await rig.RunAsync("sort-rollback");

        Assert.Single(sarvam.Calls); // the setting's first choice ran first, not the row's Gemini
        Assert.True(result.Success);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.True(fallbackUsed);
        Assert.All(gemini.Calls, c => Assert.Equal("text/plain", c.Mime));
    }

    [Fact]
    public async Task ARecordingIsNeverHandedToGemini_OnAnyPath()
    {
        // Path 1: speech-to-text fails and nothing else can take a recording -> the job fails visibly; Gemini is not asked.
        var gemini1 = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true);
        var failedStt = new VsTranscriber((_, _, _) => Task.FromResult(new TranscribeResult { Success = false, Transcript = string.Empty, Pieces = 1, Error = "empty" }));
        var rig1 = VsRig.Create(transcriber: failedStt, gemini: gemini1, structurer: Pilot());
        var (result1, _, _, _) = await rig1.RunAsync("never-audio-1");
        Assert.False(result1.Success);
        Assert.Empty(gemini1.Calls);

        // Path 2: no transcriber registered -> the one-call path with the recording goes to Sarvam, never Gemini.
        var gemini2 = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true);
        var rig2 = VsRig.Create(registerTranscriber: false, gemini: gemini2, structurer: Pilot());
        var (result2, _, providerUsed2, _) = await rig2.RunAsync("never-audio-2");
        Assert.True(result2.Success);
        Assert.Equal(AiProviderType.Sarvam, providerUsed2);
        Assert.Empty(gemini2.Calls);

        // Path 3: an admin names Gemini as the VOICE provider -> it still cannot take a recording; Sarvam does.
        var config = VsConfig.SarvamSarvam();
        config.UpdateSettings(
            Guid.NewGuid(), AiProviderType.Gemini, true, false, 1, 50, 60, 0.60m, 0.50m,
            voiceProvider: AiProviderType.Gemini, receiptProvider: AiProviderType.Gemini, pattiProvider: AiProviderType.Gemini);
        var gemini3 = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true);
        var rig3 = VsRig.Create(config, registerTranscriber: false, gemini: gemini3, structurer: Pilot());
        var (result3, _, providerUsed3, _) = await rig3.RunAsync("never-audio-3");
        Assert.True(result3.Success);
        Assert.Equal(AiProviderType.Sarvam, providerUsed3);
        Assert.Empty(gemini3.Calls);
    }

    [Fact]
    public async Task TypedText_IsSortedByTheSameChosenSorter_AndNothingIsTranscribed()
    {
        const string typed = "आज पाच मजुरांनी द्राक्षाला पाणी दिलं.";
        var gemini = new VsProvider(AiProviderType.Gemini, takesVoice: false, structuresText: true, answer: (_, _) => Task.FromResult(GeminiAnswered()));
        var rig = VsRig.Create(gemini: gemini, structurer: Pilot());

        var (result, _, providerUsed, _) = await rig.Orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream(Encoding.UTF8.GetBytes(typed)),
            "text/plain",
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            "sort-typed-text");

        Assert.True(result.Success);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.Equal(0, rig.Transcriber!.Calls);
        var call = Assert.Single(gemini.Calls);
        Assert.Equal("text/plain", call.Mime);
        Assert.Equal(typed, call.Text);
        Assert.Empty(rig.Sarvam.Calls);
    }

    [Fact]
    public async Task EndToEnd_A_NinetySecondTalk_GoesThroughTheRealGeminiAdapter_AsOneCall_AndTheTimingLineNamesTheModel()
    {
        var transcript = NinetySecondTranscript();
        var wire = new Wire(_ => Ok(GeminiBody(AnswerJson)));
        var log = new VsLog();
        var jobs = new VsJobs(VsConfig.SarvamSarvam(), log);
        var transcriber = new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words(transcript, pieces: 4)), log);
        var orchestrator = new AiOrchestrator(
            [new VsProvider(AiProviderType.Sarvam), wire.Provider],
            [transcriber],
            jobs,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            new VsBlobStore(log: log),
            new RecordingShramSafalRepository(),
            NullLogger<AiOrchestrator>.Instance,
            Microsoft.Extensions.Options.Options.Create(Pilot()));

        var (result, _, providerUsed, fallbackUsed) = await orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream([1, 2, 3, 4]),
            "audio/webm",
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            "sort-e2e-90s");

        Assert.True(result.Success);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.False(fallbackUsed);
        Assert.Equal(1, wire.Calls); // one Gemini call for the whole talk
        Assert.DoesNotContain("inlineData", wire.Requests.Single().Body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Gemini", result.StageTimings!.StructProvider);
        Assert.Equal("gemini-3.5-flash-lite", result.StageTimings.StructModel);
    }

    // ------------------------------------------------------------------------------------------------ the setting itself

    [Theory]
    [InlineData("Gemini", "Sarvam", "Sarvam", AiProviderType.Gemini, AiProviderType.Sarvam)]
    [InlineData("gemini", "SARVAM", "Gemini", AiProviderType.Gemini, AiProviderType.Sarvam)]
    [InlineData("", "Sarvam", "Sarvam", AiProviderType.Sarvam, null)] // no setting: the row decides; the backup is the same provider
    [InlineData(null, null, "Gemini", AiProviderType.Gemini, null)]
    [InlineData("NotAProvider", "NotAProvider", "Sarvam", AiProviderType.Sarvam, null)] // unreadable setting: the row decides
    [InlineData("Sarvam", "None", "Gemini", AiProviderType.Sarvam, null)]
    public void TheStructurerSetting_ResolvesTheSorterAndItsBackup(
        string? provider, string? fallback, string databaseRow, AiProviderType expectedProvider, AiProviderType? expectedFallback)
    {
        var options = new VoiceStructurerOptions { Provider = provider, Fallback = fallback };

        var sorter = options.ResolveProvider(databaseRow, AiProviderType.Gemini);

        Assert.Equal(expectedProvider, sorter);
        Assert.Equal(expectedFallback, options.ResolveFallback(sorter));
    }
}
