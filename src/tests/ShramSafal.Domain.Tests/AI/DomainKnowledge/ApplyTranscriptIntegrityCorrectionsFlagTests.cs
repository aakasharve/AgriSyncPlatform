using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Task 8 fix — drive the REAL ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections
// (not just the isolated DomainKnowledgePipeline seam) with BOTH flag states.
//
// These tests prove:
//   (a) Flag OFF (default): the ORIGINAL unguarded खत safety-net still fires on
//       an empty-inputs fertilizer transcript → today's behaviour is preserved
//       and the flag-OFF output is byte-identical to pre-Batch-A.
//   (b) Flag ON: the original net is SKIPPED.  A raw-product row (27/10-style
//       "Rally Gold") is NOT overwritten to productName="खत"; an empty-inputs
//       fertilizer case gets the खत row ONLY via the guarded post-lexicon path.
//
// ApplyTranscriptIntegrityCorrections is internal static; the Application
// assembly exposes it via InternalsVisibleTo("ShramSafal.Domain.Tests").
public sealed class ApplyTranscriptIntegrityCorrectionsFlagTests
{
    // The real adapter so the flag-ON branch runs the full pipeline.
    private static readonly DomainKnowledgePipelineAdapter Pipeline = new();

    // -------------------------------------------------------------------------
    // (a) Flag OFF — the original unguarded खत net still fires.
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOff_original_khat_net_fires_on_empty_inputs_fertilizer_transcript()
    {
        // Empty inputs[]; transcript mentions खत + a past-tense verb.
        const string normalizedJson = """{ "inputs": [] }""";
        const string transcript = "आज बागेत खत दिले.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: false,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();
        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        var khatRow = inputs!.OfType<JsonObject>()
            .FirstOrDefault(r => (r["productName"]?.GetValue<string>() ?? "") == "खत");
        khatRow.Should().NotBeNull(
            "with the flag OFF the ORIGINAL unguarded khat safety-net must still inject the खत row (today's behaviour)");
    }

    // -------------------------------------------------------------------------
    // (a') Flag OFF — byte-identical: the pipeline is NEVER invoked, so output
    //      matches the result computed WITHOUT any pipeline at all.
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOff_output_is_byte_identical_to_no_pipeline()
    {
        const string normalizedJson =
            """{ "inputs": [ { "productName": "ethrel" } ], "machinery": [ { "type": "blower" } ] }""";
        const string transcript =
            "आज द्राक्षबागेत 00:52:34 आणि ethrel फवारणी केली. 1000 लिटर पाणी वापरले. खत दिले.";

        // Flag OFF, pipeline adapter SUPPLIED — must not be called.
        var withPipeline = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: false,
            domainKnowledgePipeline: Pipeline);

        // Flag OFF, pipeline adapter NULL — same code path.
        var withoutPipeline = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: false,
            domainKnowledgePipeline: null);

        withPipeline.Should().Be(withoutPipeline,
            "flag-OFF output must be byte-identical regardless of whether the pipeline adapter is supplied (it is never invoked)");

        // And NPK rescue / lexicon normalization must NOT have run (flag OFF).
        var root = JsonNode.Parse(withPipeline)!.AsObject();
        var inputs = root["inputs"] as JsonArray;
        var hasNpkRow = inputs!.OfType<JsonObject>()
            .Any(r => (r["normalizedProductName"]?.GetValue<string>() ?? "").Contains("0-52-34"));
        hasNpkRow.Should().BeFalse("with the flag OFF the NPK rescuer must NOT run");

        var ethrelNormalized = inputs.OfType<JsonObject>()
            .Any(r => (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Equals("Ethrel", StringComparison.OrdinalIgnoreCase));
        ethrelNormalized.Should().BeFalse("with the flag OFF the lexicon must NOT run");
    }

    // -------------------------------------------------------------------------
    // (b) Flag ON — a raw-product row is NOT overwritten to खत.
    //     27/10-style "Rally Gold": structurer left a raw-product row; the
    //     original net is skipped and the guarded post-lexicon net must not
    //     touch a row that carries a product name / rawProductName.
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOn_rally_gold_raw_product_row_not_overwritten_to_khat()
    {
        // The structurer produced a row with a product name (Rally Gold) but no
        // dose. The transcript ALSO contains खत + a past-tense verb that would
        // have tripped the original net — but inputs[] is non-empty here anyway.
        const string normalizedJson =
            """{ "inputs": [ { "productName": "Rally Gold" } ] }""";
        const string transcript = "आज बागेत Rally Gold आणि खत दिले.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: true,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();
        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        // No row may have been overwritten to खत.
        foreach (var node in inputs!.OfType<JsonObject>())
        {
            var productName = node["productName"]?.GetValue<string>();
            productName.Should().NotBe("खत",
                "flag-ON must NOT overwrite a real product row with the generic खत safety-net");
        }

        // The Rally Gold row must survive with its rawProductName preserved by the lexicon.
        var rallyRow = inputs.OfType<JsonObject>()
            .FirstOrDefault(r => (r["rawProductName"]?.GetValue<string>() ?? "")
                .Contains("Rally Gold", StringComparison.OrdinalIgnoreCase)
                || (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Contains("Rally Gold", StringComparison.OrdinalIgnoreCase));
        rallyRow.Should().NotBeNull("the Rally Gold row must survive the pipeline with its raw preserved");
    }

    // -------------------------------------------------------------------------
    // (b') Flag ON — empty-inputs fertilizer case gets the खत row ONLY via the
    //      guarded post-lexicon path (single injection, not double).
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOn_empty_inputs_fertilizer_gets_single_khat_row_via_guarded_path()
    {
        const string normalizedJson = """{ "inputs": [] }""";
        const string transcript = "आज बागेत खत दिले.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: true,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();
        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        var khatRows = inputs!.OfType<JsonObject>()
            .Where(r => (r["productName"]?.GetValue<string>() ?? "") == "खत")
            .ToList();
        khatRows.Should().HaveCount(1,
            "with the flag ON the खत row must be injected EXACTLY ONCE via the guarded post-lexicon net (the original net is skipped, so no double injection)");
    }
}
