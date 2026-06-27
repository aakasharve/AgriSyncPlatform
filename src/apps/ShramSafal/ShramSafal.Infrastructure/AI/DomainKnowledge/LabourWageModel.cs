using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 6a — LabourWageModel { daily | piece-rate | lump-sum }
//             6b — WorkerGenderLexicon (गडी=men, बायका=women)
//
// Three deterministic facts about labour:
//
// (a) Wage model detection via transcript markers:
//     उक्त / ठेका → piece-rate   (piece-work / contract)
//     रोजंदारी    → daily        (per-day wage)
//     No marker + single lump amount → lump-sum
//
// (b) Hard no-multiply rule:
//     When piece-rate is stated, do NOT multiply worker count by rate.
//     Wage total = contract-unit-count × rate.
//     Worker count is NOT the multiplier; it is a headcount.
//     Contract units: झाड = vine, ओळ = row.
//
// (c) Gender lexicon:
//     गडी    = male labourers  → maleCount
//     बायका  = female labourers → femaleCount
//     Decoupled from generic पुरुष/महिला vocabulary.
//
// Sets:
//   labour[].wageModel        ("piece-rate" | "daily" | "lump-sum")
//   labour[].contractUnit     ("vine" | "row")          — piece-rate only
//   labour[].maleCount        (integer from गडी N)
//   labour[].femaleCount      (integer from बायका N)
//   labour[].wageProvenance   ("spoken")                — for the rate value
//
// PURE — no EF, no I/O.
internal static partial class LabourWageModel
{
    // -------------------------------------------------------------------------
    // Piece-rate markers (उक्त / ठेका = "contract rate / piece-work")
    // -------------------------------------------------------------------------

    [GeneratedRegex(@"उक्त|ठेका", RegexOptions.Compiled)]
    private static partial Regex PieceRateMarkerRegex();

    // -------------------------------------------------------------------------
    // Daily wage marker (रोजंदारी = per-day wage)
    // -------------------------------------------------------------------------

    [GeneratedRegex(@"रोजंदारी", RegexOptions.Compiled)]
    private static partial Regex DailyMarkerRegex();

    // -------------------------------------------------------------------------
    // Contract unit: झाड (vine) — "per vine / per झाड"
    // -------------------------------------------------------------------------

    [GeneratedRegex(@"झाड", RegexOptions.Compiled)]
    private static partial Regex VineUnitRegex();

    // -------------------------------------------------------------------------
    // Contract unit: ओळ (row) — "per row / per ओळ"
    // -------------------------------------------------------------------------

    [GeneratedRegex(@"ओळ", RegexOptions.Compiled)]
    private static partial Regex RowUnitRegex();

    // -------------------------------------------------------------------------
    // Gender lexicon
    //   गडी + optional count before or after → maleCount
    //   बायका + optional count before or after → femaleCount
    //
    //  Patterns:
    //    "4 गडी" → maleCount = 4
    //    "गडी 4" → maleCount = 4    (alternate phrasing)
    //    "3 बायका" → femaleCount = 3
    // -------------------------------------------------------------------------

    // "N गडी" or "गडी N"
    [GeneratedRegex(@"(\d+)\s*गडी|गडी\s*(\d+)", RegexOptions.Compiled)]
    private static partial Regex MaleCountRegex();

    // "N बायका" or "बायका N"
    [GeneratedRegex(@"(\d+)\s*बायका|बायका\s*(\d+)", RegexOptions.Compiled)]
    private static partial Regex FemaleCountRegex();

    // -------------------------------------------------------------------------
    // Devanagari digit map (shared pattern with other normalizers)
    // -------------------------------------------------------------------------

