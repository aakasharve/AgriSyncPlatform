using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR lanes V-1 + AI-2 (AgriLogParser v3.8).
///
/// V-1 — the structurer's answer must fit a 10-minute recording: the server fills <c>fullTranscript</c> itself (the
/// model no longer repeats the transcript), and the chat call sends an explicit <c>max_tokens</c>.
///
/// AI-2 (register F71) — a "बदला" correction said as "X नाही, Y" is parsed against the entry being changed: the phone
/// sends that entry inside the existing parse context (<c>correctionOf</c>), and only then does the prompt carry the
/// CORRECTION rule and its examples. No AI is called here.
/// </summary>
public sealed class PlrV1Ai2StructurerAndCorrectionTests
{
    private const string EthrelEntry =
        """{"inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","quantity":350,"unit":"ml","carrierMedium":"water","carrierVolume":400,"carrierUnit":"L"}]}""";

    // ------------------------------------------------------------------ V-1: the server fills fullTranscript

    [Fact]
    public void The_server_transcript_is_fullTranscript_even_when_the_model_does_not_repeat_it()
    {
        var normalized = new AiResponseNormalizer().NormalizeVoiceJson(
            """{"dayOutcome":"WORK_RECORDED","irrigation":[{"method":"Drip","durationHours":2,"sourceText":"दोन तास पाणी दिलं"}]}""",
            serverTranscript: "आज दोन तास पाणी दिलं");

        var root = JsonNode.Parse(normalized)!;
        Assert.Equal("आज दोन तास पाणी दिलं", root["fullTranscript"]!.GetValue<string>());
        // The provenance check now reads the server's words.
        Assert.True(root["irrigation"]![0]!["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void The_server_transcript_wins_over_a_copy_the_model_wrote()
    {
        var normalized = new AiResponseNormalizer().NormalizeVoiceJson(
            """{"fullTranscript":"आज पाणी","cropActivities":[{"title":"छाटणी","sourceText":"छाटणी केली"}]}""",
            serverTranscript: "आज पाणी दिलं आणि छाटणी केली");

        var root = JsonNode.Parse(normalized)!;
        Assert.Equal("आज पाणी दिलं आणि छाटणी केली", root["fullTranscript"]!.GetValue<string>());
        Assert.True(root["cropActivities"]![0]!["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void Without_a_server_transcript_the_models_own_transcription_stays()
    {
        // Audio sent straight to a multimodal model (the Gemini fallback): only the model heard it.
        var normalized = new AiResponseNormalizer().NormalizeVoiceJson("""{"fullTranscript":"आज पाणी दिलं"}""");

        Assert.Equal("आज पाणी दिलं", JsonNode.Parse(normalized)!["fullTranscript"]!.GetValue<string>());
    }

    [Fact]
    public async Task Sarvam_voice_parse_returns_the_transcript_in_fullTranscript_when_the_model_leaves_it_out()
    {
        var handler = new StubHttpMessageHandler(request =>
            request.RequestUri!.AbsoluteUri.Contains("/stt", StringComparison.Ordinal)
                ? Json("""{"transcript":"आज 3 तास पाणी दिलं","language_code":"mr-IN"}""")
                : Json("""{"choices":[{"finish_reason":"stop","message":{"content":"{\"dayOutcome\":\"WORK_RECORDED\",\"irrigation\":[{\"durationHours\":3,\"sourceText\":\"3 तास पाणी दिलं\"}],\"confidence\":0.9}"}}]}"""));
        var options = Options.Create(SarvamOptionsForTest());
        var factory = new StaticHttpClientFactory(new HttpClient(handler));
        var provider = new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);

        var result = await provider.ParseVoiceAsync(new MemoryStream([1, 2, 3]), "audio/webm", "mr-IN", "system", CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.Equal("आज 3 तास पाणी दिलं", JsonNode.Parse(result.NormalizedJson!)!["fullTranscript"]!.GetValue<string>());
    }

    [Fact]
    public void The_streaming_parse_answer_carries_the_server_transcript_too()
    {
        using var doc = JsonDocument.Parse("""{"dayOutcome":"WORK_RECORDED","irrigation":[]}""");

        var payload = (JsonElement)AiOrchestrator.WithServerTranscript(doc.RootElement, " आज पाणी दिलं ")!;

        Assert.Equal("आज पाणी दिलं", payload.GetProperty("fullTranscript").GetString());
        Assert.Null(AiOrchestrator.WithServerTranscript(null, "x"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Both_prompt_paths_tell_the_model_not_to_repeat_a_text_transcript(bool modular)
    {
        var prompt = Builder(modular).BuildVoiceParsingPrompt(Context());

        Assert.Contains("the server attaches", prompt, StringComparison.Ordinal);
        Assert.Contains("AUDIO input only", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("\"fullTranscript\": \"verbatim", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("keep fullTranscript exact", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("Preserve fullTranscript verbatim", prompt, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------ V-1: the answer gets an explicit budget

    [Fact]
    public async Task The_structurer_call_sends_an_explicit_max_tokens_of_4096()
    {
        string? body = null;
        var handler = new StubHttpMessageHandler(request =>
        {
            body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return Json("""{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}""");
        });
        var chat = new SarvamChatClient(Options.Create(SarvamOptionsForTest()), new StaticHttpClientFactory(new HttpClient(handler)), NullLogger<SarvamChatClient>.Instance);

        await chat.CompleteAsync("system", "user", CancellationToken.None);

        using var sent = JsonDocument.Parse(body!);
        Assert.Equal(4096, sent.RootElement.GetProperty("max_tokens").GetInt32());
        Assert.Equal("sarvam-test", sent.RootElement.GetProperty("model").GetString());
        Assert.Equal("system", sent.RootElement.GetProperty("messages")[0].GetProperty("content").GetString());
    }

    [Fact]
    public void Max_tokens_can_be_switched_off_by_configuration()
    {
        var options = SarvamOptionsForTest();
        options.ChatMaxTokens = 0;
        var chat = new SarvamChatClient(Options.Create(options), new StaticHttpClientFactory(new HttpClient()), NullLogger<SarvamChatClient>.Instance);

        Assert.False(chat.BuildRequestBody("s", "u").ContainsKey("max_tokens"));
    }

    [Fact]
    public void The_defaults_fit_a_ten_minute_recording()
    {
        var defaults = new SarvamOptions();

        Assert.Equal(4096, defaults.ChatMaxTokens);
        Assert.True(defaults.ChatTimeoutSeconds >= 120, "the structurer needs longer than 45 s for a 10-minute answer");
        Assert.Equal(45, defaults.TimeoutSeconds); // each speech-to-text piece is at most 25 s of audio
        Assert.InRange(defaults.SttMaxParallelPieces, 1, 3);
    }

    // ------------------------------------------------------------------ AI-2: the correction context

    [Fact]
    public void The_phones_context_with_correctionOf_reaches_the_prompt_context()
    {
        // The shape BackendAiClient.buildContext sends, read the way ParseVoiceInputHandler reads it.
        var json = $$"""{"availableCrops":[],"profile":{"motors":[],"waterResources":[],"machineries":[],"ledgerDefaults":null},"farmContext":{"selection":[]},"focusCategory":null,"vocabDb":null,"correctionOf":{{EthrelEntry}}}""";

        var parsed = JsonSerializer.Deserialize<VoiceParseContext>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

        Assert.NotNull(parsed.CorrectionOf);
        Assert.Equal(350, parsed.CorrectionOf!.Value.GetProperty("inputs")[0].GetProperty("quantity").GetInt32());
    }

    [Fact]
    public void An_older_phone_without_correctionOf_is_read_exactly_as_before()
    {
        var json = """{"availableCrops":[],"profile":{"motors":[],"waterResources":[],"machineries":[],"ledgerDefaults":null},"farmContext":{"selection":[]},"focusCategory":null,"vocabDb":null}""";

        var parsed = JsonSerializer.Deserialize<VoiceParseContext>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

        Assert.Null(parsed.CorrectionOf);
        Assert.Equal(string.Empty, CorrectionPromptData.BuildBlock(parsed.CorrectionOf));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_normal_parse_never_sees_the_correction_rules(bool modular)
    {
        var prompt = Builder(modular).BuildVoiceParsingPrompt(Context());

        Assert.DoesNotContain("THIS REQUEST IS A CORRECTION", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("CURRENT ENTRY", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_correction_parse_carries_the_entry_the_rule_and_the_examples_after_the_few_shots(bool modular)
    {
        using var entry = JsonDocument.Parse(EthrelEntry);
        var prompt = Builder(modular).BuildVoiceParsingPrompt(Context() with { CorrectionOf = entry.RootElement.Clone() });

        Assert.Contains("THIS REQUEST IS A CORRECTION (बदला)", prompt, StringComparison.Ordinal);
        // The entry as it is saved now, in readable Marathi (not \u escapes).
        Assert.Contains("\"rawProductName\":\"इथरेल\"", prompt, StringComparison.Ordinal);
        Assert.Contains("\"quantity\":350", prompt, StringComparison.Ordinal);
        // The rule: X नाही, Y (and its other spoken forms) replaces X with Y in the matching part.
        Assert.Contains("\"X नाही, Y\"", prompt, StringComparison.Ordinal);
        Assert.Contains("\"X नव्हतं, Y होतं\"", prompt, StringComparison.Ordinal);
        Assert.Contains("\"X ऐवजी Y\"", prompt, StringComparison.Ordinal);
        Assert.Contains("X is replaced by Y", prompt, StringComparison.Ordinal);
        // ...and a correction sentence is never a note.
        Assert.Contains("A correction sentence is NEVER an observation", prompt, StringComparison.Ordinal);
        Assert.Contains("never IRRELEVANT_INPUT", prompt, StringComparison.Ordinal);
        foreach (var example in CorrectionPromptData.Examples)
        {
            Assert.Contains(example.Trim(), prompt, StringComparison.Ordinal);
        }

        // Placed after the day's few-shots, right before the final rule, so it is the last thing the model reads.
        var correctionAt = prompt.IndexOf("THIS REQUEST IS A CORRECTION", StringComparison.Ordinal);
        Assert.True(correctionAt > prompt.IndexOf("आज इथरेल 300 मिली फवारणी केली", StringComparison.Ordinal));
        Assert.True(correctionAt < prompt.LastIndexOf("FINAL RULE", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("\"इथरेल 350\"")]
    [InlineData("null")]
    public void Anything_that_is_not_an_entry_adds_no_correction_block(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Equal(string.Empty, CorrectionPromptData.BuildBlock(doc.RootElement.Clone()));
    }

    [Fact]
    public void An_oversized_entry_is_left_out_and_the_parse_runs_as_a_normal_one()
    {
        var huge = JsonSerializer.Serialize(new { observations = Enumerable.Range(0, 400).Select(i => new { noteType = "observation", textRaw = $"नोंद क्रमांक {i} पानांवर डाग दिसले" }) });
        using var doc = JsonDocument.Parse(huge);

        Assert.True(huge.Length > CorrectionPromptData.MaxEntryChars);
        Assert.Equal(string.Empty, CorrectionPromptData.BuildBlock(doc.RootElement.Clone()));
    }

    // ------------------------------------------------------------------ AI-2: the examples teach what the merge needs

    [Fact]
    public void There_are_four_correction_examples_dose_water_hours_labour_count_and_product_name()
    {
        var examples = CorrectionPromptData.Examples.Select(Parse).ToList();

        Assert.Equal(4, examples.Count);
        Assert.Contains(examples, e => e.Input.Contains("तीन नाही, पाच किलो", StringComparison.Ordinal) && e.Output.ContainsKey("inputs"));
        Assert.Contains(examples, e => e.Input.Contains("तास नव्हतं", StringComparison.Ordinal) && e.Output.ContainsKey("irrigation"));
        Assert.Contains(examples, e => e.Input.Contains("बायका नाही", StringComparison.Ordinal) && e.Output.ContainsKey("labour"));
        Assert.Contains(examples, e => e.Input.Contains("बाविस्टीन नव्हतं", StringComparison.Ordinal) && e.Output.ContainsKey("inputs"));
    }

    [Fact]
    public void No_correction_example_stores_the_correction_as_a_note_or_calls_it_irrelevant()
    {
        foreach (var e in CorrectionPromptData.Examples.Select(Parse))
        {
            Assert.Empty(e.Output["observations"]!.AsArray());
            Assert.False(e.Output.ContainsKey("plannedTasks"));
            Assert.False(e.Output.ContainsKey("unclearSegments"));
            Assert.Equal("WORK_RECORDED", e.Output["dayOutcome"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Every_correction_example_answers_only_buckets_he_spoke_about_and_keeps_every_other_row_of_them()
    {
        foreach (var e in CorrectionPromptData.Examples.Select(Parse))
        {
            var answered = new[] { "cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses" }
                .Where(e.Output.ContainsKey)
                .ToList();
            Assert.Single(answered);
            var bucket = answered[0];
            Assert.True(e.Entry.ContainsKey(bucket), $"{bucket} answered but not in the entry");
            if (bucket != "labour")
            {
                // The answer replaces the bucket: every row of it comes back (the changed one corrected).
                Assert.Equal(e.Entry[bucket]!.AsArray().Count, e.Output[bucket]!.AsArray().Count);
            }
        }
    }

    [Fact]
    public void The_labour_example_is_one_the_phones_identity_merge_accepts()
    {
        // RF2 merge (correctionModel.correctLabour, unchanged): each said row states a number, carries no names or
        // money, and matches exactly one engagement by type + group.
        var e = CorrectionPromptData.Examples.Select(Parse).Single(x => x.Output.ContainsKey("labour"));
        var row = e.Output["labour"]!.AsArray().Single()!.AsObject();

        Assert.True(row["femaleCount"]!.GetValue<int>() > 0);
        Assert.False(row.ContainsKey("workerNames"));
        Assert.False(row.ContainsKey("wagePerPerson"));
        Assert.False(row.ContainsKey("totalCost"));
        var matches = e.Entry["labour"]!.AsArray().Count(old =>
            old!["type"]!.GetValue<string>() == row["type"]!.GetValue<string>() &&
            old["gender"]!.GetValue<string>() == row["gender"]!.GetValue<string>());
        Assert.Equal(1, matches);

        // The server's labour guard keeps the corrected number (it does not re-read "पाच बायका" from the phrase).
        var root = new JsonObject { ["labour"] = new JsonArray(row.DeepClone()) };
        LabourRowGuard.Apply(root);
        Assert.Equal(6, root["labour"]![0]!["femaleCount"]!.GetValue<int>());
    }

    [Fact]
    public void A_corrected_dose_survives_the_servers_normalizer_and_the_other_row_is_kept()
    {
        var e = CorrectionPromptData.Examples.Select(Parse).First(x => x.Input.Contains("पाच किलो", StringComparison.Ordinal));

        var normalized = JsonNode.Parse(new AiResponseNormalizer().NormalizeVoiceJson(e.Output.ToJsonString(), serverTranscript: e.Input))!;

        var first = normalized["inputs"]![0]!;
        Assert.Equal(5, first["quantity"]!.GetValue<int>());
        Assert.True(first["provenanceVerified"]!.GetValue<bool>());
        Assert.Equal(1, normalized["inputs"]![1]!["quantity"]!.GetValue<int>());
        Assert.Empty(normalized["observations"]!.AsArray());
    }

    // ------------------------------------------------------------------ helpers

    private static (JsonObject Entry, string Input, JsonObject Output) Parse(string example)
    {
        var lines = example.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var entry = lines.Single(l => l.StartsWith("CURRENT ENTRY: ", StringComparison.Ordinal))["CURRENT ENTRY: ".Length..];
        var input = lines.Single(l => l.StartsWith("Input: ", StringComparison.Ordinal))["Input: ".Length..].Trim('"');
        var output = lines.Single(l => l.StartsWith("Output: ", StringComparison.Ordinal))["Output: ".Length..];
        return (JsonNode.Parse(entry)!.AsObject(), input, JsonNode.Parse(output)!.AsObject());
    }

    private static AiPromptBuilder Builder(bool modular) =>
        new(new AiPromptTemplateRegistry(), Options.Create(new AiPromptOptions { UseModularPrompt = modular }));

    private static VoiceParseContext Context() => new(
        AvailableCrops: [new CropInfo("crop-1", "Grapes", [])],
        Profile: new FarmerProfileInfo([], [], [], null),
        FarmContext: new FarmContextInfo([new SelectedCropContext("crop-1", "Grapes", ["plot-1"], ["G1"])]),
        FocusCategory: null,
        VocabDb: null);

    private static SarvamOptions SarvamOptionsForTest() => new()
    {
        ApiSubscriptionKey = "k-test",
        SttEndpoint = "https://unit.test/stt",
        ChatEndpoint = "https://unit.test/chat",
        ChatModel = "sarvam-test",
        TimeoutSeconds = 5,
        ChatTimeoutSeconds = 5,
    };

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };
}
