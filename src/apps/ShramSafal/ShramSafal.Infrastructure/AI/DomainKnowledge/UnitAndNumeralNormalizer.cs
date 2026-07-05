using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 4 — UnitAndNumeralNormalizer.
//
// Normalizes dialect/STT unit and numeral forms throughout the parsed JSON,
// and identifies "X च डिझेल" / "X रुपयांचं डिझेल" as a COST, not a volume.
//
// Rules applied:
//   1. Unit aliases (on inputs[].unit / inputs[].dose fields):
//        ppf → ppm
//        मिली → ml
//        लिटर / लीटर → L
//        किलो → kg
//
//   2. Marathi fractional numerals (on inputs[].dose):
//        आरध्या / आर्ध → 0.5
//        पाव            → 0.25
//        दीड            → 1.5
//        अडीच           → 2.5
//        पाऊण           → 0.75
//
//   3. Devanagari digit map ०–९ → 0–9 (on inputs[].dose and other numeric scalars).
//
//   4. Cost-vs-quantity rule (transcript scan):
//        "<N> च(ा|े) डिझेल" or "<N> रुपयांचं डिझेल"
//        → ensures activityExpenses[] row with amount=N, provenance="spoken"
//        → forces fuelQuantity="NOT_MENTIONED" on all machinery[] rows
//        → NEVER fabricates a litre value
//
// PURE — no EF, no I/O.
internal static partial class UnitAndNumeralNormalizer
{
    // -------------------------------------------------------------------------
    // Devanagari digit map
    // -------------------------------------------------------------------------

    private static readonly (char Dev, char Ascii)[] DevanagariDigitMap =
    [
        ('०', '0'), ('१', '1'), ('२', '2'), ('३', '3'), ('४', '4'),
        ('५', '5'), ('६', '6'), ('७', '7'), ('८', '8'), ('९', '9'),
    ];

    // -------------------------------------------------------------------------
    // Unit alias map: STT/Marathi form → canonical unit
    // -------------------------------------------------------------------------

    private static readonly Dictionary<string, string> UnitAliases =
        new(StringComparer.OrdinalIgnoreCase)
        {
            // STT mishear of "ppm"
            ["ppf"] = "ppm",
            // Marathi unit forms
            ["मिली"] = "ml",
            ["लिटर"] = "L",
            ["लीटर"] = "L",
            ["किलो"] = "kg",
        };

    // -------------------------------------------------------------------------
    // Marathi fractional numeral map
    // -------------------------------------------------------------------------

    private static readonly Dictionary<string, string> FractionalNumerals =
        new(StringComparer.OrdinalIgnoreCase)
        {
            // आरध्या and आर्ध both = 0.5 (half)
            ["आरध्या"] = "0.5",
            ["आर्ध"] = "0.5",
            // पाव = 0.25 (quarter)
            ["पाव"] = "0.25",
            // दीड = 1.5 (one and a half)
            ["दीड"] = "1.5",
            // अडीच = 2.5 (two and a half)
            ["अडीच"] = "2.5",
            // पाऊण = 0.75 (three quarters)
            ["पाऊण"] = "0.75",
        };

    // -------------------------------------------------------------------------
    // Diesel cost patterns
    //
    // Matches:
    //   "<N> च डिझेल"   (N may be Devanagari or ASCII digits)
    //   "<N> चा डिझेल"
    //   "<N> चे डिझेल"
    //   "<N> रुपयांचं डिझेल"
    //
    // Captures group 1 = the numeric amount (may include Devanagari digits).
    // -------------------------------------------------------------------------

    [GeneratedRegex(
        @"([\d०-९]+)\s+(?:चा?े?|रुपयांचं)\s+डिझेल",
        RegexOptions.Compiled)]
    private static partial Regex DieselCostRegex();

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Normalizes unit and numeral fields in <paramref name="root"/> and scans
    /// <paramref name="transcript"/> for the diesel-cost pattern.
    /// </summary>
    internal static void Normalize(JsonObject root, string transcript)
    {
        // 1. Normalize inputs[] rows: units, fractional numerals, Devanagari digits
        NormalizeInputsArray(root);

        // 2. Transcript-level diesel cost pattern scan
        if (!string.IsNullOrWhiteSpace(transcript))
        {
            ApplyDieselCostRule(root, transcript);
        }
    }

