using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

// spec: dfes-companion-2026-07-11
// CRITICAL live-prod bug: Sarvam (sarvam-30b) emitted a JSON object with a
// duplicate "plannedTasks" key. System.Text.Json's JsonNode.Parse throws
// ArgumentException ("An item with the same key has already been added")
// for duplicate object keys — NOT JsonException — so the previous
// try/catch(JsonException) in AiResponseNormalizer.ParseJsonObject let the
// exception escape, hard-failing the whole provider attempt
// (ai_job_attempts: provider=Sarvam success=false).
//
// Fix: tolerate duplicate keys by re-parsing via JsonDocument (which permits
// them) and rebuilding an equivalent JsonObject, recursively (nested objects +
// objects inside arrays), instead of silently discarding the farmer's parsed log
// as an empty object.
//
// 28 Nov 2026 (CTO scope add after the 20-sample test) - "last one wins" was itself
// a silent loss: Sarvam emitted "inputs":[2 products] and later "inputs":[], the
// saved log had no products, and the call still reported success. Now a key repeated
// with the SAME value is collapsed (these tests, the "Identical" ones) and a key
// repeated with a DIFFERENT value is a broken answer that throws
// BrokenModelAnswerException (the providers turn that into a failed call: retry once,
// then the backup sorter, then the unheard-voice path). The receipt/patti path
// (NormalizeGenericJson) is not part of that change.
public sealed class AiResponseNormalizerDuplicateKeyTests
{
    private readonly AiResponseNormalizer _sut = new();

    [Fact]
    public void NormalizeVoiceJson_TopLevelDuplicateKey_WithDifferentValues_IsABrokenAnswer_NotLastValueWins()
    {
        // Two "plannedTasks" arrays at the top level with different content - the real Sarvam failure shape. Keeping the last
        // one would silently drop the first; the answer is broken instead.
        const string rawJson =
            """
            {"summary":"kaam kela","plannedTasks":["water"],"plannedTasks":["spray","water"]}
            """;

        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Equal(AnswerProblem.ConflictingDuplicateKeys, thrown.Inspection.Problem);
        Assert.Contains("$.plannedTasks", thrown.Inspection.ConflictingKeys);
    }

    [Fact]
    public void NormalizeVoiceJson_TheLiveSarvamCase_TwoProductsThenAnEmptyInputsList_IsABrokenAnswer_NotAnEmptyProductList()
    {
        const string rawJson =
            """
            {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","quantity":4,"unit":"ml"},{"productName":"Dormex","quantity":1,"unit":"L"}],"labour":[],"inputs":[]}
            """;

        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Equal(AnswerProblem.ConflictingDuplicateKeys, thrown.Inspection.Problem);
        Assert.Equal(["$.inputs"], thrown.Inspection.ConflictingKeys);
    }

    [Fact]
    public void NormalizeVoiceJson_TopLevelDuplicateKey_WithTheSameValue_IsCollapsed_AndTheAnswerKept()
    {
        const string rawJson =
            """
            {"summary":"kaam kela","plannedTasks":["spray","water"],"plannedTasks":["spray","water"]}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var plannedTasks = JsonNode.Parse(resultJson)!.AsObject()["plannedTasks"]!.AsArray();
        Assert.Equal(2, plannedTasks.Count);
        Assert.Equal("spray", plannedTasks[0]!.GetValue<string>());
        Assert.Equal("water", plannedTasks[1]!.GetValue<string>());
    }

    [Fact]
    public void NormalizeVoiceJson_DuplicateKeyNestedInsideChildObject_WithDifferentValues_IsABrokenAnswer()
    {
        // Duplicate key nested inside "disturbance" (a child object), not at the object's own top level: still found.
        const string rawJson =
            """
            {"summary":"paus zala","disturbance":{"reason":"rain","reason":"flood"}}
            """;

        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Equal(AnswerProblem.ConflictingDuplicateKeys, thrown.Inspection.Problem);
        Assert.Contains("$.disturbance.reason", thrown.Inspection.ConflictingKeys);
    }

    [Fact]
    public void NormalizeVoiceJson_DuplicateKeyNestedInsideChildObject_WithTheSameValue_StillParses()
    {
        const string rawJson =
            """
            {"summary":"paus zala","disturbance":{"reason":"rain","reason":"rain"}}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();
        Assert.Equal("rain", root["disturbance"]!.AsObject()["reason"]!.GetValue<string>());
        Assert.Equal("DISTURBANCE_RECORDED", root["dayOutcome"]!.GetValue<string>());
    }

    [Fact]
    public void NormalizeVoiceJson_DuplicateKeyInsideObjectWithinArray_WithDifferentValues_IsABrokenAnswer()
    {
        // Duplicate key inside an object that itself lives inside an array element: found too, with its path.
        const string rawJson =
            """
            {"summary":"mazoor kaam","labour":[{"workerName":"Ramesh","workerName":"Suresh","hours":4}]}
            """;

        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Contains("$.labour[0].workerName", thrown.Inspection.ConflictingKeys);
    }

