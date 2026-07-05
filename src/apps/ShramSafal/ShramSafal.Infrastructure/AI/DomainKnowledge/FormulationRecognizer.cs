using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 3 — FormulationRecognizer (Bordeaux & tank-mix synthesis).
//
// Recognises that मोरचुद (copper sulfate) + चुना (lime) + water co-occur in
// one log entry as a Bordeaux mixture formulation.
//
// Rule:
//   When BOTH a "Copper sulfate" row AND a "Lime" row co-occur in inputs[]
//   (detected by normalizedProductName — runs AFTER GrapeInputLexicon), emit
//   exactly ONE synthesized "Bordeaux mixture" row with:
//     - mix[]           : array preserving copies of the two component rows + doses
//     - doseBasis       : "per-600L"
//     - basisUnit       : "L"
//     - provenance      : "derived"
//     - agronomicRole   : "fungicide"
//
//   The two component rows are KEPT but marked partOfFormulation="Bordeaux".
//
// Idempotency: if a "Bordeaux mixture" row already exists in inputs[], this
//   normalizer is a no-op (prevents double-synthesis on repeated calls).
//
// PURE — no EF, no I/O.
internal static class FormulationRecognizer
{
    // Canonical names as set by GrapeInputLexicon (normalizedProductName)
    private const string CopperSulfateCanonical = "Copper sulfate";
    private const string LimeCanonical = "Lime";
    private const string BordeauxCanonical = "Bordeaux mixture";

    /// <summary>
    /// Walks <c>root["inputs"][]</c> looking for co-occurring copper-sulfate and
    /// lime rows (by <c>normalizedProductName</c>). When found, appends a
    /// synthesized Bordeaux mixture row with a <c>mix[]</c> sub-array and marks
    /// the component rows <c>partOfFormulation="Bordeaux"</c>.
    /// </summary>
    /// <param name="root">The structured JSON object produced by the LLM/STT pipeline,
    /// already processed by <see cref="GrapeInputLexicon.Normalize"/>.</param>
    internal static void Recognize(JsonObject root)
    {
        if (root["inputs"] is not JsonArray inputs)
            return;

        // Idempotency guard: if Bordeaux already synthesized, do nothing.
        foreach (var node in inputs)
        {
            if (node is JsonObject row &&
                IsNameMatch(row["normalizedProductName"]?.GetValue<string>(), BordeauxCanonical))
            {
                return;
            }
        }

        // Find copper-sulfate and lime rows
        JsonObject? copperRow = null;
        JsonObject? limeRow = null;

        foreach (var node in inputs)
        {
            if (node is not JsonObject row)
                continue;

            var npn = row["normalizedProductName"]?.GetValue<string>() ?? "";

            if (copperRow is null && IsNameMatch(npn, CopperSulfateCanonical))
                copperRow = row;
            else if (limeRow is null && IsNameMatch(npn, LimeCanonical))
                limeRow = row;
        }

        // Both must be present for Bordeaux synthesis
        if (copperRow is null || limeRow is null)
            return;

        // Mark component rows
        copperRow["partOfFormulation"] = "Bordeaux";
        limeRow["partOfFormulation"] = "Bordeaux";

        // Build mix[] array — deep-copy of each component row
        var mix = new JsonArray
        {
            CloneRow(copperRow),
            CloneRow(limeRow)
        };

        // Build the synthesized Bordeaux mixture row
        var bordeauxRow = new JsonObject
        {
            ["normalizedProductName"] = BordeauxCanonical,
            ["chemicalClass"] = "fungicide",
            ["agronomicRole"] = "fungicide",
            ["confirmationStatus"] = "auto_normalized",
            ["doseBasis"] = "per-600L",
            ["basisUnit"] = "L",
            ["provenance"] = "derived",
            ["mix"] = mix
        };

        inputs.Add(bordeauxRow);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Case-insensitive equality between a (possibly null) normalizedProductName
    /// and the target canonical name.
    /// </summary>
    private static bool IsNameMatch(string? actualName, string canonicalName) =>
        string.Equals(actualName, canonicalName, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Creates a shallow copy of a JsonObject row (clones string fields relevant
    /// to the mix[] payload: normalizedProductName, rawProductName, dose, unit).
    /// Does NOT clone provenance or partOfFormulation from the component row into
    /// the mix copy — those are component-level metadata.
    /// </summary>
    private static JsonObject CloneRow(JsonObject source)
    {
        var clone = new JsonObject();

        // Copy the fields relevant to identify and describe the component in mix[]
        foreach (var key in new[]
        {
            "normalizedProductName",
            "rawProductName",
            "productName",
            "dose",
            "unit",
            "chemicalClass",
            "agronomicRole"
        })
        {
            if (source[key] is JsonNode value)
            {
                // JsonNode.DeepClone is available in .NET 6+; use ToString()/JsonValue for strings.
                clone[key] = value.GetValue<string>();
            }
        }

        return clone;
    }
}
