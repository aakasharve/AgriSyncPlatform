using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 1 — deterministic NPK-grade rescue.
//
// Sarvam STT transcribes spoken NPK grades as clock-times
// (e.g. "शून्य बावन्न चौतीस" → "00:52:34").  This normalizer
// scans fullTranscript for colon-form triples, matches each
// against a seeded dictionary of KNOWN WSF grades, and — on a
// known-grade hit — ensures an inputs[] row exists with
// normalizedProductName (canonical grade + identity) and
// rawProductName (spoken colon form).  Unknown triples (genuine
// clock times such as "5:30 वाजता") are left untouched.
//
// PURE — no EF, no I/O.  Designed to be called first in the
// domain-knowledge pipeline from ApplyTranscriptIntegrityCorrections.
internal static partial class NpkGradeDictionary
{
    // -------------------------------------------------------------------------
    // Seeded grade dictionary
    //   Key   : normalized hyphen form (the canonical grade string)
    //   Value : human-readable product identity for grape context
    // -------------------------------------------------------------------------
    private static readonly Dictionary<string, string> KnownGrades =
        new(StringComparer.OrdinalIgnoreCase)
        {
            // 19/10, 26/10
            ["0-52-34"] = "MKP (mono-potassium phosphate)",
            ["19-19-19"] = "balanced NPK WSF",
            // 29/10
            ["0-60-20"] = "high-P/K WSF",
            // 30/10
            ["13-0-45"] = "KNO3 (potassium nitrate)",
            // SOP / MOP family
            ["0-0-50"] = "SOP/MOP",
            ["0-0-60"] = "SOP/MOP",
        };

    // Devanagari digit → ASCII digit translation table
    private static readonly (char Devanagari, char Ascii)[] DevanagariDigits =
    [
        ('०', '0'), ('१', '1'), ('२', '2'), ('३', '3'), ('४', '4'),
        ('५', '5'), ('६', '6'), ('७', '7'), ('८', '8'), ('९', '9'),
    ];

    // Matches N:N:N or N:NN:NN etc. (1–2 digits per segment).
    // Does NOT use look-around to keep the regex simple and .NET-compatible;
    // we post-filter on context (known grade).
    [GeneratedRegex(
        @"(?<!\d)(\d{1,2}):(\d{1,2}):(\d{1,2})(?!\d)",
        RegexOptions.Compiled)]
    private static partial Regex ColonTripleRegex();

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Scans <paramref name="transcript"/> for colon-form NPK grade triples
    /// and ensures a matching row exists in <c>root["inputs"]</c> for each
    /// KNOWN grade found.  Unknown triples (genuine clock times) are silently
    /// ignored (time-guard).
    /// </summary>
    internal static void RescueGrades(JsonObject root, string transcript)
    {
        if (string.IsNullOrWhiteSpace(transcript))
            return;

        // Normalize Devanagari digits → ASCII so the regex works uniformly.
        var normalizedTranscript = NormalizeDevanagariDigits(transcript);

        var inputs = EnsureInputsArray(root);

        foreach (Match m in ColonTripleRegex().Matches(normalizedTranscript))
        {
            // Parse the three segments
            if (!int.TryParse(m.Groups[1].Value, out var n)
                || !int.TryParse(m.Groups[2].Value, out var p)
                || !int.TryParse(m.Groups[3].Value, out var k))
            {
                continue;
            }

            // Build the canonical hyphen form
            var canonicalGrade = $"{n}-{p}-{k}";

            // Time-guard: only rescue if this triple is a KNOWN grade.
            if (!KnownGrades.TryGetValue(canonicalGrade, out var identity))
                continue;

            // The spoken colon form as it appeared in the transcript
            // (use the original match text from the NON-normalized transcript
            // so we preserve Devanagari if that is what was said).
            var rawColonForm = ExtractRawColonForm(transcript, m.Index, m.Length, normalizedTranscript);

            // Idempotency: skip if a row for this grade already exists.
            if (GradeRowExists(inputs, canonicalGrade))
                continue;

            var normalizedProductName = $"{canonicalGrade} {identity}";

            var row = new JsonObject
            {
                ["normalizedProductName"] = normalizedProductName,
                ["rawProductName"] = rawColonForm,
                ["costSource"] = "NOT_MENTIONED",
                ["provenance"] = "derived",
            };

            inputs.Add(row);
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private static string NormalizeDevanagariDigits(string text)
    {
        foreach (var (dev, ascii) in DevanagariDigits)
        {
            text = text.Replace(dev, ascii);
        }

        return text;
    }

    /// <summary>
    /// Returns the colon-form as it appears in the ORIGINAL (pre-normalization)
    /// transcript by mapping character positions.  If the original has Devanagari
    /// digits, we return those; otherwise we return the ASCII form from the match.
    /// </summary>
    private static string ExtractRawColonForm(
        string originalTranscript,
        int matchIndex,
        int matchLength,
        string normalizedTranscript)
    {
        // The normalized transcript is the same length as the original (we only
        // replaced single chars with single ASCII chars).
        if (matchIndex + matchLength <= originalTranscript.Length)
        {
            return originalTranscript.Substring(matchIndex, matchLength);
        }

        // Fallback: use the normalized form
        return normalizedTranscript.Substring(matchIndex, matchLength);
    }

    private static bool GradeRowExists(JsonArray inputs, string canonicalGrade)
    {
        foreach (var node in inputs)
        {
            if (node is not JsonObject row)
                continue;

            var norm = row["normalizedProductName"]?.GetValue<string>() ?? "";
            if (norm.StartsWith(canonicalGrade, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static JsonArray EnsureInputsArray(JsonObject root)
    {
        if (root["inputs"] is JsonArray existing)
            return existing;

        var arr = new JsonArray();
        root["inputs"] = arr;
        return arr;
    }
}
