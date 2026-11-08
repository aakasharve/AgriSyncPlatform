using System.Text.Json.Nodes;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 2 — GrapeInputLexicon (fuzzy normalizer, raw-preserving).
//
// Maps STT-mangled and dialect product names to a canonical product with
// agronomic metadata, without ever discarding what the farmer said.
//
// Match strategy (Levenshtein ≤ 2 OR phonetic key match over romanized form):
//   - Walk inputs[]; for each row, try every sttAlias + devanagariAlias.
//   - Levenshtein distance ≤ 2 on the lowercased token → match.
//   - Phonetic key match: strip vowels/noise from both sides → match
//     (handles "aplhamitren" ≈ "alphamethrin").
//   - On match: set normalizedProductName, chemicalClass, agronomicRole,
//     confirmationStatus="auto_normalized"; ALWAYS keep rawProductName.
//   - On no confident match: keep rawProductName, confirmationStatus="needs_confirm",
//     provenance "spoken" — never invent chemicalClass.
//
// PURE — no EF, no I/O.
internal static class GrapeInputLexicon
{
    // -------------------------------------------------------------------------
    // Product entries
    //
    // wave-3.4 (founder decision 14, 2026-08-16): the catalogue itself now lives in
    // ShramSafal.Domain.Dfes.GrapeProductRoles. It moved because DfesLensExtractor —
    // an APPLICATION-layer type, which may not import Infrastructure — must read each
    // product's agronomic role to decide the water/carrier question from the product.
    // This file keeps ALL of its matching machinery (Levenshtein <= 2 and the phonetic
    // consonant skeleton) and every behaviour it had; it simply stopped owning a
    // private copy of the data. ONE table, two readers, never two copies — two copies
    // would drift and the same product would classify differently depending on which
    // code path saw it.
    // -------------------------------------------------------------------------

    private static IReadOnlyList<GrapeProduct> Entries => GrapeProductRoles.Entries;

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Walks <c>root["inputs"][]</c> and applies fuzzy normalization for each row.
    /// On match: sets <c>normalizedProductName</c>, <c>chemicalClass</c>,
    /// <c>agronomicRole</c>, <c>confirmationStatus="auto_normalized"</c>;
    /// always preserves <c>rawProductName</c>.
    /// On no match: sets <c>rawProductName</c> + <c>confirmationStatus="needs_confirm"</c>.
    /// Never fabricates a chemicalClass.
    /// </summary>
    internal static void Normalize(JsonObject root)
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

    // -------------------------------------------------------------------------
    // Row-level normalization
    // -------------------------------------------------------------------------

    private static void NormalizeRow(JsonObject row)
    {
        // Read the input product name — prefer productName; fall back to rawProductName
        var productName = row["productName"]?.GetValue<string>()
                          ?? row["rawProductName"]?.GetValue<string>()
                          ?? "";

        if (string.IsNullOrWhiteSpace(productName))
            return;

        // Always ensure rawProductName is set from the original spoken text
        // (only write it if not already present, to honour any upstream raw already set)
        if (row["rawProductName"] is null)
        {
            row["rawProductName"] = productName;
        }

        var match = FindBestMatch(productName);

        if (match is not null)
        {
            row["normalizedProductName"] = match.CanonicalName;
            row["chemicalClass"] = match.ChemicalClass;
            row["agronomicRole"] = match.AgronomicRole;
            row["confirmationStatus"] = "auto_normalized";
        }
        else
        {
            // No confident match — leave raw, mark for human confirmation.
            // Do NOT invent a chemicalClass or agronomicRole.
            row["confirmationStatus"] = "needs_confirm";
        }
    }

    // -------------------------------------------------------------------------
    // Matching engine: Levenshtein ≤ 2 OR phonetic key match
    // -------------------------------------------------------------------------

    private static GrapeProduct? FindBestMatch(string input)
    {
        var normalizedInput = NormalizeForComparison(input);
        if (string.IsNullOrWhiteSpace(normalizedInput))
            return null;

        GrapeProduct? bestEntry = null;
        int bestScore = int.MaxValue;

        foreach (var entry in Entries)
        {
            // Try all aliases: sttAliases + devanagariAliases + canonicalName itself
            var candidates = entry.SttAliases
                .Concat(entry.DevanagariAliases)
                .Append(entry.CanonicalName.ToLowerInvariant());

            foreach (var alias in candidates)
            {
                var normalizedAlias = NormalizeForComparison(alias);

                // 1. Exact match (after normalization) — score 0
                if (string.Equals(normalizedInput, normalizedAlias, StringComparison.OrdinalIgnoreCase))
                {
                    return entry; // perfect, no need to search further
                }

                // 2. Levenshtein distance ≤ 2
                var dist = Levenshtein(normalizedInput, normalizedAlias);
                if (dist <= 2 && dist < bestScore)
                {
                    bestScore = dist;
                    bestEntry = entry;
                }

                // 3. Phonetic key match (Marathi-aware consonant skeleton)
                //    Handles "aplhamitren" ≈ "alphamethrin"
                var phoneticInput = PhoneticKey(normalizedInput);
                var phoneticAlias = PhoneticKey(normalizedAlias);
                if (phoneticInput.Length >= 3
                    && phoneticAlias.Length >= 3
                    && string.Equals(phoneticInput, phoneticAlias, StringComparison.OrdinalIgnoreCase))
                {
                    // phonetic match scores as 1 (prefer Levenshtein exact=0 if found)
                    if (1 < bestScore)
                    {
                        bestScore = 1;
                        bestEntry = entry;
                    }
                }
            }
        }

        // Accept the best match only if score is within threshold
        return bestScore <= 2 ? bestEntry : null;
    }

    // -------------------------------------------------------------------------
    // Normalization and distance helpers
    //
    // lane WORK-ID (spec plr-d10-redesign-real-integration-2026-10-25, item I29): the Levenshtein <= 2 distance, the
    // consonant-skeleton key and the comparison normaliser MOVED to ShramSafal.Domain.Compare.WordDistance so the
    // work vocabulary reads the same copy. Behaviour is unchanged; the calls below are the only change here.
    // -------------------------------------------------------------------------

    private static string NormalizeForComparison(string s) => WordDistance.NormalizeForComparison(s);

    private static string PhoneticKey(string s) => WordDistance.PhoneticKey(s);

    private static int Levenshtein(string s, string t) => WordDistance.Levenshtein(s, t);
}
