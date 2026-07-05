using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 7 — ProvenanceTagger acceptance tests.
// All test inputs are drawn from the 18 real grape vlogs described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 7.
//
// Four provenance classes:
//   spoken    — value lifted verbatim from the transcript (stated dose, stated rupee).
//   derived   — produced by a confirmed rule (00:52:34→MKP grade, Bordeaux synthesis,
//               piece-rate total from a stated rate). Allowed.
//   assumed   — produced from an unconfirmed premise (e.g. fabricated tank-total with
//               no carrier volume stated). Marked AND doseBasis forced to NOT_MENTIONED.
//   confirmed — reserved; set later by the confirm screen (Track C). NOT set here.
//
// ProvenanceTagger.Stamp(JsonObject root) runs LAST in the pipeline.
// INTERNAL ONLY — provenance is never serialized to a farmer-facing label.
public sealed class ProvenanceTaggerTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Builds a root simulating the 19/10 vlog (Ethrel spray) state AFTER prior
    /// normalizer passes: an inputs row carrying a verbatim dose of 4 ml/L
    /// (stated directly by the farmer), and no fabricated carrier total.
    /// </summary>
    private static JsonObject BuildRoot_19Oct_Ethrel_StatedDose()
    {
        var inputRow = new JsonObject
        {
            ["normalizedProductName"] = "Ethrel",
            ["rawProductName"] = "ethrel",
            ["dose"] = "4",
            ["unit"] = "ml/L",
            // "4 ml/L" was verbatim in the transcript — no upstream assumed marker.
            // No totalMl present; the tagger must recognize this as spoken.
            ["confirmationStatus"] = "auto_normalized"
        };

        return new JsonObject
        {
            ["inputs"] = new JsonArray { inputRow }
        };
    }

    /// <summary>
    /// Builds a root simulating the 26/10 NPK grade rescue AFTER NpkGradeDictionary ran:
    /// an inputs row that was produced by the grade-rescue rule (confirmed rule
    /// 00:52:34 → MKP). The row already carries provenance="derived" set by
    /// NpkGradeDictionary; ProvenanceTagger must preserve (not overwrite) it.
    /// </summary>
    private static JsonObject BuildRoot_26Oct_MKP_GradeRescued()
    {
        var inputRow = new JsonObject
        {
            ["normalizedProductName"] = "0-52-34 MKP (mono-potassium phosphate)",
            ["rawProductName"] = "00:52:34",
            ["costSource"] = "NOT_MENTIONED",
            ["provenance"] = "derived"   // set by NpkGradeDictionary
        };

        return new JsonObject
        {
            ["inputs"] = new JsonArray { inputRow }
        };
    }

    /// <summary>
    /// Builds a root simulating the old "fabricated tank total" scenario — the
    /// poisoned ethrel-blower-derivation case.  The inputs row carries a
    /// totalMl=2400 that was never spoken (it was derived from an assumed 600 L
    /// tank that was never stated).  The tagger must detect this as "assumed"
    /// and force doseBasis="NOT_MENTIONED".
    /// </summary>
    private static JsonObject BuildRoot_FabricatedTankTotal()
    {
        var inputRow = new JsonObject
        {
            ["normalizedProductName"] = "Ethrel",
            ["rawProductName"] = "ethrel",
            ["dose"] = "4",
            ["unit"] = "ml/L",
            // totalMl was computed from an ASSUMED carrier volume (no carrier stated).
            // The pipeline sets assumedCarrier=true to flag this as unconfirmed.
            ["totalMl"] = 2400,
            ["assumedCarrier"] = true,
            // doseBasis is currently present (should be forced to NOT_MENTIONED by tagger)
            ["doseBasis"] = "per-600L"
        };

        return new JsonObject
        {
            ["inputs"] = new JsonArray { inputRow }
        };
    }

    /// <summary>
    /// Builds a root that represents the Bordeaux synthesis result from
    /// FormulationRecognizer — provenance should be "derived" (Bordeaux synthesis
    /// is a confirmed rule).
    /// </summary>
    private static JsonObject BuildRoot_Bordeaux_Derived()
    {
        var copperRow = new JsonObject
        {
            ["normalizedProductName"] = "Copper sulfate",
            ["rawProductName"] = "मोरचुद",
            ["dose"] = "2",
            ["unit"] = "kg",
            ["partOfFormulation"] = "Bordeaux"
        };

        var limeRow = new JsonObject
        {
            ["normalizedProductName"] = "Lime",
            ["rawProductName"] = "चुना",
            ["dose"] = "1",
            ["unit"] = "kg",
            ["partOfFormulation"] = "Bordeaux"
        };

        var bordeauxRow = new JsonObject
        {
            ["normalizedProductName"] = "Bordeaux mixture",
            ["doseBasis"] = "per-600L",
            ["basisUnit"] = "L",
            ["provenance"] = "derived",   // set by FormulationRecognizer
            ["mix"] = new JsonArray { copperRow.DeepClone(), limeRow.DeepClone() }
        };

        return new JsonObject
        {
            ["inputs"] = new JsonArray { copperRow, limeRow, bordeauxRow }
        };
    }

    /// <summary>
    /// Builds a root with a farmer-facing summary string to test that no
    /// provenance="assumed" value leaks into it.
    /// </summary>
    private static JsonObject BuildRoot_WithSummaryAndAssumedValue()
    {
        var inputRow = new JsonObject
        {
            ["normalizedProductName"] = "Ethrel",
            ["totalMl"] = 2400,
            ["assumedCarrier"] = true,
            ["doseBasis"] = "per-600L"
        };

        // A farmer-facing summary string (as might be generated by a display layer).
        // The contract asserts the tagger never writes "assumed" into this field.
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray { inputRow },
            ["summary"] = "Ethrel फवारणी केली.",
            ["farmerSummary"] = "आज फवारणी झाली."
        };

        return root;
    }

    // -------------------------------------------------------------------------
    // Test 1: 19/10 stated 4 ml/L dose → spoken provenance
    //
    // "4 ml/L" was verbatim in the farmer's transcript — this is a spoken value.
    // No upstream assumed marker → the tagger assigns provenance="spoken".
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_19Oct_StatedDose_AssignsSpokenProvenance()
    {
        // Arrange: Ethrel row with stated dose, no assumed flag, no computed total
        var root = BuildRoot_19Oct_Ethrel_StatedDose();

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: the inputs row carrying the verbatim dose must have provenance="spoken"
        var inputs = (JsonArray)root["inputs"]!;
        var row = (JsonObject)inputs[0]!;

        var provenance = row["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("spoken", provenance, ignoreCase: true);
    }

    [Fact]
    public void Stamp_19Oct_StatedDose_DoesNotForceDoseBasisToNotMentioned()
    {
        // Arrange: a "spoken" row must NOT have its doseBasis cleared to NOT_MENTIONED
        var root = BuildRoot_19Oct_Ethrel_StatedDose();
        var inputs = (JsonArray)root["inputs"]!;
        var row = (JsonObject)inputs[0]!;
        row["doseBasis"] = "per-L";   // legitimately stated

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: doseBasis must remain "per-L" — tagger must not clobber spoken basis
        var doseBasis = row["doseBasis"]?.GetValue<string>() ?? "";
        Assert.NotEqual("NOT_MENTIONED", doseBasis, StringComparer.OrdinalIgnoreCase);
    }

    // -------------------------------------------------------------------------
    // Test 2: 00:52:34 → MKP grade rescue → derived provenance
    //
    // NpkGradeDictionary already stamps provenance="derived" on the rescued row.
    // ProvenanceTagger must preserve it (not overwrite with "spoken").
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_26Oct_MKP_GradeRescued_PreservesDerivedProvenance()
    {
        // Arrange: inputs row already carrying provenance="derived" (from NpkGradeDictionary)
        var root = BuildRoot_26Oct_MKP_GradeRescued();

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: provenance must remain "derived"
        var inputs = (JsonArray)root["inputs"]!;
        var row = (JsonObject)inputs[0]!;

        var provenance = row["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("derived", provenance, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Test 3: fabricated tank-total → assumed provenance + doseBasis=NOT_MENTIONED
    //
    // A row carrying totalMl=2400 with assumedCarrier=true has no confirming
    // carrier volume from the transcript.  The tagger must:
    //   (a) set provenance="assumed"
    //   (b) force doseBasis="NOT_MENTIONED"
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_FabricatedTankTotal_AssignsAssumedProvenance()
    {
        // Arrange: row with totalMl derived from an ASSUMED carrier volume
        var root = BuildRoot_FabricatedTankTotal();

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: provenance must be "assumed"
        var inputs = (JsonArray)root["inputs"]!;
        var row = (JsonObject)inputs[0]!;

        var provenance = row["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("assumed", provenance, ignoreCase: true);
    }

    [Fact]
    public void Stamp_FabricatedTankTotal_ForcesDoseBasisToNotMentioned()
    {
        // Arrange: row with totalMl derived from an ASSUMED carrier volume;
        // doseBasis="per-600L" was a fabrication (the 600L was never stated).
        var root = BuildRoot_FabricatedTankTotal();

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: doseBasis must be forced to NOT_MENTIONED
        var inputs = (JsonArray)root["inputs"]!;
        var row = (JsonObject)inputs[0]!;

        var doseBasis = row["doseBasis"]?.GetValue<string>() ?? "";
        Assert.Equal("NOT_MENTIONED", doseBasis, StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void Stamp_FabricatedTankTotal_AssumedRowHasAssumedProvenance()
    {
        // Combined assertion: both conditions hold in the same call.
        var root = BuildRoot_FabricatedTankTotal();

        ProvenanceTagger.Stamp(root);

        var inputs = (JsonArray)root["inputs"]!;
        var row = (JsonObject)inputs[0]!;

        var provenance = row["provenance"]?.GetValue<string>() ?? "";
        var doseBasis = row["doseBasis"]?.GetValue<string>() ?? "";

        Assert.Equal("assumed", provenance, ignoreCase: true);
        Assert.Equal("NOT_MENTIONED", doseBasis, StringComparer.OrdinalIgnoreCase);
    }

    // -------------------------------------------------------------------------
    // Test 4: Bordeaux synthesis row → derived provenance preserved
    //
    // FormulationRecognizer stamps provenance="derived" on the Bordeaux row.
    // ProvenanceTagger must preserve it.
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_Bordeaux_Synthesis_PreservesDerivedProvenance()
    {
        // Arrange: Bordeaux row already tagged provenance="derived" by FormulationRecognizer
        var root = BuildRoot_Bordeaux_Derived();

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: the Bordeaux row must still be "derived"
        var inputs = (JsonArray)root["inputs"]!;
        var bordeauxRow = inputs
            .Cast<JsonObject>()
            .FirstOrDefault(r =>
            {
                var name = r["normalizedProductName"]?.GetValue<string>() ?? "";
                return name.Contains("Bordeaux", StringComparison.OrdinalIgnoreCase);
            });

        Assert.NotNull(bordeauxRow);
        var provenance = bordeauxRow["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("derived", provenance, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Test 5: Architecture/contract assertion —
    //   no provenance="assumed" value is ever written into a farmer-facing
    //   summary/farmerSummary string field.
    //
    // The tagger stamps provenance metadata on quantity nodes but MUST NOT
    // copy the word "assumed" (or any assumed value) into the top-level
    // "summary" or "farmerSummary" string fields.
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_AssumedNode_NeverWritesAssumedIntoSummaryField()
    {
        // Arrange: root with a fabricated row AND pre-existing summary strings
        var root = BuildRoot_WithSummaryAndAssumedValue();
        var summaryBefore = root["summary"]?.GetValue<string>() ?? "";
        var farmerSummaryBefore = root["farmerSummary"]?.GetValue<string>() ?? "";

        // Act
        ProvenanceTagger.Stamp(root);

        // Assert: summary fields must not contain the word "assumed" after stamp
        var summaryAfter = root["summary"]?.GetValue<string>() ?? "";
        var farmerSummaryAfter = root["farmerSummary"]?.GetValue<string>() ?? "";

        Assert.DoesNotContain("assumed", summaryAfter, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("assumed", farmerSummaryAfter, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Stamp_AssumedNode_SummaryFieldIsUnchanged()
    {
        // The tagger must leave summary/farmerSummary fields byte-identical
        // (it writes metadata on quantity nodes only, never touches summary strings).
        var root = BuildRoot_WithSummaryAndAssumedValue();
        var summaryBefore = root["summary"]?.GetValue<string>() ?? "";
        var farmerSummaryBefore = root["farmerSummary"]?.GetValue<string>() ?? "";

        ProvenanceTagger.Stamp(root);

        Assert.Equal(summaryBefore, root["summary"]?.GetValue<string>() ?? "");
        Assert.Equal(farmerSummaryBefore, root["farmerSummary"]?.GetValue<string>() ?? "");
    }

    // -------------------------------------------------------------------------
    // Test 6: A row with no provenance signal and no assumed flag → spoken
    //   (default assignment for quantity-bearing nodes without upstream markers)
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_RowWithNoUpstreamMarker_AssignsSpokenAsDefault()
    {
        // A row with a dose but no provenance set and no assumedCarrier flag
        // should default to "spoken" (the value was presumably verbatim from transcript).
        var inputRow = new JsonObject
        {
            ["normalizedProductName"] = "Bavistin",
            ["dose"] = "25",
            ["unit"] = "g"
            // no provenance, no assumedCarrier
        };

        var root = new JsonObject
        {
            ["inputs"] = new JsonArray { inputRow }
        };

        ProvenanceTagger.Stamp(root);

        var provenance = inputRow["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("spoken", provenance, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Test 7: irrigation row with provenance already "spoken" is preserved
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_IrrigationRow_SpokenProvenance_IsPreserved()
    {
        // WaterRoleClassifier stamps irrigation rows with provenance="spoken".
        // ProvenanceTagger must not overwrite it.
        var irrigationRow = new JsonObject
        {
            ["method"] = "drip",
            ["durationHours"] = 4,
            ["source"] = "transcript",
            ["provenance"] = "spoken"
        };

        var root = new JsonObject
        {
            ["irrigation"] = new JsonArray { irrigationRow }
        };

        ProvenanceTagger.Stamp(root);

        var provenance = irrigationRow["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("spoken", provenance, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Test 8: confirmed provenance is never set by this tagger
    //   (it is reserved for the confirm screen in Track C)
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_NeverSetsConfirmedProvenance()
    {
        // After stamp, no node should have provenance="confirmed"
        // (that is reserved for Track C's confirm screen).
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject
                {
                    ["normalizedProductName"] = "Ethrel",
                    ["dose"] = "4",
                    ["unit"] = "ml/L"
                }
            },
            ["irrigation"] = new JsonArray
            {
                new JsonObject { ["durationHours"] = 2 }
            },
            ["labour"] = new JsonArray
            {
                new JsonObject { ["workerCount"] = 5 }
            }
        };

        ProvenanceTagger.Stamp(root);

        AssertNoConfirmedProvenance(root);
    }

    private static void AssertNoConfirmedProvenance(JsonObject root)
    {
        foreach (var arrayKey in new[] { "inputs", "irrigation", "labour", "machinery", "activityExpenses" })
        {
            if (root[arrayKey] is not JsonArray array)
                continue;

            foreach (var node in array.OfType<JsonObject>())
            {
                var prov = node["provenance"]?.GetValue<string>() ?? "";
                Assert.False(
                    prov.Equals("confirmed", StringComparison.OrdinalIgnoreCase),
                    $"ProvenanceTagger must not set provenance='confirmed' (reserved for Track C). Found on '{arrayKey}' node.");
            }
        }
    }

    // -------------------------------------------------------------------------
    // Test 9: empty root is a no-op (no exception)
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_EmptyRoot_NoException()
    {
        var root = new JsonObject();
        var ex = Record.Exception(() => ProvenanceTagger.Stamp(root));
        Assert.Null(ex);
    }

    [Fact]
    public void Stamp_NullArrays_NoException()
    {
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["irrigation"] = new JsonArray(),
            ["labour"] = new JsonArray()
        };
        var ex = Record.Exception(() => ProvenanceTagger.Stamp(root));
        Assert.Null(ex);
    }
}
