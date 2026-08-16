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
// them) and rebuilding an equivalent JsonObject with last-one-wins semantics,
// recursively (nested objects + objects inside arrays), instead of silently
// discarding the farmer's parsed log as an empty object.
public sealed class AiResponseNormalizerDuplicateKeyTests
{
    private readonly AiResponseNormalizer _sut = new();

    [Fact]
    public void NormalizeVoiceJson_TopLevelDuplicateKey_DoesNotThrow_AndLastValueWins()
    {
        // Two "plannedTasks" arrays at the top level — the real Sarvam failure shape.
        const string rawJson =
            """
            {"summary":"kaam kela","plannedTasks":["water"],"plannedTasks":["spray","water"]}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();
        var plannedTasks = root["plannedTasks"]!.AsArray();

        Assert.Equal(2, plannedTasks.Count);
        Assert.Equal("spray", plannedTasks[0]!.GetValue<string>());
        Assert.Equal("water", plannedTasks[1]!.GetValue<string>());
    }

    [Fact]
    public void NormalizeVoiceJson_DuplicateKeyNestedInsideChildObject_StillParses()
    {
        // Duplicate key nested inside "disturbance" (a child object), not at the
        // object's own top level — must recurse into nested objects too.
        const string rawJson =
            """
            {"summary":"paus zala","disturbance":{"reason":"rain","reason":"flood"}}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();
        var disturbance = root["disturbance"]!.AsObject();

        Assert.Equal("flood", disturbance["reason"]!.GetValue<string>());
        Assert.Equal("DISTURBANCE_RECORDED", root["dayOutcome"]!.GetValue<string>());
    }

    [Fact]
    public void NormalizeVoiceJson_DuplicateKeyInsideObjectWithinArray_StillParses()
    {
        // Duplicate key inside an object that itself lives inside an array element
        // — must recurse into arrays-of-objects too, not just direct children.
        const string rawJson =
            """
            {"summary":"mazoor kaam","labour":[{"workerName":"Ramesh","workerName":"Suresh","hours":4}]}
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();
        var labour = root["labour"]!.AsArray();

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

    [Fact]
    public void NormalizeVoiceJson_GenuinelyMalformedJson_StillFallsBackToSafeDefaults()
    {
        // Existing malformed-JSON behaviour (JsonException path) must be unchanged.
        const string rawJson = "{ this is not valid json at all";

        var resultJson = _sut.NormalizeVoiceJson(rawJson);

        var root = JsonNode.Parse(resultJson)!.AsObject();

        // wave-2.2 (spec: dfes-companion-2026-07-11) — this used to pin the literal
        // "Log processed.". The malformed-JSON path still normalizes to safe defaults;
        // it just no longer writes the farmer a summary he did not give. See
        // AiResponseNormalizerSummaryTests for why blank and not absent.
        Assert.Equal(string.Empty, root["summary"]!.GetValue<string>());
        Assert.Empty(root["cropActivities"]!.AsArray());
        Assert.Empty(root["labour"]!.AsArray());
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
