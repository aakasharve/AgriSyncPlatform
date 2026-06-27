using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Task 8 — pipeline wire-in tests.
//
// Tests use the internal seam RunDomainKnowledgePipeline(JsonObject, string)
// directly — no flag needed at this layer.
//
// Acceptance test cases:
//   1. 19/10 transcript: NPK grade rescued (0-52-34 MKP), names normalized
//      with rawProductName preserved, spray carrier classified (not irrigation),
//      provenance stamped.
//   2. खत-guard regression: a root with inputs[0].rawProductName is NOT
//      overwritten to productName="खत" by the safety-net.
//   3. Idempotency: calling the pipeline twice yields the same logical result.

public sealed class DomainKnowledgePipelineTests
{
    // -------------------------------------------------------------------------
    // 19/10 vlog transcript (representative subset)
    // Signals present:
    //   - "00:52:34" (0-52-34 MKP) → NPK grade
    //   - "aplhamitren" → Alphamethrin (lexicon)
    //   - "ethrel" → Ethrel (lexicon)
    //   - "1000 लिटर" + "फवारणी" + blower in machinery → sprayCarrier
    //   - provenance stamped on all quantity-bearing rows
    // -------------------------------------------------------------------------

    private const string Transcript1910 =
        "आज आम्ही द्राक्षबागेत 00:52:34 आणि aplhamitren आणि ethrel फवारणी केली. " +
        "1000 लिटर पाणी वापरले. ब्लोअर मशीनने फवारली.";

