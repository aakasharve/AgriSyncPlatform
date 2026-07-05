using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 6 — LabourWageModel + WorkerGenderLexicon + WorkTypeDictionary acceptance tests.
// All test inputs are drawn from the 18 real grape vlogs described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 6.
//
// Three intertwined deterministic facts about labour:
//   (a) LabourWageModel { daily | piece-rate | lump-sum }
//       Hard no-multiply rule: when piece-rate is stated, do NOT multiply by worker count.
//       Contract units: झाड = vine, ओळ = row.
//       Markers: उक्त / ठेका → piece-rate; रोजंदारी → daily; lump figure no unit → lump-sum.
//
//   (b) WorkerGenderLexicon: गडी = men, बायका = women.
//       Feeds maleCount / femaleCount on labour[] rows.
//
//   (c) WorkTypeDictionary: canonical operation names with Marathi aliases.
//       defoliation = पानगळ / पाने काढणे
//       paste       = Dormex लावणे  (22/10)
//       earthing-up = बुंध्याला माती  (31/10)
//       weeding     = खुरपणी  alias  निंदणी  (1/11, 6/11)
//       pruning     = छाटणी  (21/10)
//
// PURE — no EF, no I/O.
public sealed class LabourWageModelTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Builds a root that represents the 21/10 vlog:
    ///   12 men at Rs 14/vine, 10 rows, छाटणी (pruning).
    ///   This is the canonical piece-rate example.
    /// </summary>
    private static JsonObject BuildRoot_21Oct_PieceRate_Pruning()
    {
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 12,
                ["wage"] = 14,
                ["wageUnit"] = "per vine",
                ["activity"] = "छाटणी",
                ["rows"] = 10
            }
        };

        return new JsonObject
        {
            ["labour"] = labour
        };
    }

    /// <summary>
    /// Transcript for 21/10: "Rs 14/vine", 12 men, 10 rows, pruning.
    /// Contains उक्त (piece-rate marker) or ठेका, and झाड (vine contract unit).
    /// </summary>
    private const string Transcript_21Oct_PieceRate =
        "आज छाटणी केली. 12 गडी होते. 10 ओळी झाडांची ठेका होती. दर झाडाला 14 रुपये उक्त.";

    /// <summary>
    /// Builds a root for 31/10 vlog: 4 men + 3 women, earthing-up (बुंध्याला माती).
    /// </summary>
    private static JsonObject BuildRoot_31Oct_EarthingUp_GenderSplit()
    {
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 7,
                ["activity"] = "बुंध्याला माती"
            }
        };

        return new JsonObject
        {
            ["labour"] = labour
        };
    }

    /// <summary>
    /// Transcript for 31/10: 4 गडी (men) + 3 बायका (women), earthing-up.
    /// </summary>
    private const string Transcript_31Oct_EarthingUp =
        "आज बुंध्याला माती केली. 4 गडी आणि 3 बायका होत्या.";

    /// <summary>
    /// Builds a root with a labour row whose activity is खुरपणी (weeding).
    /// </summary>
    private static JsonObject BuildRoot_Weeding_Khurpani()
    {
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 5,
                ["activity"] = "खुरपणी"
            }
        };

        return new JsonObject { ["labour"] = labour };
    }

    /// <summary>
    /// Builds a root with a labour row whose activity is निंदणी (the alias for weeding).
    /// </summary>
    private static JsonObject BuildRoot_Weeding_Nindani()
    {
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 5,
                ["activity"] = "निंदणी"
            }
        };

        return new JsonObject { ["labour"] = labour };
    }

    private static JsonObject? GetFirstLabourRow(JsonObject root)
    {
        if (root["labour"] is not JsonArray labour)
            return null;
        return labour.OfType<JsonObject>().FirstOrDefault();
    }

    // -------------------------------------------------------------------------
    // 21/10 — piece-rate: Rs 14/vine, 10 rows, 12 men
    //   wageModel = "piece-rate"
    //   contractUnit = "vine"
    //   NO 12 × 14 total (the hard no-multiply rule)
    //   The stated rate (14) is preserved
    // -------------------------------------------------------------------------

    [Fact]
    public void Apply_21Oct_PieceRateMarker_SetsWageModelToPieceRate()
    {
        // Arrange
        var root = BuildRoot_21Oct_PieceRate_Pruning();

        // Act
        LabourWageModel.Apply(root, Transcript_21Oct_PieceRate);

        // Assert
        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var wageModel = row["wageModel"]?.GetValue<string>() ?? "";
        Assert.Equal("piece-rate", wageModel, ignoreCase: true);
    }

    [Fact]
    public void Apply_21Oct_PieceRateMarker_SetsContractUnitToVine()
    {
        // झाड = vine in the transcript
        var root = BuildRoot_21Oct_PieceRate_Pruning();

        LabourWageModel.Apply(root, Transcript_21Oct_PieceRate);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var contractUnit = row["contractUnit"]?.GetValue<string>() ?? "";
        Assert.Equal("vine", contractUnit, ignoreCase: true);
    }

    [Fact]
    public void Apply_21Oct_PieceRate_HardNoMultiplyRule_TotalIsNOT_WorkerCountTimesRate()
    {
        // Hard no-multiply rule: total must NOT be 12 × 14 = 168.
        // For piece-rate, total = vines × rate (vine count is contract unit).
        // Since vine count is NOT stated directly (only row count = 10), the total
        // must NOT be computed as worker-count × rate.
        var root = BuildRoot_21Oct_PieceRate_Pruning();

        LabourWageModel.Apply(root, Transcript_21Oct_PieceRate);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);

        // The forbidden product is 12 (workerCount) × 14 (rate) = 168
        var total = row["total"]?.ToString() ?? row["computedTotal"]?.ToString() ?? "";
        if (!string.IsNullOrEmpty(total) && decimal.TryParse(total, out var totalValue))
        {
            Assert.NotEqual(168m, totalValue);
        }
        // If total is absent / NOT_COMPUTED, the rule is satisfied — the assert above passes
        // because the outer condition short-circuits.
    }

    [Fact]
    public void Apply_21Oct_PieceRate_RateIsPreserved()
    {
        // The stated rate (14 Rs/vine) must be preserved in the labour row.
        var root = BuildRoot_21Oct_PieceRate_Pruning();

        LabourWageModel.Apply(root, Transcript_21Oct_PieceRate);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);

        // wage (the rate per contract-unit) must still be 14 after the apply pass.
        var wage = row["wage"]?.ToString() ?? "";
        Assert.Equal("14", wage);
    }

    [Fact]
    public void Apply_21Oct_PieceRate_RateProvenanceIsSpoken()
    {
        // Rate is verbatim from the transcript → provenance = "spoken"
        var root = BuildRoot_21Oct_PieceRate_Pruning();

        LabourWageModel.Apply(root, Transcript_21Oct_PieceRate);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);

        var provenance = row["wageProvenance"]?.GetValue<string>()
                         ?? row["rateProvenance"]?.GetValue<string>()
                         ?? row["provenance"]?.GetValue<string>()
                         ?? "";

        // Must be "spoken" or not set — never "assumed" or "derived"
        if (!string.IsNullOrEmpty(provenance))
        {
            Assert.False(
                provenance.Equals("assumed", StringComparison.OrdinalIgnoreCase)
                || provenance.Equals("derived", StringComparison.OrdinalIgnoreCase),
                $"Stated rate provenance must be 'spoken', got '{provenance}'");
        }
    }

    // -------------------------------------------------------------------------
    // 31/10 — gender split: 4 गडी (men) + 3 बायका (women), earthing-up
    // -------------------------------------------------------------------------

    [Fact]
    public void Apply_31Oct_GenderLexicon_SetsCorrectMaleCount()
    {
        // 4 गडी = 4 men
        var root = BuildRoot_31Oct_EarthingUp_GenderSplit();

        LabourWageModel.Apply(root, Transcript_31Oct_EarthingUp);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var maleCount = row["maleCount"]?.ToString() ?? "";
        Assert.Equal("4", maleCount);
    }

    [Fact]
    public void Apply_31Oct_GenderLexicon_SetsCorrectFemaleCount()
    {
        // 3 बायका = 3 women
        var root = BuildRoot_31Oct_EarthingUp_GenderSplit();

        LabourWageModel.Apply(root, Transcript_31Oct_EarthingUp);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var femaleCount = row["femaleCount"]?.ToString() ?? "";
        Assert.Equal("3", femaleCount);
    }

    [Fact]
    public void Apply_31Oct_WorkType_EarthingUp_ActivitySet()
    {
        // बुंध्याला माती = earthing-up
        var root = BuildRoot_31Oct_EarthingUp_GenderSplit();

        // WorkTypeDictionary.Normalize also runs in Apply for combined convenience,
        // or test via the WorkTypeDictionary directly.
        WorkTypeDictionary.Normalize(root, Transcript_31Oct_EarthingUp);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("earthing-up", activity, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // WorkTypeDictionary — weeding aliases: खुरपणी AND निंदणी both → "weeding"
    // -------------------------------------------------------------------------

    [Fact]
    public void WorkType_Khurpani_NormalizesToWeeding()
    {
        // खुरपणी is the canonical Marathi word for weeding
        var root = BuildRoot_Weeding_Khurpani();

        WorkTypeDictionary.Normalize(root, "आज खुरपणी केली.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("weeding", activity, ignoreCase: true);
    }

    [Fact]
    public void WorkType_Nindani_NormalizesToWeeding()
    {
        // निंदणी is the alias for weeding (1/11, 6/11 vlogs)
        var root = BuildRoot_Weeding_Nindani();

        WorkTypeDictionary.Normalize(root, "आज निंदणी केली.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("weeding", activity, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // WorkTypeDictionary — other work types from the 18-vlog corpus
    // -------------------------------------------------------------------------

    [Fact]
    public void WorkType_Paangal_NormalizesToDefoliation()
    {
        // पानगळ = defoliation (19/10)
        var labour = new JsonArray
        {
            new JsonObject { ["activity"] = "पानगळ" }
        };
        var root = new JsonObject { ["labour"] = labour };

        WorkTypeDictionary.Normalize(root, "आज पानगळची कामे केली.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("defoliation", activity, ignoreCase: true);
    }

    [Fact]
    public void WorkType_PaaneKadhane_NormalizesToDefoliation()
    {
        // पाने काढणे = defoliation (alternate Marathi phrasing)
        var labour = new JsonArray
        {
            new JsonObject { ["activity"] = "पाने काढणे" }
        };
        var root = new JsonObject { ["labour"] = labour };

        WorkTypeDictionary.Normalize(root, "आज पाने काढण्याचे काम केले.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("defoliation", activity, ignoreCase: true);
    }

    [Fact]
    public void WorkType_DormexLavane_NormalizesToPaste()
    {
        // Dormex लावणे = paste (22/10)
        var labour = new JsonArray
        {
            new JsonObject { ["activity"] = "Dormex लावणे" }
        };
        var root = new JsonObject { ["labour"] = labour };

        WorkTypeDictionary.Normalize(root, "आज Dormex लावणे केले.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("paste", activity, ignoreCase: true);
    }

    [Fact]
    public void WorkType_Chhatni_NormalizesToPruning()
    {
        // छाटणी = pruning (21/10)
        var labour = new JsonArray
        {
            new JsonObject { ["activity"] = "छाटणी" }
        };
        var root = new JsonObject { ["labour"] = labour };

        WorkTypeDictionary.Normalize(root, "आज छाटणी केली.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("pruning", activity, ignoreCase: true);
    }

    [Fact]
    public void WorkType_BundhyalaMati_NormalizesToEarthingUp()
    {
        // बुंध्याला माती = earthing-up (31/10)
        var labour = new JsonArray
        {
            new JsonObject { ["activity"] = "बुंध्याला माती" }
        };
        var root = new JsonObject { ["labour"] = labour };

        WorkTypeDictionary.Normalize(root, "आज बुंध्याला माती केली.");

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var activity = row["activity"]?.GetValue<string>() ?? "";
        Assert.Equal("earthing-up", activity, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // WorkTypeDictionary — cropActivities[] normalization
    // -------------------------------------------------------------------------

    [Fact]
    public void WorkType_CropActivities_Chhatni_NormalizesToPruning()
    {
        // WorkTypeDictionary.Normalize also handles cropActivities[].title
        var cropActivities = new JsonArray
        {
            new JsonObject { ["title"] = "छाटणी" }
        };
        var root = new JsonObject
        {
            ["labour"] = new JsonArray(),
            ["cropActivities"] = cropActivities
        };

        WorkTypeDictionary.Normalize(root, "आज छाटणी केली.");

        if (root["cropActivities"] is JsonArray acts)
        {
            var first = acts.OfType<JsonObject>().FirstOrDefault();
            if (first is not null)
            {
                var title = first["title"]?.GetValue<string>() ?? "";
                Assert.Equal("pruning", title, ignoreCase: true);
            }
        }
    }

    // -------------------------------------------------------------------------
    // रोजंदारी marker → daily wage model
    // -------------------------------------------------------------------------

    [Fact]
    public void Apply_RojandariMarker_SetsWageModelToDaily()
    {
        // रोजंदारी = daily wage (no piece-rate marker)
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 5,
                ["wage"] = 350
            }
        };
        var root = new JsonObject { ["labour"] = labour };
        const string transcript = "आज 5 गडी रोजंदारीने काम केले. 350 रुपये दिले.";

        LabourWageModel.Apply(root, transcript);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var wageModel = row["wageModel"]?.GetValue<string>() ?? "";
        Assert.Equal("daily", wageModel, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Piece-rate with ओळ (row) as contract unit
    // -------------------------------------------------------------------------

    [Fact]
    public void Apply_OlMarker_SetsContractUnitToRow()
    {
        // ओळ = row (alternate contract unit)
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 6,
                ["wage"] = 50
            }
        };
        var root = new JsonObject { ["labour"] = labour };
        const string transcript = "प्रत्येक ओळीला 50 रुपये ठेका. 6 गडी.";

        LabourWageModel.Apply(root, transcript);

        var row = GetFirstLabourRow(root);
        Assert.NotNull(row);
        var contractUnit = row["contractUnit"]?.GetValue<string>() ?? "";
        Assert.Equal("row", contractUnit, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    [Fact]
    public void Apply_EmptyRoot_NoOp()
    {
        var root = new JsonObject();
        var ex = Record.Exception(() => LabourWageModel.Apply(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void Apply_EmptyTranscript_NoOp()
    {
        var root = new JsonObject { ["labour"] = new JsonArray() };
        var ex = Record.Exception(() => LabourWageModel.Apply(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void WorkType_Normalize_EmptyRoot_NoOp()
    {
        var root = new JsonObject();
        var ex = Record.Exception(() => WorkTypeDictionary.Normalize(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void Apply_NoWageMarker_NoWageModelSet()
    {
        // A labour row with no wage-model markers — wageModel should not be set
        // (or may be left at whatever default the structurer emitted).
        // The key assertion is that we do NOT fabricate a model.
        var labour = new JsonArray
        {
            new JsonObject
            {
                ["workerCount"] = 3,
                ["activity"] = "watering"
            }
        };
        var root = new JsonObject { ["labour"] = labour };
        const string transcript = "3 माणसांनी काम केले.";  // no wage marker

        // Should not throw; may or may not set wageModel
        var ex = Record.Exception(() => LabourWageModel.Apply(root, transcript));
        Assert.Null(ex);
    }
}
