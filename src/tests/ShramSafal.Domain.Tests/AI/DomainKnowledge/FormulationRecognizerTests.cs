using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 3 — FormulationRecognizer acceptance tests.
// All test inputs are drawn from the 23/10 real grape vlog described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 3.
//
// Bordeaux mixture rule: when copper-sulfate AND lime rows co-occur in
// inputs[] (as identified by normalizedProductName after the lexicon pass),
// exactly ONE synthesized "Bordeaux mixture" row is emitted with:
//   - mix[] preserving the two component rows + their doses
//   - doseBasis="per-600L" and basisUnit present
//   - provenance="derived"
// The two component rows are kept but marked partOfFormulation="Bordeaux".
public sealed class FormulationRecognizerTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Builds a root with two co-occurring inputs as the lexicon would leave them:
    /// Copper sulfate 2 kg + Lime 1 kg per 600 L (23/10 vlog).
    /// normalizedProductName is already set (post-lexicon state).
    /// </summary>
    private static JsonObject BuildRoot_CopperSulfateAndLime()
    {
        var inputs = new JsonArray
        {
            new JsonObject
            {
                ["productName"] = "मोरचुद",
                ["rawProductName"] = "मोरचुद",
                ["normalizedProductName"] = "Copper sulfate",
                ["dose"] = "2",
                ["unit"] = "kg",
                ["confirmationStatus"] = "auto_normalized"
            },
            new JsonObject
            {
                ["productName"] = "चुना",
                ["rawProductName"] = "चुना",
                ["normalizedProductName"] = "Lime",
                ["dose"] = "1",
                ["unit"] = "kg",
                ["confirmationStatus"] = "auto_normalized"
            }
        };
        return new JsonObject { ["inputs"] = inputs };
    }

    /// <summary>
    /// Builds a root with only copper-sulfate — no lime — no Bordeaux should form.
    /// </summary>
    private static JsonObject BuildRoot_CopperSulfateOnly()
    {
        var inputs = new JsonArray
        {
            new JsonObject
            {
                ["productName"] = "मोरचुद",
                ["rawProductName"] = "मोरचुद",
                ["normalizedProductName"] = "Copper sulfate",
                ["dose"] = "2",
                ["unit"] = "kg",
                ["confirmationStatus"] = "auto_normalized"
            }
        };
        return new JsonObject { ["inputs"] = inputs };
    }

    private static JsonArray GetInputs(JsonObject root) =>
        (root["inputs"] as JsonArray)!;

    // -------------------------------------------------------------------------
    // 23/10 — copper-sulfate 2 kg + lime 1 kg / 600 L → exactly one Bordeaux row
    // -------------------------------------------------------------------------

    [Fact]
    public void Recognize_CopperSulfateAndLime_EmitsExactlyOneBordeauxRow()
    {
        // Arrange: 23/10 — मोरचुद 2 kg + चुना 1 kg (post-lexicon normalized)
        var root = BuildRoot_CopperSulfateAndLime();

        // Act
        FormulationRecognizer.Recognize(root);

        // Assert: exactly ONE Bordeaux mixture row added
        var inputs = GetInputs(root);
        var bordeauxRows = inputs
            .OfType<JsonObject>()
            .Where(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.Single(bordeauxRows);
    }

    [Fact]
    public void Recognize_CopperSulfateAndLime_BordeauxRow_HasMixArrayWithBothComponents()
    {
        var root = BuildRoot_CopperSulfateAndLime();

        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        var bordeauxRow = inputs
            .OfType<JsonObject>()
            .First(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase));

        // mix[] must be present
        var mix = bordeauxRow["mix"] as JsonArray;
        Assert.NotNull(mix);
        Assert.Equal(2, mix.Count);

        // The mix[] preserves copper-sulfate component
        var mixItems = mix.OfType<JsonObject>().ToList();
        var copperItem = mixItems.FirstOrDefault(m =>
            (m["normalizedProductName"]?.GetValue<string>() ?? "")
            .Contains("Copper sulfate", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(copperItem);

        // The mix[] preserves lime component
        var limeItem = mixItems.FirstOrDefault(m =>
            (m["normalizedProductName"]?.GetValue<string>() ?? "")
            .Contains("Lime", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(limeItem);
    }

    [Fact]
    public void Recognize_CopperSulfateAndLime_MixPreservesComponentDoses_2kgAnd1kg()
    {
        var root = BuildRoot_CopperSulfateAndLime();

        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        var bordeauxRow = inputs
            .OfType<JsonObject>()
            .First(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase));

        var mix = (bordeauxRow["mix"] as JsonArray)!;
        var mixItems = mix.OfType<JsonObject>().ToList();

        // Copper sulfate dose = 2 (kg)
        var copperItem = mixItems.First(m =>
            (m["normalizedProductName"]?.GetValue<string>() ?? "")
            .Contains("Copper sulfate", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("2", copperItem["dose"]?.GetValue<string>() ?? copperItem["dose"]?.ToString());

        // Lime dose = 1 (kg)
        var limeItem = mixItems.First(m =>
            (m["normalizedProductName"]?.GetValue<string>() ?? "")
            .Contains("Lime", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("1", limeItem["dose"]?.GetValue<string>() ?? limeItem["dose"]?.ToString());
    }

    [Fact]
    public void Recognize_CopperSulfateAndLime_BordeauxRow_HasDoseBasisAndBasisUnit()
    {
        var root = BuildRoot_CopperSulfateAndLime();

        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        var bordeauxRow = inputs
            .OfType<JsonObject>()
            .First(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase));

        // doseBasis must be present and reference "per-600L" or "per 600"
        var doseBasis = bordeauxRow["doseBasis"]?.GetValue<string>() ?? "";
        Assert.False(string.IsNullOrWhiteSpace(doseBasis), "doseBasis must be set");
        Assert.Contains("600", doseBasis, StringComparison.OrdinalIgnoreCase);

        // basisUnit must be present
        var basisUnit = bordeauxRow["basisUnit"]?.GetValue<string>() ?? "";
        Assert.False(string.IsNullOrWhiteSpace(basisUnit), "basisUnit must be set");
    }

    [Fact]
    public void Recognize_CopperSulfateAndLime_BordeauxRow_HasProvenanceDerived()
    {
        var root = BuildRoot_CopperSulfateAndLime();

        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        var bordeauxRow = inputs
            .OfType<JsonObject>()
            .First(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase));

        var provenance = bordeauxRow["provenance"]?.GetValue<string>() ?? "";
        Assert.Equal("derived", provenance, ignoreCase: true);
    }

    [Fact]
    public void Recognize_CopperSulfateAndLime_ComponentRowsKeptAndMarkedPartOfFormulation()
    {
        // The component rows MUST NOT be deleted — they are marked partOfFormulation="Bordeaux"
        var root = BuildRoot_CopperSulfateAndLime();

        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        var allRows = inputs.OfType<JsonObject>().ToList();

        // At least 3 rows: copper-sulfate + lime + bordeaux
        Assert.True(allRows.Count >= 3, $"Expected >= 3 rows, got {allRows.Count}");

        // Both component rows carry partOfFormulation="Bordeaux"
        var componentRows = allRows.Where(r =>
        {
            var npn = r["normalizedProductName"]?.GetValue<string>() ?? "";
            return npn.Contains("Copper sulfate", StringComparison.OrdinalIgnoreCase)
                   || npn.Contains("Lime", StringComparison.OrdinalIgnoreCase);
        }).ToList();

        Assert.Equal(2, componentRows.Count);
        foreach (var row in componentRows)
        {
            var pof = row["partOfFormulation"]?.GetValue<string>() ?? "";
            Assert.Equal("Bordeaux", pof, ignoreCase: true);
        }
    }

    // -------------------------------------------------------------------------
    // Negative — only copper-sulfate, no lime → NO Bordeaux synthesis
    // -------------------------------------------------------------------------

    [Fact]
    public void Recognize_CopperSulfateOnly_NoBordeauxSynthesized()
    {
        // Arrange: only मोरचुद, no चुना
        var root = BuildRoot_CopperSulfateOnly();

        // Act
        FormulationRecognizer.Recognize(root);

        // Assert: no Bordeaux row
        var inputs = GetInputs(root);
        var bordeauxRows = inputs
            .OfType<JsonObject>()
            .Where(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.Empty(bordeauxRows);
    }

    [Fact]
    public void Recognize_CopperSulfateOnly_OriginalRowUnchanged()
    {
        var root = BuildRoot_CopperSulfateOnly();

        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        // Still exactly 1 row
        Assert.Single(inputs);

        var row = (JsonObject)inputs[0]!;
        Assert.Equal("Copper sulfate", row["normalizedProductName"]?.GetValue<string>());
        // partOfFormulation must NOT be set (no Bordeaux formed)
        Assert.Null(row["partOfFormulation"]);
    }

    // -------------------------------------------------------------------------
    // Edge: empty inputs — no crash, no-op
    // -------------------------------------------------------------------------

    [Fact]
    public void Recognize_EmptyInputs_NoOp()
    {
        var root = new JsonObject { ["inputs"] = new JsonArray() };

        var ex = Record.Exception(() => FormulationRecognizer.Recognize(root));
        Assert.Null(ex);
        Assert.Empty(GetInputs(root));
    }

    // -------------------------------------------------------------------------
    // Edge: missing inputs key — no crash
    // -------------------------------------------------------------------------

    [Fact]
    public void Recognize_NoInputsKey_NoOp()
    {
        var root = new JsonObject();

        var ex = Record.Exception(() => FormulationRecognizer.Recognize(root));
        Assert.Null(ex);
    }

    // -------------------------------------------------------------------------
    // Edge: calling Recognize twice is idempotent — no duplicate Bordeaux rows
    // -------------------------------------------------------------------------

    [Fact]
    public void Recognize_CalledTwice_StillExactlyOneBordeauxRow()
    {
        var root = BuildRoot_CopperSulfateAndLime();

        FormulationRecognizer.Recognize(root);
        FormulationRecognizer.Recognize(root);

        var inputs = GetInputs(root);
        var bordeauxRows = inputs
            .OfType<JsonObject>()
            .Where(r => string.Equals(
                r["normalizedProductName"]?.GetValue<string>(),
                "Bordeaux mixture",
                StringComparison.OrdinalIgnoreCase))
            .ToList();

        // Idempotency: still exactly one Bordeaux row
        Assert.Single(bordeauxRows);
    }
}