    [Fact]
    public void Pipeline_19_10_transcript_rescues_npk_grade_and_normalizes_lexicon()
    {
        // Arrange: a root with machinery (blower) so spray-carrier classification fires.
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject { ["productName"] = "aplhamitren" },
                new JsonObject { ["productName"] = "ethrel" }
            },
            ["machinery"] = new JsonArray
            {
                new JsonObject { ["type"] = "blower" }
            }
        };

        // Act
        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, Transcript1910);

        // Assert — NPK grade was rescued (added as a new row by C1)
        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        var npkRow = inputs!
            .OfType<JsonObject>()
            .FirstOrDefault(r => (r["normalizedProductName"]?.GetValue<string>() ?? "").Contains("0-52-34"));
        npkRow.Should().NotBeNull("NpkGradeDictionary should have rescued 00:52:34 → 0-52-34 MKP");

        // rawProductName should be the colon form
        var rawGrade = npkRow!["rawProductName"]?.GetValue<string>();
        rawGrade.Should().Be("00:52:34", "raw colon form must be preserved");

        // provenance on the NPK row must be "derived" (set by NpkGradeDictionary)
        var npkProvenance = npkRow["provenance"]?.GetValue<string>();
        npkProvenance.Should().Be("derived", "NpkGradeDictionary stamps provenance=derived");
    }

    [Fact]
    public void Pipeline_19_10_transcript_normalizes_lexicon_entries_preserving_raw()
    {
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject { ["productName"] = "aplhamitren" },
                new JsonObject { ["productName"] = "ethrel" }
            },
            ["machinery"] = new JsonArray
            {
                new JsonObject { ["type"] = "blower" }
            }
        };

        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, Transcript1910);

        var inputs = root["inputs"] as JsonArray;

        // Alphamethrin row
        var alphaRow = inputs!
            .OfType<JsonObject>()
            .FirstOrDefault(r => (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Equals("Alphamethrin", StringComparison.OrdinalIgnoreCase));
        alphaRow.Should().NotBeNull("GrapeInputLexicon should normalize aplhamitren → Alphamethrin");
        alphaRow!["rawProductName"]?.GetValue<string>().Should().Be("aplhamitren",
            "rawProductName must be preserved");

        // Ethrel row
        var ethrelRow = inputs
            .OfType<JsonObject>()
            .FirstOrDefault(r => (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Equals("Ethrel", StringComparison.OrdinalIgnoreCase));
        ethrelRow.Should().NotBeNull("GrapeInputLexicon should normalize ethrel → Ethrel");
        ethrelRow!["rawProductName"]?.GetValue<string>().Should().Be("ethrel",
            "rawProductName must be preserved");
    }

    [Fact]
    public void Pipeline_19_10_transcript_classifies_spray_carrier_not_irrigation()
    {
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject { ["productName"] = "ethrel" }
            },
            ["machinery"] = new JsonArray
            {
                new JsonObject { ["type"] = "blower" }
            }
        };

        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, Transcript1910);

        // irrigation[] should be empty (spray carrier dominates)
        var irrigation = root["irrigation"] as JsonArray;
        var irrigationCount = irrigation?.Count ?? 0;
        irrigationCount.Should().Be(0,
            "WaterRoleClassifier should demote/empty irrigation[] when spray verb + litre + machine dominate");

        // The first input row should carry waterRole=sprayCarrier
        var inputs = root["inputs"] as JsonArray;
        var firstRow = inputs?.OfType<JsonObject>().FirstOrDefault();
        firstRow.Should().NotBeNull();
        var waterRole = firstRow!["waterRole"]?.GetValue<string>();
        waterRole.Should().Be("sprayCarrier",
            "WaterRoleClassifier should tag the first input row as sprayCarrier");
    }

    [Fact]
    public void Pipeline_stamps_provenance_on_quantity_bearing_nodes()
    {
        // Use a root with a dose so ProvenanceTagger has something to stamp.
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject
                {
                    ["productName"] = "ethrel",
                    ["dose"] = "4",
                    ["unit"] = "ml"
                }
            },
            ["machinery"] = new JsonArray
            {
                new JsonObject { ["type"] = "blower" }
            }
        };

        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, Transcript1910);

        // Every quantity-bearing input row should have a provenance field.
        var inputs = root["inputs"] as JsonArray;
        foreach (var node in inputs!.OfType<JsonObject>())
        {
            var dose = node["dose"];
            var carrierVolume = node["carrierVolume"];
            // Only check rows that are quantity-bearing
            if (dose != null || carrierVolume != null)
            {
                var provenance = node["provenance"]?.GetValue<string>();
                provenance.Should().NotBeNullOrEmpty(
                    "ProvenanceTagger should stamp provenance on every quantity-bearing node");
                provenance.Should().BeOneOf("spoken", "derived", "assumed",
                    "provenance must be a valid value");
            }
        }
    }

    // -------------------------------------------------------------------------
    // खत-guard regression: inputs[0] carries rawProductName → must NOT
    // be overwritten to productName="खत" by the safety-net.
    // -------------------------------------------------------------------------

    [Fact]
    public void Pipeline_khat_guard_regression_rawProductName_row_not_overwritten()
    {
        // Simulate a transcript that would normally trigger the खत safety-net
        // (contains "खत" + past-tense verb "दिले").
        const string fertilizerTranscript =
            "आज बागेत 00:52:34 खत दिले. पाणी पण दिले.";

        // Root already has an input row with rawProductName (set by NPK rescue or lexicon).
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject
                {
                    ["normalizedProductName"] = "0-52-34 MKP (mono-potassium phosphate)",
                    ["rawProductName"] = "00:52:34",
                    ["provenance"] = "derived"
                }
            }
        };

        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, fertilizerTranscript);

        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        // The existing row must not have been overwritten to खत.
        foreach (var node in inputs!.OfType<JsonObject>())
        {
            var productName = node["productName"]?.GetValue<string>();
            productName.Should().NotBe("खत",
                "the खत safety-net must NOT overwrite a row that already carries rawProductName");
        }

        // No additional खत row should have been injected.
        var khatRow = inputs.OfType<JsonObject>()
            .FirstOrDefault(r => (r["productName"]?.GetValue<string>() ?? "") == "खत");
        khatRow.Should().BeNull("खत safety-net must not inject a row when inputs[] already carries rawProductName");
    }

    // -------------------------------------------------------------------------
    // खत safety-net DOES fire when inputs is empty and no rawProductName exists.
    // -------------------------------------------------------------------------

    [Fact]
    public void Pipeline_khat_safety_net_fires_when_inputs_empty_and_no_rawProductName()
    {
        // Transcript triggers fertilizer detection but the LLM returned no inputs[].
        const string fertilizerTranscript =
            "आज बागेत खत दिले.";

        var root = new JsonObject
        {
            ["inputs"] = new JsonArray()
        };

        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, fertilizerTranscript);

        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        // The खत safety-net should have injected a row.
        var khatRow = inputs!.OfType<JsonObject>()
            .FirstOrDefault(r => (r["productName"]?.GetValue<string>() ?? "") == "खत");
        khatRow.Should().NotBeNull(
            "खत safety-net should inject a row when inputs[] is empty and fertilizer was mentioned");
    }

    // -------------------------------------------------------------------------
    // Idempotency: running the pipeline twice should not double-inject rows.
    // -------------------------------------------------------------------------

    [Fact]
    public void Pipeline_is_idempotent_on_double_call()
    {
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject { ["productName"] = "aplhamitren" }
            },
            ["machinery"] = new JsonArray
            {
                new JsonObject { ["type"] = "blower" }
            }
        };

        // First call
        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, Transcript1910);
        var inputCountAfterFirst = (root["inputs"] as JsonArray)?.Count ?? 0;

        // Second call — should not add duplicates
        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, Transcript1910);
        var inputCountAfterSecond = (root["inputs"] as JsonArray)?.Count ?? 0;

        inputCountAfterSecond.Should().Be(inputCountAfterFirst,
            "calling the pipeline twice should not inject duplicate rows (idempotency)");
    }
}
