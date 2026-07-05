using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 2 — GrapeInputLexicon acceptance tests.
// All test inputs are drawn from the 18 real grape vlogs described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 2.
public sealed class GrapeInputLexiconTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static JsonObject BuildRootWithInput(string productName)
    {
        var inputs = new JsonArray
        {
            new JsonObject { ["productName"] = productName }
        };
        return new JsonObject { ["inputs"] = inputs };
    }

    private static JsonObject BuildRootWithInputs(params string[] productNames)
    {
        var inputs = new JsonArray();
        foreach (var name in productNames)
        {
            inputs.Add(new JsonObject { ["productName"] = name });
        }
        return new JsonObject { ["inputs"] = inputs };
    }

    private static JsonArray GetInputs(JsonObject root) =>
        (root["inputs"] as JsonArray)!;

    // -------------------------------------------------------------------------
    // 24/10 — STT "aplhamitren" → Alphamethrin / insecticide, raw preserved
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_AplhamitrenSttAlias_NormalizesToAlphamethrinInsecticide()
    {
        // Arrange: STT alias "aplhamitren" as the product name in inputs[]
        var root = BuildRootWithInput("aplhamitren");

        // Act
        GrapeInputLexicon.Normalize(root);

        // Assert
        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Alphamethrin", normalized, StringComparison.OrdinalIgnoreCase);

        var chemClass = row["chemicalClass"]?.GetValue<string>() ?? "";
        Assert.Contains("insecticide", chemClass, StringComparison.OrdinalIgnoreCase);

        // Raw must be preserved
        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.Equal("aplhamitren", raw);

        var status = row["confirmationStatus"]?.GetValue<string>() ?? "";
        Assert.Equal("auto_normalized", status);
    }

    // -------------------------------------------------------------------------
    // 23/10 — Devanagari "मोरचुद" → Copper sulfate
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_Morchood_NormalizesToCopperSulfate()
    {
        var root = BuildRootWithInput("मोरचुद");

        GrapeInputLexicon.Normalize(root);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Copper sulfate", normalized, StringComparison.OrdinalIgnoreCase);

        // Raw preserved
        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.Equal("मोरचुद", raw);

        var status = row["confirmationStatus"]?.GetValue<string>() ?? "";
        Assert.Equal("auto_normalized", status);
    }

    // -------------------------------------------------------------------------
    // 26/10 — Devanagari "कर्जट" → Curzate
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_KarjatDevanagari_NormalizesToCurzate()
    {
        var root = BuildRootWithInput("कर्जट");

        GrapeInputLexicon.Normalize(root);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Curzate", normalized, StringComparison.OrdinalIgnoreCase);

        // Raw preserved
        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.Equal("कर्जट", raw);

        var status = row["confirmationStatus"]?.GetValue<string>() ?? "";
        Assert.Equal("auto_normalized", status);
    }

    // -------------------------------------------------------------------------
    // 25/10 — "6 b a" → 6-BA (cytokinin PGR)
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_SixBa_NormalizesToSixBA()
    {
        // STT may emit "6 b a" or "6ba" for 6-BA
        var root = BuildRootWithInput("6 b a");

        GrapeInputLexicon.Normalize(root);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("6-BA", normalized, StringComparison.OrdinalIgnoreCase);

        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.Equal("6 b a", raw);

        var status = row["confirmationStatus"]?.GetValue<string>() ?? "";
        Assert.Equal("auto_normalized", status);
    }

    // -------------------------------------------------------------------------
    // Regression — 27/10 "Rally Gold" with missing quantity:
    //   - rawProductName kept (≈ "Rally Gold" or STT variant)
    //   - normalizedProductName set to Rally Gold
    //   - productName MUST NOT be "खत" (the खत safety-net must not clobber it)
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_RallyGold_RawPreservedAndNotRewrittenToKhat()
    {
        // Simulate: structurer produced an inputs row with Rally Gold but qty missing.
        var root = BuildRootWithInput("Rally Gold");

        GrapeInputLexicon.Normalize(root);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        // rawProductName must be preserved
        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.False(string.IsNullOrWhiteSpace(raw), "rawProductName must be set");
        Assert.Contains("Rally", raw, StringComparison.OrdinalIgnoreCase);

        // normalizedProductName should resolve to Rally Gold (not खत)
        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Rally Gold", normalized, StringComparison.OrdinalIgnoreCase);

        // The critical regression guard: productName must NOT be "खत"
        var productName = row["productName"]?.GetValue<string>() ?? "";
        Assert.NotEqual("खत", productName);

        var status = row["confirmationStatus"]?.GetValue<string>() ?? "";
        Assert.Equal("auto_normalized", status);
    }

    [Fact]
    public void Normalize_RallyGold_SttVariant_NormalizesToRallyGold()
    {
        // STT may emit "रॅली gold" or "Rally gold" (mixed script)
        var root = BuildRootWithInput("रॅली gold");

        GrapeInputLexicon.Normalize(root);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Rally Gold", normalized, StringComparison.OrdinalIgnoreCase);

        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.False(string.IsNullOrWhiteSpace(raw));
    }

    // -------------------------------------------------------------------------
    // No-match: unknown input → rawProductName kept, confirmationStatus = "needs_confirm",
    // no chemicalClass invented
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_UnknownProduct_LeavesRawAndSetsNeedsConfirm()
    {
        // An unrecognizable input
        var root = BuildRootWithInput("xyzqwerty123unknown");

        GrapeInputLexicon.Normalize(root);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        // rawProductName must be set from productName
        var raw = row["rawProductName"]?.GetValue<string>() ?? "";
        Assert.Equal("xyzqwerty123unknown", raw);

        // confirmationStatus must be "needs_confirm"
        var status = row["confirmationStatus"]?.GetValue<string>() ?? "";
        Assert.Equal("needs_confirm", status);

        // chemicalClass must NOT be invented
        Assert.Null(row["chemicalClass"]);
        Assert.Null(row["agronomicRole"]);
    }

    // -------------------------------------------------------------------------
    // Raw always preserved: existing rawProductName is never overwritten
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_AlwaysPreservesRawProductName()
    {
        // Row already has a rawProductName set before lexicon runs
        var inputs = new JsonArray
        {
            new JsonObject
            {
                ["productName"] = "Alphamethrin",
                ["rawProductName"] = "aplhamitren"
            }
        };
        var root = new JsonObject { ["inputs"] = inputs };

        GrapeInputLexicon.Normalize(root);

        var row = (JsonObject)GetInputs(root)[0]!;
        // rawProductName must remain unchanged
        Assert.Equal("aplhamitren", row["rawProductName"]?.GetValue<string>());
    }

    // -------------------------------------------------------------------------
    // Chemical class and agronomic role set correctly for key products
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_Ethrel_NormalizesToEthephonPgr()
    {
        var root = BuildRootWithInput("ethrel");

        GrapeInputLexicon.Normalize(root);

        var row = (JsonObject)GetInputs(root)[0]!;
        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Ethrel", normalized, StringComparison.OrdinalIgnoreCase);

        var agronomicRole = row["agronomicRole"]?.GetValue<string>() ?? "";
        Assert.False(string.IsNullOrWhiteSpace(agronomicRole));
    }

    [Fact]
    public void Normalize_Dormex_NormalizesToDormex()
    {
        var root = BuildRootWithInput("dormex");

        GrapeInputLexicon.Normalize(root);

        var row = (JsonObject)GetInputs(root)[0]!;
        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Dormex", normalized, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Normalize_Bavistin_NormalizesToBavistin()
    {
        var root = BuildRootWithInput("bavistin");

        GrapeInputLexicon.Normalize(root);

        var row = (JsonObject)GetInputs(root)[0]!;
        var normalized = row["normalizedProductName"]?.GetValue<string>() ?? "";
        Assert.Contains("Bavistin", normalized, StringComparison.OrdinalIgnoreCase);

        var chemClass = row["chemicalClass"]?.GetValue<string>() ?? "";
        Assert.Contains("fungicide", chemClass, StringComparison.OrdinalIgnoreCase);
    }

    // -------------------------------------------------------------------------
    // Empty inputs array — no crash, no-op
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_EmptyInputsArray_NoOp()
    {
        var root = new JsonObject { ["inputs"] = new JsonArray() };

        // Must not throw
        var ex = Record.Exception(() => GrapeInputLexicon.Normalize(root));
        Assert.Null(ex);

        Assert.Empty(GetInputs(root));
    }

    // -------------------------------------------------------------------------
    // Missing inputs key — must not crash
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_NoInputsKey_NoOp()
    {
        var root = new JsonObject();

        var ex = Record.Exception(() => GrapeInputLexicon.Normalize(root));
        Assert.Null(ex);
    }
}