    [Fact]
    public void NormalizeVoiceJson_DuplicateKeyInsideObjectWithinArray_WithTheSameValue_StillParses()
    {
        const string rawJson =
            """
            {"summary":"mazoor kaam","labour":[{"workerName":"Suresh","workerName":"Suresh","hours":4}]}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var labour = JsonNode.Parse(resultJson)!.AsObject()["labour"]!.AsArray();
        Assert.Single(labour);
        Assert.Equal("Suresh", labour[0]!["workerName"]!.GetValue<string>());
        Assert.Equal(4, labour[0]!["hours"]!.GetValue<int>());
    }

    [Fact]
    public void NormalizeGenericJson_DuplicateKeyInsideReceiptLineItem_StillParses()
    {
        // Same shared helper is used by the receipt/patti path — cover it too.
        const string rawJson =
            """
            {"lineItems":[{"name":"Urea","name":"DAP","quantity":2,"unitPrice":300}],"grandTotal":600}
            """;

        var resultJson = _sut.NormalizeGenericJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();
        var lineItems = root["lineItems"]!.AsArray();

        Assert.Single(lineItems);
        Assert.Equal("DAP", lineItems[0]!["name"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("{ this is not valid json at all")]
    [InlineData("{\"dayOutcome\":\"WORK_RECORDED\",\"labour\":[{\"count\":4}\n - \"femaleCount\": 3\n]}")] // the live 3.5 Flash-Lite case: a stray line lost the labour
    public void NormalizeVoiceJson_MalformedJson_IsABrokenAnswer_NeverAnEmptySuccessfulWorkDay(string rawJson)
    {
        // This test used to say "falls back to safe defaults": the answer became an EMPTY WORK_RECORDED day that reported
        // success (NormalizeDayOutcome(null) is "WORK_RECORDED"), so a talk could be saved as a day with no work in it. It is
        // now a failure the caller must handle (retry, backup sorter, then the note is kept for later).
        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Equal(AnswerProblem.Unparseable, thrown.Inspection.Problem);
        Assert.Null(thrown.Inspection.Text);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("{}")]
    public void NormalizeVoiceJson_NoAnswerAtAll_IsABrokenAnswer(string rawJson)
    {
        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Equal(AnswerProblem.Empty, thrown.Inspection.Problem);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("\"WORK_RECORDED\"")]
    [InlineData("42")]
    public void NormalizeVoiceJson_AnswerThatIsNotAnObject_IsABrokenAnswer(string rawJson)
    {
        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson));

        Assert.Equal(AnswerProblem.NotAnObject, thrown.Inspection.Problem);
    }

    [Theory]
    [InlineData("""{"summary":"","labour":[],"inputs":[]}""")] // no dayOutcome, nothing else
    [InlineData("""{"dayOutcome":"","irrigation":[]}""")] // blank dayOutcome, nothing else
    [InlineData("""{"dayOutcome":"WORKED_A_LOT","inputs":[]}""")] // unknown dayOutcome, nothing else
    [InlineData("""{"observations":[{"textRaw":"पाने पिवळी"}]}""")] // an observation is not work: no day outcome, no work row
    public void NormalizeVoiceJson_NoDayOutcomeAndNoWork_WhenTheSortingPromptAskedForOne_IsABrokenAnswer_NotAWorkDay(string rawJson)
    {
        var thrown = Assert.Throws<BrokenModelAnswerException>(() => _sut.NormalizeVoiceJson(rawJson, requireDayOutcome: true));

        Assert.Equal(AnswerProblem.NoDayOutcome, thrown.Inspection.Problem);
    }

    [Theory]
    [InlineData("""{"inputs":[{"productName":"Ethrel"}]}""")] // no dayOutcome but a work row: the old default is still true of it
    [InlineData("""{"dayOutcome":"NO_WORK_PLANNED","inputs":[]}""")] // a stated outcome is never second-guessed
    [InlineData("""{"dayOutcome":"IRRELEVANT_INPUT"}""")]
    [InlineData("""{"disturbance":{"reason":"rain"}}""")] // no work row, but a disturbance: the normalizer names that day itself
    public void NormalizeVoiceJson_ARealAnswer_IsStillAccepted_EvenWithoutADayOutcome_WhenItHoldsWorkOrADisturbance(string rawJson)
    {
        var resultJson = _sut.NormalizeVoiceJson(rawJson, requireDayOutcome: true);

        Assert.NotNull(JsonNode.Parse(resultJson)!.AsObject()["dayOutcome"]);
    }

    [Fact]
    public void NormalizeVoiceJson_WithoutRequireDayOutcome_TheVerificationAnswerStillWorks()
    {
        // The verification (CoVe) prompt asks for a score and a summary, not a day: its answer has no dayOutcome and no work,
        // and must keep working. Only a sorting prompt (one that asks for a dayOutcome) sets requireDayOutcome.
        var resultJson = _sut.NormalizeVoiceJson("""{"confidence":0.7,"summary":"mostly supported"}""");

        Assert.Equal(0.7m, JsonNode.Parse(resultJson)!.AsObject()["confidence"]!.GetValue<decimal>());
        Assert.False(AiAnswerInspector.PromptAsksForDayOutcome("Reply with ONE JSON object exactly matching this shape: {\"confidence\": 0.5}"));
        Assert.True(AiAnswerInspector.PromptAsksForDayOutcome("Output: {\"dayOutcome\":\"WORK_RECORDED\"}"));
    }

    [Fact]
    public void NormalizeVoiceJson_NormalValidJson_IsUnchanged()
    {
        // Happy-path regression guard: valid JSON with no duplicate keys must
        // normalize exactly as before this fix.
        const string rawJson =
            """
            {"summary":"Sprayed grapes","cropActivities":[{"activity":"spray"}],"confidence":0.9}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();

        Assert.Equal("Sprayed grapes", root["summary"]!.GetValue<string>());
        Assert.Equal("spray", root["cropActivities"]!.AsArray()[0]!["activity"]!.GetValue<string>());
        Assert.Equal(0.9m, root["confidence"]!.GetValue<decimal>());
        Assert.Equal("WORK_RECORDED", root["dayOutcome"]!.GetValue<string>());
    }
}
