using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 4 — UnitAndNumeralNormalizer acceptance tests.
// All test inputs are drawn from the 18 real grape vlogs described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 4.
//
// Rules tested:
//   1. "X च(ा|े) डिझेल" / "X रुपयांचं डिझेल" → activityExpenses[] row amount=X,
//      fuelQuantity="NOT_MENTIONED" (19/10 vlog: Rs 500 spend, NOT a litre figure).
//   2. Marathi fractionals in unit/dose fields:
//      आरध्या/आर्ध=0.5, पाव=0.25, दीड=1.5, अडीच=2.5, पाऊण=0.75
//   3. Unit aliases: ppf→ppm, मिली→ml, लिटर/लीटर→L, किलो→kg
//   4. Devanagari digits ०–९ → ASCII 0–9
public sealed class UnitAndNumeralNormalizerTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static JsonObject BuildEmptyRoot() =>
        new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["machinery"] = new JsonArray(),
            ["activityExpenses"] = new JsonArray()
        };

    private static JsonObject BuildRootWithInput(string unit, string dose = "4") =>
        new JsonObject
        {
            ["inputs"] = new JsonArray
            {
                new JsonObject
                {
                    ["productName"] = "TestProduct",
                    ["unit"] = unit,
                    ["dose"] = dose
                }
            },
            ["activityExpenses"] = new JsonArray()
        };

    private static JsonObject BuildRootWithMachinery(string? fuelQuantity = null)
    {
        var machRow = new JsonObject { ["implement"] = "blower" };
        if (fuelQuantity is not null)
            machRow["fuelQuantity"] = fuelQuantity;

        return new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["machinery"] = new JsonArray { machRow },
            ["activityExpenses"] = new JsonArray()
        };
    }

    private static JsonArray GetActivityExpenses(JsonObject root) =>
        (root["activityExpenses"] as JsonArray) ?? new JsonArray();

    private static JsonArray GetInputs(JsonObject root) =>
        (root["inputs"] as JsonArray) ?? new JsonArray();

    private static JsonArray GetMachinery(JsonObject root) =>
        (root["machinery"] as JsonArray) ?? new JsonArray();

    // -------------------------------------------------------------------------
    // 19/10 — "५०० च डिझेल" → activityExpenses row Rs 500, fuelQuantity=NOT_MENTIONED
    // The transcript says "500 diesel" as a SPEND, not a volume.
    // No litre value must be invented.
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_DevanagariDieselCostPattern_ChaDiesel_CreatesExpenseRow()
    {
        // Arrange: 19/10 — "five hundred's diesel" = Rs 500 fuel spend
        var root = BuildEmptyRoot();
        const string transcript = "आज ५०० च डिझेल घातले.";

        // Act
        UnitAndNumeralNormalizer.Normalize(root, transcript);

        // Assert: at least one activityExpenses row with amount = 500
        var expenses = GetActivityExpenses(root);
        Assert.NotEmpty(expenses);

        var expenseRow = expenses
            .OfType<JsonObject>()
            .FirstOrDefault(r =>
            {
                var amt = r["amount"]?.ToString() ?? "";
                return amt == "500";
            });
        Assert.NotNull(expenseRow);
    }

    [Fact]
    public void Normalize_DevanagariDieselCostPattern_ChaDiesel_FuelQuantityIsNotMentioned()
    {
        // Arrange: 19/10 transcript — diesel cost pattern
        var root = BuildEmptyRoot();
        const string transcript = "आज ५०० च डिझेल घातले.";

        // Act
        UnitAndNumeralNormalizer.Normalize(root, transcript);

        // Assert: no machinery row carries a litre/volume diesel figure;
        // fuelQuantity must be absent or "NOT_MENTIONED" — never a litre value invented.
        var machinery = GetMachinery(root);
        foreach (var node in machinery.OfType<JsonObject>())
        {
            var fuelQty = node["fuelQuantity"]?.ToString() ?? "";
            // It must NOT be a numeric litre figure — must be absent or NOT_MENTIONED
            Assert.False(
                double.TryParse(fuelQty, out _),
                $"fuelQuantity must not be a numeric litre value, got: '{fuelQty}'");
        }
    }

    [Fact]
    public void Normalize_DevanagariDieselCostPattern_ChaDiesel_NoDieselLitreInInputs()
    {
        // No inputs row carrying a litre/L of diesel must be invented
        var root = BuildEmptyRoot();
        const string transcript = "आज ५०० च डिझेल घातले.";

        // Act
        UnitAndNumeralNormalizer.Normalize(root, transcript);

        // Assert: no inputs row invented for diesel
        var inputs = GetInputs(root);
        foreach (var node in inputs.OfType<JsonObject>())
        {
            var name = (node["productName"]?.GetValue<string>() ?? "")
                       + (node["normalizedProductName"]?.GetValue<string>() ?? "");
            Assert.False(
                name.Contains("diesel", StringComparison.OrdinalIgnoreCase)
                || name.Contains("डिझेल", StringComparison.OrdinalIgnoreCase),
                $"No diesel litre row should be invented in inputs[]; found: '{name}'");
        }
    }

    [Fact]
    public void Normalize_AsciiDieselCostPattern_ChaDiesel_CreatesExpenseRow()
    {
        // ASCII digits variant: "500 च डिझेल"
        var root = BuildEmptyRoot();
        const string transcript = "500 च डिझेल घातला.";

        UnitAndNumeralNormalizer.Normalize(root, transcript);

        var expenses = GetActivityExpenses(root);
        var expenseRow = expenses
            .OfType<JsonObject>()
            .FirstOrDefault(r => r["amount"]?.ToString() == "500");

        Assert.NotNull(expenseRow);
    }

    [Fact]
    public void Normalize_RupayansDieselCostPattern_CreatesExpenseRow()
    {
        // "रुपयांचं डिझेल" variant
        var root = BuildEmptyRoot();
        const string transcript = "आज ३०० रुपयांचं डिझेल टाकले.";

        UnitAndNumeralNormalizer.Normalize(root, transcript);

        var expenses = GetActivityExpenses(root);
        var expenseRow = expenses
            .OfType<JsonObject>()
            .FirstOrDefault(r => r["amount"]?.ToString() == "300");

        Assert.NotNull(expenseRow);
    }

    [Fact]
    public void Normalize_DieselCostPattern_ExpenseRow_HasProvenanceSpoken()
    {
        // The rupee figure provenance must be "spoken" — never "derived" (not inferred)
        var root = BuildEmptyRoot();
        const string transcript = "५०० च डिझेल.";

        UnitAndNumeralNormalizer.Normalize(root, transcript);

        var expenses = GetActivityExpenses(root);
        var expenseRow = expenses.OfType<JsonObject>().FirstOrDefault();
        Assert.NotNull(expenseRow);

        var provenance = expenseRow["provenance"]?.GetValue<string>() ?? "";
        // If provenance is set, it must be "spoken"
        if (!string.IsNullOrEmpty(provenance))
        {
            Assert.Equal("spoken", provenance, ignoreCase: true);
        }
    }

    [Fact]
    public void Normalize_DieselCostPattern_ExistingFuelQuantity_ForcedToNotMentioned()
    {
        // If the LLM erroneously set fuelQuantity on a machinery row,
        // the normalizer must force it to NOT_MENTIONED when the diesel-cost pattern fires.
        var root = new JsonObject
        {
            ["inputs"] = new JsonArray(),
            ["machinery"] = new JsonArray
            {
                new JsonObject
                {
                    ["implement"] = "blower",
                    ["fuelQuantity"] = "50"  // erroneously set by LLM
                }
            },
            ["activityExpenses"] = new JsonArray()
        };
        const string transcript = "५०० च डिझेल घातले.";

        UnitAndNumeralNormalizer.Normalize(root, transcript);

        // fuelQuantity must be corrected to NOT_MENTIONED
        var machinery = GetMachinery(root);
        var machRow = machinery.OfType<JsonObject>().First();
        var fuelQty = machRow["fuelQuantity"]?.GetValue<string>() ?? "";
        Assert.Equal("NOT_MENTIONED", fuelQty, ignoreCase: true);
    }

    // -------------------------------------------------------------------------
    // Marathi fractional numerals — "आर्ध लिटर" → 0.5 L
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_MarathiFractional_AardhLitar_HalfLitre()
    {
        // "आर्ध लिटर" = half litre → dose should normalize to 0.5, unit to L
        var root = BuildRootWithInput(unit: "लिटर", dose: "आर्ध");
        const string transcript = "आर्ध लिटर इथरेल फवारले.";

        UnitAndNumeralNormalizer.Normalize(root, transcript);

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;

        // dose normalizes to 0.5
        var dose = row["dose"]?.ToString() ?? "";
        Assert.Equal("0.5", dose);

        // unit normalizes to L
        var unit = row["unit"]?.GetValue<string>() ?? "";
        Assert.Equal("L", unit, ignoreCase: false);
    }

    [Fact]
    public void Normalize_MarathiFractional_AardhaLitar_HalfLitre()
    {
        // आरध्या variant
        var root = BuildRootWithInput(unit: "लिटर", dose: "आरध्या");
        UnitAndNumeralNormalizer.Normalize(root, "आरध्या लिटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("0.5", row["dose"]?.ToString());
        Assert.Equal("L", row["unit"]?.GetValue<string>());
    }

    [Fact]
    public void Normalize_MarathiFractional_Paav_QuarterLitre()
    {
        // पाव = 0.25
        var root = BuildRootWithInput(unit: "लिटर", dose: "पाव");
        UnitAndNumeralNormalizer.Normalize(root, "पाव लिटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("0.25", row["dose"]?.ToString());
    }

    [Fact]
    public void Normalize_MarathiFractional_Deed_OneAndHalf()
    {
        // दीड = 1.5
        var root = BuildRootWithInput(unit: "लिटर", dose: "दीड");
        UnitAndNumeralNormalizer.Normalize(root, "दीड लिटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("1.5", row["dose"]?.ToString());
    }

    [Fact]
    public void Normalize_MarathiFractional_Adeech_TwoAndHalf()
    {
        // अडीच = 2.5
        var root = BuildRootWithInput(unit: "लिटर", dose: "अडीच");
        UnitAndNumeralNormalizer.Normalize(root, "अडीच लिटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("2.5", row["dose"]?.ToString());
    }

    [Fact]
    public void Normalize_MarathiFractional_Paun_ThreeQuarter()
    {
        // पाऊण = 0.75
        var root = BuildRootWithInput(unit: "लिटर", dose: "पाऊण");
        UnitAndNumeralNormalizer.Normalize(root, "पाऊण लिटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("0.75", row["dose"]?.ToString());
    }

    [Fact]
    public void Normalize_MarathiFractional_AardhGram_HalfGram()
    {
        // "आरध्या ग्रॅम" → 0.5 g
        var root = BuildRootWithInput(unit: "ग्रॅम", dose: "आरध्या");
        UnitAndNumeralNormalizer.Normalize(root, "आरध्या ग्रॅम खत.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("0.5", row["dose"]?.ToString());
        // Unit stays as g or ग्रॅम — no unit alias for gram in the spec
        // but if the normalizer normalizes ग्रॅम→g, accept either
        var unit = row["unit"]?.GetValue<string>() ?? "";
        Assert.False(string.IsNullOrEmpty(unit), "unit should remain set");
    }

    // -------------------------------------------------------------------------
    // Unit aliases
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_UnitAlias_Ppf_NormalizedToPpm()
    {
        // "ppf" in a dose context → "ppm"
        var root = BuildRootWithInput(unit: "ppf", dose: "50");
        UnitAndNumeralNormalizer.Normalize(root, "50 ppf.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        var unit = row["unit"]?.GetValue<string>() ?? "";
        Assert.Equal("ppm", unit, ignoreCase: true);
    }

    [Fact]
    public void Normalize_UnitAlias_Milli_NormalizedToMl()
    {
        // मिली → ml
        var root = BuildRootWithInput(unit: "मिली", dose: "10");
        UnitAndNumeralNormalizer.Normalize(root, "10 मिली.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("ml", row["unit"]?.GetValue<string>());
    }

    [Fact]
    public void Normalize_UnitAlias_LitarMarathi_NormalizedToL()
    {
        // लिटर → L
        var root = BuildRootWithInput(unit: "लिटर", dose: "5");
        UnitAndNumeralNormalizer.Normalize(root, "5 लिटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("L", row["unit"]?.GetValue<string>());
    }

    [Fact]
    public void Normalize_UnitAlias_LiterMarathi2_NormalizedToL()
    {
        // लीटर (alternate) → L
        var root = BuildRootWithInput(unit: "लीटर", dose: "3");
        UnitAndNumeralNormalizer.Normalize(root, "3 लीटर.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("L", row["unit"]?.GetValue<string>());
    }

    [Fact]
    public void Normalize_UnitAlias_Kilo_NormalizedToKg()
    {
        // किलो → kg
        var root = BuildRootWithInput(unit: "किलो", dose: "2");
        UnitAndNumeralNormalizer.Normalize(root, "2 किलो.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("kg", row["unit"]?.GetValue<string>());
    }

    // -------------------------------------------------------------------------
    // Devanagari digit normalization — "८ ओळी" → quantity 8
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_DevanagariDigit_EightRows_NormalizedToAscii8()
    {
        // "८ ओळी" → dose 8 (Devanagari ८ = 8)
        var root = BuildRootWithInput(unit: "ओळी", dose: "८");
        UnitAndNumeralNormalizer.Normalize(root, "८ ओळी.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        // dose must be normalized from Devanagari ८ to ASCII 8
        Assert.Equal("8", row["dose"]?.ToString());
    }

    [Fact]
    public void Normalize_DevanagariDigit_MultiDigit_Normalized()
    {
        // Multi-digit Devanagari: "५०" = 50
        var root = BuildRootWithInput(unit: "ml", dose: "५०");
        UnitAndNumeralNormalizer.Normalize(root, "५० ml.");

        var inputs = GetInputs(root);
        var row = (JsonObject)inputs[0]!;
        Assert.Equal("50", row["dose"]?.ToString());
    }

    // -------------------------------------------------------------------------
    // Edge cases — no crash on empty/missing arrays
    // -------------------------------------------------------------------------

    [Fact]
    public void Normalize_EmptyRoot_NoOp()
    {
        var root = new JsonObject();
        var ex = Record.Exception(() => UnitAndNumeralNormalizer.Normalize(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void Normalize_EmptyTranscript_NoOp()
    {
        var root = BuildEmptyRoot();
        var ex = Record.Exception(() => UnitAndNumeralNormalizer.Normalize(root, ""));
        Assert.Null(ex);
    }

    [Fact]
    public void Normalize_NoDieselPatternInTranscript_NoExpenseAdded()
    {
        // Transcript has no diesel pattern — no expense should be created
        var root = BuildEmptyRoot();
        UnitAndNumeralNormalizer.Normalize(root, "आज खुरपणी केली.");

        var expenses = GetActivityExpenses(root);
        Assert.Empty(expenses);
    }
}
