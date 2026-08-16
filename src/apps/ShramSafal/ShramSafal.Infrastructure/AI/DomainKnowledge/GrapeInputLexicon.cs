using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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
    // Normalization helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Lowercases and collapses whitespace/hyphens for comparison.
    /// Keeps Devanagari characters intact (they are compared directly).
    /// </summary>
    private static string NormalizeForComparison(string s)
    {
        // Collapse whitespace and hyphens so "6 b a" == "6ba" == "6-ba"
        s = Regex.Replace(s.ToLowerInvariant().Trim(), @"[\s\-]+", "");
        return s;
    }

    /// <summary>
    /// Produces a consonant-skeleton phonetic key over the ASCII-lowercase form.
    /// Maps common STT/Marathi romanization variations to a shared skeleton:
    /// - removes vowels (a, e, i, o, u)
    /// - collapses repeated consonants
    /// - normalises ph→f, th→t, ck→k
    /// So "alphamethrin" and "aplhamitren" both become "llfmtrn" → "lfmtrn".
    /// </summary>
    private static string PhoneticKey(string s)
    {
        if (string.IsNullOrEmpty(s))
            return "";

        // Only apply phonetic key to ASCII-range inputs (skip Devanagari blocks)
        if (ContainsDevanagari(s))
            return s; // compare Devanagari directly

        // Normalize digraphs first
        s = s.Replace("ph", "f")
             .Replace("th", "t")
             .Replace("ck", "k")
             .Replace("gh", "g")
             .Replace("sh", "s")
             .Replace("ch", "c");

        // Remove vowels
        s = Regex.Replace(s, "[aeiou]", "");

        // Collapse repeated consonants
        s = Regex.Replace(s, @"(.)\1+", "$1");

        return s;
    }

    private static bool ContainsDevanagari(string s)
    {
        foreach (var c in s)
        {
            if (c >= 'ऀ' && c <= 'ॿ')
                return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Levenshtein distance (iterative, O(m*n) time, O(min(m,n)) space)
    // -------------------------------------------------------------------------

    private static int Levenshtein(string s, string t)
    {
        if (s == t) return 0;
        if (s.Length == 0) return t.Length;
        if (t.Length == 0) return s.Length;

        // Early-exit: if lengths differ by more than 2, no point computing
        if (Math.Abs(s.Length - t.Length) > 3)
            return Math.Abs(s.Length - t.Length);

        var prev = new int[t.Length + 1];
        var curr = new int[t.Length + 1];

        for (var j = 0; j <= t.Length; j++)
            prev[j] = j;

        for (var i = 1; i <= s.Length; i++)
        {
            curr[0] = i;
            var rowMin = curr[0];

            for (var j = 1; j <= t.Length; j++)
            {
                var cost = s[i - 1] == t[j - 1] ? 0 : 1;
                curr[j] = Math.Min(
                    Math.Min(curr[j - 1] + 1, prev[j] + 1),
                    prev[j - 1] + cost);
                if (curr[j] < rowMin) rowMin = curr[j];
            }

            // Early exit row: if best possible result in this row > threshold
            if (rowMin > 2)
                return rowMin;

            Array.Copy(curr, prev, t.Length + 1);
        }

        return prev[t.Length];
    }
}
