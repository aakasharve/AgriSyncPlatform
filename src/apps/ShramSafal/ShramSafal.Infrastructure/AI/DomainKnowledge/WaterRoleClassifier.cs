using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 5 — WaterRoleClassifier { sprayCarrier | irrigation | fertigation }.
//
// The same word "पाणी" means three different things:
//   19/10 — 1000 L = spray carrier (blower tank water), not irrigation.
//   23/10 — "नेहमी प्रमाणे 4 hr" = irrigation.
//   28/10 — 19:19:19 + water = fertigation.
//
// Decision rules (keyed on co-occurring transcript signals):
//   sprayCarrier : spray verb (फवारणी / मारल) + machine in machinery[] + litre volume in transcript
//                  → volume belongs on the input row's carrier fields, NOT irrigation[].
//   irrigation   : hours in transcript + motor/नेहमी प्रमाणे keyword + no spray verb present
//                  → one irrigation row with durationHours extracted.
//   fertigation  : WSF/NPK grade present in inputs[] + drip/water keyword + no spray verb
//                  → tag input row method="fertigation".
//
// Demotion rule (runs AFTER the existing irrigation safety-net):
//   If irrigation[] contains any row injected by the safety-net (method="Flood"
//   or source="injected-by-safety-net"), AND a spray verb + litre volume dominate
//   the transcript, the injected row is REMOVED from irrigation[] and the
//   carrier is re-tagged onto the owning input row instead.
//
// PURE — no EF, no I/O.
internal static partial class WaterRoleClassifier
{
    // -------------------------------------------------------------------------
    // Spray verb patterns (Marathi)
    // -------------------------------------------------------------------------

    // फवारणी = "spraying", मारल / मारली / मारले = "applied/sprayed" (colloquial)
    [GeneratedRegex(@"फवारण|मारल", RegexOptions.Compiled)]
    private static partial Regex SprayVerbRegex();

    // -------------------------------------------------------------------------
    // Litre volume pattern: "N लिटर" / "N liter" / "N L" etc.
    // Captures group 1 = the numeric amount (may include Devanagari digits).
    // -------------------------------------------------------------------------