    // -------------------------------------------------------------------------
    // Inputs array normalization
    // -------------------------------------------------------------------------

    private static void NormalizeInputsArray(JsonObject root)
    {
        if (root["inputs"] is not JsonArray inputs)
            return;

        foreach (var node in inputs)
        {
            if (node is not JsonObject row)
                continue;

            NormalizeRow(row);
        }
    }

    private static void NormalizeRow(JsonObject row)
    {
        // Normalize unit field
        var unit = row["unit"]?.GetValue<string>();
        if (unit is not null)
        {
            var normalizedUnit = NormalizeUnit(unit);
            if (!string.Equals(normalizedUnit, unit, StringComparison.Ordinal))
                row["unit"] = normalizedUnit;
        }

        // Normalize dose field: fractional numeral → decimal, then Devanagari → ASCII
        var dose = row["dose"]?.GetValue<string>();
        if (dose is not null)
        {
            var normalizedDose = NormalizeDose(dose);
            if (!string.Equals(normalizedDose, dose, StringComparison.Ordinal))
                row["dose"] = normalizedDose;
        }
    }

    private static string NormalizeUnit(string unit)
    {
        var trimmed = unit.Trim();

        // Check direct alias table (case-insensitive)
        if (UnitAliases.TryGetValue(trimmed, out var canonical))
            return canonical;

        return trimmed;
    }

    private static string NormalizeDose(string dose)
    {
        var trimmed = dose.Trim();

        // Check fractional numeral map first (before Devanagari digit conversion)
        if (FractionalNumerals.TryGetValue(trimmed, out var fractional))
            return fractional;

        // Convert Devanagari digits to ASCII
        var ascii = NormalizeDevanagariDigits(trimmed);
        return ascii;
    }

    // -------------------------------------------------------------------------
    // Diesel cost rule
    // -------------------------------------------------------------------------

    private static void ApplyDieselCostRule(JsonObject root, string transcript)
    {
        // Normalize Devanagari digits in transcript so the regex works uniformly
        var normalizedTranscript = NormalizeDevanagariDigits(transcript);

        var match = DieselCostRegex().Match(normalizedTranscript);
        if (!match.Success)
            return;

        // Parse the amount (already normalized to ASCII digits)
        var amountStr = match.Groups[1].Value;
        if (!decimal.TryParse(amountStr, out var amount))
            return;

        // Ensure activityExpenses[] exists and add expense row
        var expenses = EnsureArray(root, "activityExpenses");

        // Idempotency: only add if no expense row already carries this amount
        var alreadyExists = false;
        foreach (var node in expenses)
        {
            if (node is JsonObject existing
                && existing["amount"]?.ToString() == amountStr)
            {
                alreadyExists = true;
                break;
            }
        }

        if (!alreadyExists)
        {
            var expenseRow = new JsonObject
            {
                ["category"] = "fuel",
                ["description"] = "diesel",
                ["amount"] = amount,
                ["currency"] = "INR",
                ["provenance"] = "spoken",
                ["sourceText"] = match.Value
            };
            expenses.Add(expenseRow);
        }

        // Force fuelQuantity = NOT_MENTIONED on all machinery rows
        // (never let a litre figure survive when the pattern fires)
        if (root["machinery"] is JsonArray machinery)
        {
            foreach (var node in machinery)
            {
                if (node is JsonObject machRow)
                {
                    machRow["fuelQuantity"] = "NOT_MENTIONED";
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static string NormalizeDevanagariDigits(string text)
    {
        foreach (var (dev, ascii) in DevanagariDigitMap)
        {
            text = text.Replace(dev, ascii);
        }

        return text;
    }

    private static JsonArray EnsureArray(JsonObject root, string key)
    {
        if (root[key] is JsonArray existing)
            return existing;

        var arr = new JsonArray();
        root[key] = arr;
        return arr;
    }
}
