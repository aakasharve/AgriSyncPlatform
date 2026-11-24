// spec: voice-flow-v2-2026-11-23 - false facts off the farmer's screen, proven on a real stored answer.
//
// The answer below is the model's reply to the founder's 24 Nov test (job 23d384ea), embedded verbatim. Its flaws: an invented
// irrigation method (Flood), an invented input method (Soil), an invented labour activity (fertilizer_application), the
// tomorrow-urea task shown twice, a Latin "urea" in display text, and the raw digits "05234" in the summary.
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class VoiceFalseFactsEndToEndTests
{
    private const string Transcript =
        "आज 10 जण आली होती.\nत्यांनी 05234 चं खत दिलं.\nपानांचा शेंडा मारून घेतला.\nनेहमीप्रमाणे पाणी दिलं.\nआणि उद्या urea टाकायचा आहे.";

    private const string StoredAnswer = """
        {"_meta": {"promptVersion": "legacy-2026-02-22;hash:02624cc42b232c68", "schemaVersion": "1.0.0", "pipelineVersion": "gemini-server-v1"}, "inputs": [{"type": "fertilizer", "method": "Soil", "sourceText": "05234 चं खत दिलं", "productName": "0-52-34", "provenanceVerified": true}], "labour": [{"type": "HIRED", "count": 10, "activity": "fertilizer_application", "sourceText": "आज 10 जण आली होती", "provenanceVerified": true}], "summary": "आज 10 जण आली होती आणि त्यांनी 05234 चं खत दिलं, पानांचा शेंडा मारून घेतला आणि नेहमीप्रमाणे पाणी दिलं. उद्या युरिया टाकण्याचा बेत आहे.", "machinery": [], "confidence": 0.92, "dayOutcome": "WORK_RECORDED", "irrigation": [{"method": "Flood", "sourceText": "नेहमीप्रमाणे पाणी दिलं", "durationHours": null, "provenanceVerified": true}], "disturbance": null, "observations": [{"textRaw": "उद्या urea टाकायचा आहे", "noteType": "reminder", "sourceText": "उद्या urea टाकायचा आहे", "textCleaned": "उद्या urea टाकायचा आहे", "extractedTasks": [{"id": "task_future_fertilizer", "title": "युरिया टाकणे", "plotId": "current_plot", "status": "suggested", "dueDate": "tomorrow", "rawText": "उद्या urea टाकायचा आहे", "priority": "normal", "confidence": 92, "sourceNoteId": "obs_future_urea"}], "provenanceVerified": true}], "plannedTasks": [{"title": "युरिया टाकणे", "dueHint": "उद्या", "provenanceVerified": true}], "cropActivities": [{"title": "शेंडा मारणे", "workTypes": ["Topping"], "sourceText": "पानांचा शेंडा मारून घेतला", "provenanceVerified": true}, {"title": "सिंचन", "workTypes": ["Irrigation"], "sourceText": "नेहमीप्रमाणे पाणी दिलं", "provenanceVerified": true}], "fullTranscript": "आज 10 जण आली होती.\nत्यांनी 05234 चं खत दिलं.\nपानांचा शेंडा मारून घेतला.\nनेहमीप्रमाणे पाणी दिलं.\nआणि उद्या urea टाकायचा आहे.", "missingSegments": [], "unclearSegments": [], "activityExpenses": [], "fieldConfidences": {}, "questionsForUser": []}
        """;

    private static JsonNode Normalize(string pipelineVersion = "sarvam-server-v1") =>
        JsonNode.Parse(new AiResponseNormalizer().NormalizeVoiceJson(
            StoredAnswer, pipelineVersion: pipelineVersion, serverTranscript: Transcript))!;

    [Fact]
    public void No_method_or_activity_he_did_not_say_is_left_on_the_answer()
    {
        var root = Normalize();

        Assert.False(root["irrigation"]![0]!.AsObject().ContainsKey("method"), "Flood was never said");
        Assert.False(root["inputs"]![0]!.AsObject().ContainsKey("method"), "Soil was never said");
        Assert.False(root["labour"]![0]!.AsObject().ContainsKey("activity"), "a head count names no task");
        // What he did say is still there.
        Assert.Equal(10, root["labour"]![0]!["count"]!.GetValue<int>());
        Assert.Equal("0-52-34", root["inputs"]![0]!["productName"]!.GetValue<string>());
        Assert.Equal(2, root["cropActivities"]!.AsArray().Count);
    }

    [Fact]
    public void The_tomorrow_task_is_shown_once_in_planned_tasks_only()
    {
        var root = Normalize();

        Assert.Empty(root["observations"]![0]!["extractedTasks"]!.AsArray());
        var planned = Assert.Single(root["plannedTasks"]!.AsArray());
        Assert.Equal("युरिया टाकणे", planned!["title"]!.GetValue<string>());
    }

    [Fact]
    public void Display_text_is_Marathi_and_his_own_words_are_as_heard()
    {
        var root = Normalize();

        var note = root["observations"]![0]!;
        Assert.Equal("उद्या युरिया टाकायचा आहे", note["textCleaned"]!.GetValue<string>());
        Assert.Equal("उद्या urea टाकायचा आहे", note["textRaw"]!.GetValue<string>());
        Assert.Equal("उद्या urea टाकायचा आहे", note["sourceText"]!.GetValue<string>());
        Assert.DoesNotMatch(new Regex("[A-Za-z]"), root["summary"]!.GetValue<string>());
        Assert.Equal(Transcript, root["fullTranscript"]!.GetValue<string>());
    }

    [Fact]
    public void The_summary_carries_the_grade_not_the_speech_to_text_digits()
    {
        var summary = Normalize()["summary"]!.GetValue<string>();

        Assert.DoesNotContain("05234", summary, StringComparison.Ordinal);
        Assert.Contains("0-52-34 चं खत दिलं", summary, StringComparison.Ordinal);
        // Nothing else in the sentence changed.
        Assert.Equal(
            "आज 10 जण आली होती आणि त्यांनी 0-52-34 चं खत दिलं, पानांचा शेंडा मारून घेतला आणि नेहमीप्रमाणे पाणी दिलं. उद्या युरिया टाकण्याचा बेत आहे.",
            summary);
    }

    [Theory]
    [InlineData("sarvam-server-v1")]
    [InlineData("gemini-server-v1")]
    public void The_pipeline_version_is_the_one_passed_in_not_the_one_the_model_wrote(string pipelineVersion)
    {
        var root = Normalize(pipelineVersion);

        Assert.Equal(pipelineVersion, root["_meta"]!["pipelineVersion"]!.GetValue<string>());
    }

    // =====================================================================================================
    // Sarvam end to end: the real provider + the real orchestrator, only the network is scripted.
    // =====================================================================================================

    [Fact]
    public async Task A_Sarvam_answer_is_stamped_sarvam_server_v1_and_the_attempt_carries_the_real_model_ids()
    {
        var options = Options.Create(new SarvamOptions
        {
            ApiSubscriptionKey = "k-test",
            SttEndpoint = "https://unit.test/stt",
            SttModel = "saaras:v4",
            ChatEndpoint = "https://unit.test/chat",
            ChatModel = "sarvam-105b",
            TimeoutSeconds = 10,
            ChatTimeoutSeconds = 10,
        });
        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    choices = new[] { new { finish_reason = "stop", message = new { content = StoredAnswer } } },
                    usage = new { completion_tokens = 321 },
                }),
                Encoding.UTF8,
                "application/json"),
        });
        var factory = new StaticHttpClientFactory(new HttpClient(handler));
        var sarvam = new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);

        var jobs = new VsJobs(VsConfig.SarvamSarvam());
        var transcriber = new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words(Transcript)));
        var orchestrator = new AiOrchestrator(
            [sarvam, new VsProvider(AiProviderType.Gemini, takesVoice: false)],
            [transcriber],
            jobs,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            new VsBlobStore(),
            new RecordingShramSafalRepository(),
            NullLogger<AiOrchestrator>.Instance);

        var (result, jobId, providerUsed, fallbackUsed) = await orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream([1, 2, 3, 4]),
            "audio/webm",
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            "voice-false-facts-sarvam-e2e");

        Assert.True(result.Success, result.Error);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        Assert.False(fallbackUsed);

        var answer = JsonNode.Parse(result.NormalizedJson!)!;
        Assert.Equal("sarvam-server-v1", answer["_meta"]!["pipelineVersion"]!.GetValue<string>());
        // The guards ran on the same path: the false facts are gone.
        Assert.False(answer["irrigation"]![0]!.AsObject().ContainsKey("method"));
        Assert.Empty(answer["observations"]![0]!["extractedTasks"]!.AsArray());
        Assert.DoesNotContain("05234", answer["summary"]!.GetValue<string>(), StringComparison.Ordinal);

        var job = (await jobs.GetByIdAsync(jobId))!;
        var attempt = Assert.Single(job.Attempts, a => a.IsSuccess);
        Assert.NotEqual("unknown", attempt.Provenance.ModelVersion);
        Assert.Equal("saaras:v4+sarvam-105b", attempt.Provenance.ModelVersion);
        Assert.Contains("sarvam-server-v1", attempt.RawProviderResponse, StringComparison.Ordinal);
    }
}