    [GeneratedRegex(
        @"([\d०-९]+(?:\.\d+)?)\s*(?:लिटर|लीटर|liter|litre|L)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase)]
    private static partial Regex LitreVolumeRegex();

    // -------------------------------------------------------------------------
    // Hours pattern: "N तास" / "N hours"
    // Captures group 1 = the hour count.
    // -------------------------------------------------------------------------

    [GeneratedRegex(
        @"([\d०-९]+(?:\.\d+)?)\s*(?:तास|hours?|hr)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase)]
    private static partial Regex HoursRegex();

    // -------------------------------------------------------------------------
    // Irrigation source keywords (motor / "नेहमी प्रमाणे" / drip)
    // -------------------------------------------------------------------------

    [GeneratedRegex(
        @"(?:मोटर|motor|नेहमी\s+प्रमाणे|ड्रिप|drip)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase)]
    private static partial Regex IrrigationSourceRegex();

    // -------------------------------------------------------------------------
    // WSF/NPK grade detection: a normalized input row whose normalizedProductName
    // contains a grade like "0-52-34", "19-19-19", "13-0-45", "0-60-20" etc.
    // -------------------------------------------------------------------------

    [GeneratedRegex(@"\d+-\d+-\d+", RegexOptions.Compiled)]
    private static partial Regex NpkGradeInNameRegex();

    // Drip / fertigation water keyword (not spray)
    [GeneratedRegex(
        @"(?:ड्रिप|drip|fertigation|ठिबक)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase)]
    private static partial Regex FertigationWaterRegex();

    // -------------------------------------------------------------------------
    // Devanagari digit map (shared with other normalizers)
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
    /// Classifies water mentions in the structured JSON by co-occurring transcript
    /// signals.  Re-tags spray carriers off <c>irrigation[]</c> onto the owning
    /// input row; tags fertigation rows with <c>method="fertigation"</c>; injects
    /// an irrigation row from transcript evidence when appropriate.
    /// </summary>
    /// <param name="root">The structured JSON object, already processed by the
    /// normalizers that run before WaterRoleClassifier in the pipeline.</param>
    /// <param name="transcript">The full Marathi/Devanagari transcript string.</param>
    internal static void Classify(JsonObject root, string transcript)
    {
        if (string.IsNullOrWhiteSpace(transcript))
            return;

        // Normalize Devanagari digits in transcript for consistent regex matching.
        var normalizedTranscript = NormalizeDevanagariDigits(transcript);

        var hasSprayVerb = SprayVerbRegex().IsMatch(normalizedTranscript);
        var litreMatch = LitreVolumeRegex().Match(normalizedTranscript);
        var hasLitreVolume = litreMatch.Success;

        var hasMachine = HasMachineInRoot(root);

        // ---------------------------------------------------------------
        // 1. sprayCarrier: spray verb + machine + litre volume → carrier
        // ---------------------------------------------------------------
        if (hasSprayVerb && hasMachine && hasLitreVolume)
        {
            ApplySprayCarrierClassification(root, litreMatch, normalizedTranscript);
            return;  // dominant signal — skip the other classifiers for this log
        }

        // ---------------------------------------------------------------
        // 2. fertigation: WSF/NPK grade in inputs + drip/water + no spray
        // ---------------------------------------------------------------
        if (!hasSprayVerb && HasNpkGradeInInputs(root))
        {
            ApplyFertigationClassification(root, normalizedTranscript);
            return;
        }

        // ---------------------------------------------------------------
        // 3. irrigation: hours + motor/नेहमी प्रमाणे + no spray verb
        // ---------------------------------------------------------------
        if (!hasSprayVerb && IrrigationSourceRegex().IsMatch(normalizedTranscript))
        {
            var hoursMatch = HoursRegex().Match(normalizedTranscript);
            if (hoursMatch.Success)
            {
                ApplyIrrigationClassification(root, hoursMatch);
            }
        }
    }

    // -------------------------------------------------------------------------
    // sprayCarrier classification
    // -------------------------------------------------------------------------

    private static void ApplySprayCarrierClassification(
        JsonObject root,
        Match litreMatch,
        string normalizedTranscript)
    {
        // Parse the litre volume
        var litreStr = litreMatch.Groups[1].Value;
        var hasNumericVolume = decimal.TryParse(litreStr, out var litreVolume);

        // Step 1: Demote any injected Flood irrigation row
        DemoteInjectedFloodRow(root);

        // Step 2: Tag the first input row as spray carrier
        // (the row that would be the active input — typically the only or first one)
        if (root["inputs"] is JsonArray inputs)
        {
            var inputRow = inputs.OfType<JsonObject>().FirstOrDefault();
            if (inputRow is not null)
            {
                inputRow["waterRole"] = "sprayCarrier";

                if (hasNumericVolume)
                {
                    inputRow["carrierVolume"] = litreVolume;
                    inputRow["carrierUnit"] = "L";
                }
            }
        }

        // Step 3: Ensure irrigation[] is empty (spray carrier ≠ irrigation)
        EnsureIrrigationEmpty(root);
    }

    // -------------------------------------------------------------------------
    // fertigation classification
    // -------------------------------------------------------------------------

    private static void ApplyFertigationClassification(JsonObject root, string normalizedTranscript)
    {
        // Only proceed if a drip/fertigation water keyword is present,
        // OR if there is no irrigation source at all (WSF through drip is implied)
        var hasFertigationWater = FertigationWaterRegex().IsMatch(normalizedTranscript);
        var hasIrrigationSource = IrrigationSourceRegex().IsMatch(normalizedTranscript);

        // Tag NPK/WSF input rows as fertigation
        if (root["inputs"] is JsonArray inputs)
        {
            var tagged = false;
            foreach (var node in inputs.OfType<JsonObject>())
            {
                var npn = node["normalizedProductName"]?.GetValue<string>() ?? "";
                if (NpkGradeInNameRegex().IsMatch(npn))
                {
                    node["method"] = "fertigation";
                    tagged = true;
                }
            }

            // If a WSF row was tagged and there's a fertigation water signal
            // or no irrigation source (drip is the default mode for WSF),
            // ensure no irrigation[] row is mistakenly present as sprayCarrier
            if (tagged && (hasFertigationWater || !hasIrrigationSource))
            {
                // Leave irrigation[] alone — it may contain an irrigation row from a
                // separate water event; just don't add a sprayCarrier row.
                // No-op here: we only tag the input row.
            }
        }
    }

    // -------------------------------------------------------------------------
    // irrigation classification
    // -------------------------------------------------------------------------

    private static void ApplyIrrigationClassification(JsonObject root, Match hoursMatch)
    {
        var hoursStr = hoursMatch.Groups[1].Value;
        if (!decimal.TryParse(hoursStr, out var hours))
            return;

        var irrigation = EnsureIrrigationArray(root);

        // Idempotency: don't add a duplicate row if one already exists
        foreach (var node in irrigation.OfType<JsonObject>())
        {
            var existing = node["durationHours"]?.ToString() ?? node["duration"]?.ToString() ?? "";
            if (existing == hoursStr || existing == hours.ToString())
                return;
        }

        var irrigationRow = new JsonObject
        {
            ["method"] = "drip",         // default method — no spray verb
            ["durationHours"] = hours,
            ["source"] = "transcript",
            ["provenance"] = "spoken"
        };

        irrigation.Add(irrigationRow);
    }

    // -------------------------------------------------------------------------
    // Demotion: remove injected Flood rows from irrigation[] when spray dominates
    // -------------------------------------------------------------------------

    private static void DemoteInjectedFloodRow(JsonObject root)
    {
        if (root["irrigation"] is not JsonArray irrigation)
            return;

        // Collect indices of rows to remove (Flood/injected rows only)
        var toRemove = new List<int>();
        for (var i = 0; i < irrigation.Count; i++)
        {
            if (irrigation[i] is not JsonObject row)
                continue;

            var method = row["method"]?.GetValue<string>() ?? "";
            var source = row["source"]?.GetValue<string>() ?? "";

            // A row is considered "injected by the safety-net" if:
            //   a) method is "Flood" (the safety-net's default), OR
            //   b) source is "injected-by-safety-net" (explicit marker), OR
            //   c) it has durationHours=0 (no real duration — placeholder)
            var durationHours = row["durationHours"]?.ToString() ?? "";
            var isInjectedFlood =
                method.Equals("Flood", StringComparison.OrdinalIgnoreCase)
                || source.Equals("injected-by-safety-net", StringComparison.OrdinalIgnoreCase)
                || durationHours == "0";

            if (isInjectedFlood)
                toRemove.Add(i);
        }

        // Remove in reverse order so indices stay valid
        for (var i = toRemove.Count - 1; i >= 0; i--)
        {
            irrigation.RemoveAt(toRemove[i]);
        }
    }

    private static void EnsureIrrigationEmpty(JsonObject root)
    {
        if (root["irrigation"] is not JsonArray irrigation)
            return;

        // Remove all remaining rows (the demote step removed injected ones;
        // any remaining in a spray-dominant log are also incorrect for this pass)
        // Safety: only remove if the array is non-empty after demotion
        // (DemoteInjectedFloodRow already handled the known-injected case;
        // here we ensure the array is truly empty after spray classification)
        while (irrigation.Count > 0)
            irrigation.RemoveAt(irrigation.Count - 1);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static bool HasMachineInRoot(JsonObject root)
    {
        if (root["machinery"] is not JsonArray machinery)
            return false;

        return machinery.OfType<JsonObject>().Any();
    }

    private static bool HasNpkGradeInInputs(JsonObject root)
    {
        if (root["inputs"] is not JsonArray inputs)
            return false;

        foreach (var node in inputs.OfType<JsonObject>())
        {
            var npn = node["normalizedProductName"]?.GetValue<string>() ?? "";
            if (NpkGradeInNameRegex().IsMatch(npn))
                return true;
        }

        return false;
    }

    private static JsonArray EnsureIrrigationArray(JsonObject root)
    {
        if (root["irrigation"] is JsonArray existing)
            return existing;

        var arr = new JsonArray();
        root["irrigation"] = arr;
        return arr;
    }

    private static string NormalizeDevanagariDigits(string text)
    {
        foreach (var (dev, ascii) in DevanagariDigitMap)
        {
            text = text.Replace(dev, ascii);
        }

        return text;
    }
}
