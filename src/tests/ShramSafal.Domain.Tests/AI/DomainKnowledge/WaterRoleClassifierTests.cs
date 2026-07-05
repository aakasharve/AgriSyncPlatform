using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 5 — WaterRoleClassifier acceptance tests.
// All test inputs are drawn from the 18 real grape vlogs described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 5.
//
// Decision rules:
//   spray verb (फवारणी/मारल) + machine (blower/pump) + litre carrier volume
//       → sprayCarrier (volume belongs on the input row's carrier fields, NOT irrigation[])
//   duration in hours + source (motor/नेहमी प्रमाणे) + no spray verb
//       → irrigation
//   WSF/NPK grade present + drip/water + no spray verb
//       → fertigation
//
// The classifier runs AFTER the existing irrigation safety-net (which may have
// injected a Flood irrigation[] row) and DEMOTES that row to carrier when a
// spray verb + litre volume dominate.
public sealed class WaterRoleClassifierTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Builds a root with an inputs[] array containing one Ethrel row (19/10 vlog
    /// post-lexicon state), an empty irrigation[], and a machinery[] row
    /// representing the blower with a 1000 L carrier mention.
    /// The transcript carries the spray verb फवारणी and "1000 लिटर".
    /// </summary>
    private static JsonObject BuildRoot_19Oct_SprayCarrier_NoIrrigation()
    {
        var inputs = new JsonArray
        {
            new JsonObject
            {
                ["productName"] = "इथरेल",
                ["rawProductName"] = "इथरेल",
                ["normalizedProductName"] = "Ethrel",
                ["dose"] = "4",
                ["unit"] = "ml",
                ["confirmationStatus"] = "auto_normalized"
            }
        };

        var machinery = new JsonArray
        {
            new JsonObject
            {
                ["implement"] = "blower",
                ["nozzlesActive"] = 10
            }
        };

        return new JsonObject
        {
            ["inputs"] = inputs,
            ["irrigation"] = new JsonArray(),
            ["machinery"] = machinery
        };
    }

    /// <summary>
    /// Builds a root that simulates the irrigation safety-net having ALREADY
    /// injected a Flood irrigation row — used for the demotion test.
    /// A spray verb + 1000 L in the transcript should cause the classifier to
    /// demote this injected row to a carrier reference on the Ethrel input.
    /// </summary>
    private static JsonObject BuildRoot_DemotionCase_FloodIrrigationInjectedButSprayDominates()
    {
        var inputs = new JsonArray
        {
            new JsonObject
            {
                ["productName"] = "इथरेल",
                ["rawProductName"] = "इथरेल",
                ["normalizedProductName"] = "Ethrel",
                ["dose"] = "4",
                ["unit"] = "ml"
            }
        };

        // Simulates the irrigation safety-net having injected a Flood row
        var irrigationInjected = new JsonArray
        {
            new JsonObject
            {
                ["method"] = "Flood",
                ["durationHours"] = 0,
                ["source"] = "injected-by-safety-net"
            }
        };

        var machinery = new JsonArray
        {
            new JsonObject { ["implement"] = "blower" }
        };

        return new JsonObject
        {
            ["inputs"] = inputs,
            ["irrigation"] = irrigationInjected,
            ["machinery"] = machinery
        };
    }

    /// <summary>
    /// Builds a root for the 23/10 irrigation case: "नेहमी प्रमाणे" 4 hr, no spray verb.
    /// No spray machine, no inputs requiring carrier water.
    /// </summary>
    private static JsonObject BuildRoot_23Oct_Irrigation_NehmiPramane_4Hr()
    {
        return new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["irrigation"] = new JsonArray(),
            ["machinery"] = new JsonArray()
        };
    }

    /// <summary>
    /// Builds a root for the 28/10 fertigation case: 19-19-19 NPK grade
    /// present (from NpkGradeDictionary) + drip/water, no spray verb.
    /// </summary>
    private static JsonObject BuildRoot_28Oct_Fertigation_NPKGrade()
    {
        var inputs = new JsonArray
        {
            new JsonObject
            {
                ["normalizedProductName"] = "19-19-19 balanced NPK WSF",
                ["rawProductName"] = "19:19:19",
                ["provenance"] = "derived"
            }
        };

        return new JsonObject
        {
            ["inputs"] = inputs,
            ["irrigation"] = new JsonArray(),
            ["machinery"] = new JsonArray()
        };
    }

    private static JsonArray GetIrrigation(JsonObject root) =>
        (root["irrigation"] as JsonArray) ?? new JsonArray();

    private static JsonArray GetInputs(JsonObject root) =>
        (root["inputs"] as JsonArray) ?? new JsonArray();

    // -------------------------------------------------------------------------
    // 19/10 — 1000 L + blower + Ethrel, spray verb in transcript
    // Expectation: carrier fields set on the Ethrel input row; irrigation[] empty
    // -------------------------------------------------------------------------

    [Fact]
    public void Classify_19Oct_SprayVerb_BlowerAndLitreCarrier_IrrigationEmpty()
    {
        // Arrange: 19/10 — Ethrel spray, blower 10 guns, 1000 L carrier volume
        // Spray verb "फवारणी" present; no hours/motor → must be sprayCarrier, NOT irrigation.
        var root = BuildRoot_19Oct_SprayCarrier_NoIrrigation();
        const string transcript =
            "आज इथरेलची फवारणी केली. बलोवेर ने 1000 लिटर पाण्यात 4 ml प्रति लिटर दिले.";

        // Act
        WaterRoleClassifier.Classify(root, transcript);

        // Assert: irrigation[] must remain empty (1000 L is spray carrier, not irrigation)
        var irrigation = GetIrrigation(root);
        Assert.Empty(irrigation);
    }

    [Fact]
    public void Classify_19Oct_SprayVerb_BlowerAndLitreCarrier_EthrelRowHasCarrierFields()
    {
        // Arrange
        var root = BuildRoot_19Oct_SprayCarrier_NoIrrigation();
        const string transcript =
            "आज इथरेलची फवारणी केली. बलोवेर ने 1000 लिटर पाण्यात 4 ml प्रति लिटर दिले.";

        // Act
        WaterRoleClassifier.Classify(root, transcript);

        // Assert: the Ethrel input row should carry carrier-related fields
        var inputs = GetInputs(root);
        var ethrelRow = inputs
            .OfType<JsonObject>()
            .FirstOrDefault(r =>
                (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Contains("Ethrel", StringComparison.OrdinalIgnoreCase));

        Assert.NotNull(ethrelRow);

        // The row should have a waterRole or carrierVolume or carrierUnit field
        // indicating sprayCarrier classification.
        var waterRole = ethrelRow["waterRole"]?.GetValue<string>() ?? "";
        var carrierVol = ethrelRow["carrierVolume"]?.ToString() ?? "";
        var carrierLitres = ethrelRow["carrierLitres"]?.ToString() ?? "";

        // At least one carrier indicator must be set on the input row
        var hasCarrierIndicator =
            waterRole.Equals("sprayCarrier", StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(carrierVol)
            || !string.IsNullOrEmpty(carrierLitres);

        Assert.True(hasCarrierIndicator,
            $"Ethrel row must carry a spray carrier indicator. waterRole='{waterRole}', " +
            $"carrierVolume='{carrierVol}', carrierLitres='{carrierLitres}'");
    }

    [Fact]
    public void Classify_19Oct_SprayVerb_WithMarathi_MarlVerb_AlsoRecognized()
    {
        // "मारल" is another spray verb in Marathi (e.g. "फवारणी मारली")
        var root = BuildRoot_19Oct_SprayCarrier_NoIrrigation();
        const string transcript = "आज इथरेल मारला बलोवेर ने 1000 लिटर पाण्यात.";

        WaterRoleClassifier.Classify(root, transcript);

        var irrigation = GetIrrigation(root);
        Assert.Empty(irrigation);
    }

    // -------------------------------------------------------------------------
    // Demotion case — existing injected Flood irrigation[] row + spray verb + litre
    // Expectation: Flood row demoted (irrigation[] empty after classify)
    // -------------------------------------------------------------------------

    [Fact]
    public void Classify_DemotionCase_InjectedFloodRow_DemotedToCarrier_WhenSprayVerbAndLitreDominate()
    {
        // Arrange: safety-net has already injected a Flood irrigation row,
        // but transcript has spray verb + blower + 1000 L → spray carrier dominates.
        var root = BuildRoot_DemotionCase_FloodIrrigationInjectedButSprayDominates();
        const string transcript =
            "आज इथरेलची फवारणी केली. बलोवेर ने 1000 लिटर पाण्यात.";

        // Act
        WaterRoleClassifier.Classify(root, transcript);

        // Assert: the injected Flood row must be demoted — irrigation[] must be empty
        var irrigation = GetIrrigation(root);
        Assert.Empty(irrigation);
    }

    [Fact]
    public void Classify_DemotionCase_EthrelRowGetsCarrierMarker_AfterDemotion()
    {
        var root = BuildRoot_DemotionCase_FloodIrrigationInjectedButSprayDominates();
        const string transcript =
            "आज इथरेलची फवारणी केली. बलोवेर ने 1000 लिटर पाण्यात.";

        WaterRoleClassifier.Classify(root, transcript);

        var inputs = GetInputs(root);
        var ethrelRow = inputs
            .OfType<JsonObject>()
            .FirstOrDefault(r =>
                (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Contains("Ethrel", StringComparison.OrdinalIgnoreCase));

        Assert.NotNull(ethrelRow);

        // After demotion the input row should be marked as carrying spray carrier water
        var waterRole = ethrelRow["waterRole"]?.GetValue<string>() ?? "";
        var carrierVol = ethrelRow["carrierVolume"]?.ToString() ?? "";
        var carrierLitres = ethrelRow["carrierLitres"]?.ToString() ?? "";

        var hasCarrierIndicator =
            waterRole.Equals("sprayCarrier", StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(carrierVol)
            || !string.IsNullOrEmpty(carrierLitres);

        Assert.True(hasCarrierIndicator,
            "After demotion, Ethrel row must carry a spray carrier indicator.");
    }

    // -------------------------------------------------------------------------
    // 23/10 — "नेहमी प्रमाणे" 4 hr, no spray verb → one irrigation row 4h
    // -------------------------------------------------------------------------

    [Fact]
    public void Classify_23Oct_NehmiPramane_4Hr_NoSprayVerb_ProducesOneIrrigationRow()
    {
        // Arrange: 23/10 — irrigation as usual (नेहमी प्रमाणे), 4 hours, motor/drip
        // No spray verb, no litre carrier volume → should classify as irrigation.
        var root = BuildRoot_23Oct_Irrigation_NehmiPramane_4Hr();
        const string transcript =
            "आज नेहमी प्रमाणे 4 तास पाणी दिले. मोटर चालू होती.";

        // Act
        WaterRoleClassifier.Classify(root, transcript);

        // Assert: exactly one irrigation row with duration 4 hours
        var irrigation = GetIrrigation(root);
        Assert.Single(irrigation);

        var row = (JsonObject)irrigation[0]!;

        // durationHours must be 4
        var duration = row["durationHours"]?.ToString() ?? row["duration"]?.ToString() ?? "";
        Assert.Equal("4", duration);
    }

    [Fact]
    public void Classify_23Oct_NehmiPramane_IrrigationRow_MethodNotSpray()
    {
        var root = BuildRoot_23Oct_Irrigation_NehmiPramane_4Hr();
        const string transcript = "आज नेहमी प्रमाणे 4 तास पाणी दिले. मोटर चालू होती.";

        WaterRoleClassifier.Classify(root, transcript);

        var irrigation = GetIrrigation(root);
        var row = (JsonObject)irrigation[0]!;

        // method must not be a spray method
        var method = row["method"]?.GetValue<string>() ?? "";
        Assert.False(
            method.Equals("spray", StringComparison.OrdinalIgnoreCase),
            $"Irrigation row method should not be 'spray', got: '{method}'");
    }

    [Fact]
    public void Classify_23Oct_NehmiPramane_WithMotorKeyword_AlsoProducesIrrigationRow()
    {
        // Alternative phrasing: motor keyword + hours but no spray verb
        var root = BuildRoot_23Oct_Irrigation_NehmiPramane_4Hr();
        const string transcript = "4 तास मोटर चालवली.";

        WaterRoleClassifier.Classify(root, transcript);

        var irrigation = GetIrrigation(root);
        Assert.Single(irrigation);

        var row = (JsonObject)irrigation[0]!;
        var duration = row["durationHours"]?.ToString() ?? row["duration"]?.ToString() ?? "";
        Assert.Equal("4", duration);
    }

    // -------------------------------------------------------------------------
    // 28/10 — 19-19-19 NPK grade + water, no spray verb → fertigation
    // -------------------------------------------------------------------------

    [Fact]
    public void Classify_28Oct_NPKGrade_Water_NoSprayVerb_ProducesFertigation()
    {
        // Arrange: 28/10 — 19:19:19 WSF given via drip, no spray verb
        var root = BuildRoot_28Oct_Fertigation_NPKGrade();
        const string transcript =
            "आज 19:19:19 खत ड्रिपद्वारे दिले.";

        // Act
        WaterRoleClassifier.Classify(root, transcript);

        // Assert: the NPK input row must be tagged method="fertigation"
        // OR there is an irrigation row with method="fertigation"
        var inputs = GetInputs(root);
        var npkRow = inputs
            .OfType<JsonObject>()
            .FirstOrDefault(r =>
                (r["normalizedProductName"]?.GetValue<string>() ?? "")
                .Contains("19-19-19", StringComparison.OrdinalIgnoreCase));

        Assert.NotNull(npkRow);

        var method = npkRow["method"]?.GetValue<string>() ?? "";
        Assert.Equal("fertigation", method, ignoreCase: true);
    }

    [Fact]
    public void Classify_28Oct_NPKGrade_Water_NoSprayVerb_IrrigationArrayNotSprayCarrier()
    {
        // The water in 28/10 is fertigation, not spray carrier — irrigation[] should
        // NOT contain a spray carrier row; it may contain a fertigation row or be empty
        // (depending on implementation), but must never classify this as sprayCarrier.
        var root = BuildRoot_28Oct_Fertigation_NPKGrade();
        const string transcript = "आज 19:19:19 खत ड्रिपद्वारे दिले.";

        WaterRoleClassifier.Classify(root, transcript);

        var irrigation = GetIrrigation(root);
        foreach (var node in irrigation.OfType<JsonObject>())
        {
            var method = node["method"]?.GetValue<string>() ?? "";
            Assert.False(
                method.Equals("sprayCarrier", StringComparison.OrdinalIgnoreCase),
                "Fertigation water must not be classified as sprayCarrier in irrigation[]");
        }
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    [Fact]
    public void Classify_EmptyRoot_NoOp()
    {
        var root = new JsonObject();
        var ex = Record.Exception(() => WaterRoleClassifier.Classify(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void Classify_EmptyTranscript_NoOp()
    {
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["irrigation"] = new JsonArray(),
            ["machinery"] = new JsonArray()
        };
        var ex = Record.Exception(() => WaterRoleClassifier.Classify(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void Classify_NoSprayVerb_NoHours_NoNPK_NoChange()
    {
        // A transcript with no decision signals — nothing should change
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["irrigation"] = new JsonArray(),
            ["machinery"] = new JsonArray()
        };
        const string transcript = "आज बागेत गेलो.";  // "went to the garden today" — no water event

        WaterRoleClassifier.Classify(root, transcript);

        Assert.Empty(GetIrrigation(root));
        Assert.Empty(GetInputs(root));
    }

    [Fact]
    public void Classify_SprayVerbWithoutLitre_DoesNotInjectFabricatedVolume()
    {
        // Spray verb present but no litre figure stated — must NOT fabricate a carrier volume
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject
                {
                    ["normalizedProductName"] = "Ethrel",
                    ["rawProductName"] = "इथरेल"
                }
            },
            ["irrigation"] = new JsonArray(),
            ["machinery"] = new JsonArray { new JsonObject { ["implement"] = "blower" } }
        };
        const string transcript = "आज इथरेलची फवारणी केली.";  // No litre volume stated

        WaterRoleClassifier.Classify(root, transcript);

        // Assert: no invented litre figure on the input row
        var inputs = GetInputs(root);
        var ethrelRow = inputs.OfType<JsonObject>().First();
        var carrierVol = ethrelRow["carrierVolume"]?.ToString() ?? "";
        var carrierLitres = ethrelRow["carrierLitres"]?.ToString() ?? "";

        Assert.False(
            double.TryParse(carrierVol, out _) || double.TryParse(carrierLitres, out _),
            "Must not fabricate a carrier volume when no litre figure was stated in the transcript");
    }

    [Fact]
    public void Classify_IrrigationRow_ExistingNonFloodRow_NotDemoted_WithoutSprayEvidence()
    {
        // A genuine irrigation row (not safety-net-injected) with hours + motor
        // and NO spray verb must survive (not demoted).
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["irrigation"] = new JsonArray
            {
                new JsonObject
                {
                    ["method"] = "drip",
                    ["durationHours"] = 3,
                    ["source"] = "motor"
                }
            },
            ["machinery"] = new JsonArray()
        };
        const string transcript = "3 तास ड्रिप सुरू होते.";  // No spray verb

        WaterRoleClassifier.Classify(root, transcript);

        // Irrigation row must survive
        var irrigation = GetIrrigation(root);
        Assert.Single(irrigation);
    }
}