    private static readonly (char Dev, char Ascii)[] DevanagariDigitMap =
    [
        ('०', '0'), ('१', '1'), ('२', '2'), ('३', '3'), ('४', '4'),
        ('५', '5'), ('६', '6'), ('७', '7'), ('८', '8'), ('९', '9'),
    ];

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Applies wage-model classification and gender lexicon resolution to every
    /// <c>labour[]</c> row in <paramref name="root"/>.
    ///
    /// <para>Wage model rules (transcript-level detection applies to all rows):</para>
    /// <list type="bullet">
    ///   <item>उक्त / ठेका present → <c>piece-rate</c></item>
    ///   <item>रोजंदारी present → <c>daily</c></item>
    ///   <item>Neither → no wageModel written (structurer default preserved)</item>
    /// </list>
    ///
    /// <para>Hard no-multiply rule: for piece-rate, the stated wage (rate per contract
    /// unit) is tagged <c>wageProvenance="spoken"</c> and a total is NOT computed
    /// from workerCount × rate. Contract unit (झाड/vine, ओळ/row) is set on the
    /// row.</para>
    ///
    /// <para>Gender lexicon: extracts <c>maleCount</c> (from गडी) and
    /// <c>femaleCount</c> (from बायका) from the transcript into the first labour
    /// row that carries a matching workerCount or into the first row if there is
    /// only one.</para>
    /// </summary>
    /// <param name="root">The structured JSON object being normalised.</param>
    /// <param name="transcript">The full Marathi/Devanagari transcript string.</param>
    internal static void Apply(JsonObject root, string transcript)
    {
        if (root["labour"] is not JsonArray labour || labour.Count == 0)
        {
            // Still attempt gender extraction if the transcript has signals —
            // but with no rows there is nothing to write into.
            return;
        }

        if (string.IsNullOrWhiteSpace(transcript))
            return;

        // Normalize Devanagari digits for consistent regex matching.
        var t = NormalizeDevanagariDigits(transcript);

        // 1. Detect wage model from transcript.
        var isPieceRate = PieceRateMarkerRegex().IsMatch(t);
        var isDaily = DailyMarkerRegex().IsMatch(t);

        string? wageModel = null;
        if (isPieceRate)
            wageModel = "piece-rate";
        else if (isDaily)
            wageModel = "daily";

        // 2. Detect contract unit.
        string? contractUnit = null;
        if (isPieceRate)
        {
            if (VineUnitRegex().IsMatch(t))
                contractUnit = "vine";
            else if (RowUnitRegex().IsMatch(t))
                contractUnit = "row";
        }

        // 3. Extract gender counts from transcript.
        var maleCount = ExtractCount(MaleCountRegex(), t);
        var femaleCount = ExtractCount(FemaleCountRegex(), t);

        // 4. Apply to each labour row.
        foreach (var node in labour.OfType<JsonObject>())
        {
            ApplyToRow(node, wageModel, contractUnit, maleCount, femaleCount);
        }
    }

    // -------------------------------------------------------------------------
    // Per-row application
    // -------------------------------------------------------------------------

    private static void ApplyToRow(
        JsonObject row,
        string? wageModel,
        string? contractUnit,
        int? maleCount,
        int? femaleCount)
    {
        // Set wage model.
        if (wageModel is not null)
        {
            row["wageModel"] = wageModel;
        }

        // Set contract unit and provenance for piece-rate.
        if (wageModel == "piece-rate")
        {
            if (contractUnit is not null)
                row["contractUnit"] = contractUnit;

            // Tag the rate provenance as "spoken" (the rate came verbatim from
            // the transcript; the total is NOT computed, honouring the no-multiply rule).
            row["wageProvenance"] = "spoken";

            // Explicitly do NOT compute workerCount × wage.
            // Any existing "total" or "computedTotal" field that would equal
            // workerCount × wage must not be fabricated here.
            // If a total was injected by the structurer as worker-count product,
            // mark it NOT_COMPUTED to flag that it is invalid.
            var workerCount = TryGetDecimal(row, "workerCount");
            var wage = TryGetDecimal(row, "wage");

            if (workerCount.HasValue && wage.HasValue)
            {
                var workerProduct = workerCount.Value * wage.Value;

                // Check if an existing "total" equals the forbidden product.
                if (row["total"] is not null)
                {
                    var existingTotal = TryGetDecimalNode(row["total"]);
                    if (existingTotal.HasValue &&
                        Math.Abs(existingTotal.Value - workerProduct) < 0.01m)
                    {
                        // The structurer computed workerCount × rate — override it.
                        row["total"] = "NOT_COMPUTED";
                        row["totalProvenance"] = "piece-rate-no-multiply-rule";
                    }
                }
            }
        }

        // Set gender counts.
        if (maleCount.HasValue)
            row["maleCount"] = maleCount.Value;

        if (femaleCount.HasValue)
            row["femaleCount"] = femaleCount.Value;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static int? ExtractCount(Regex regex, string transcript)
    {
        var match = regex.Match(transcript);
        if (!match.Success)
            return null;

        // Group 1 catches "N marker", group 2 catches "marker N"
        var g1 = match.Groups[1].Value;
        var g2 = match.Groups[2].Value;
        var raw = string.IsNullOrEmpty(g1) ? g2 : g1;

        return int.TryParse(raw, out var n) ? n : null;
    }

    private static decimal? TryGetDecimal(JsonObject obj, string key)
    {
        if (obj[key] is not JsonNode node)
            return null;

        return TryGetDecimalNode(node);
    }

    private static decimal? TryGetDecimalNode(JsonNode? node)
    {
        if (node is null)
            return null;

        try
        {
            return node.GetValue<decimal>();
        }
        catch
        {
            return decimal.TryParse(node.ToString(), out var v) ? v : null;
        }
    }

    private static string NormalizeDevanagariDigits(string text)
    {
        foreach (var (dev, ascii) in DevanagariDigitMap)
            text = text.Replace(dev, ascii);

        return text;
    }
}
