using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Task 8 — flag-guarded domain-knowledge pipeline wire-in.
//
// Runs the 7 deterministic domain-knowledge normalizers in the
// FIXED order mandated by W1.P0 Batch A:
//
//   C1  NpkGradeDictionary.RescueGrades
//   C2  GrapeInputLexicon.Normalize
//       (moved + guarded) खत safety-net
//   C3  FormulationRecognizer.Recognize
//   C4  UnitAndNumeralNormalizer.Normalize
//   C5  WaterRoleClassifier.Classify
//   C6a LabourWageModel.Apply
//   C6c WorkTypeDictionary.Normalize
//   C7  ProvenanceTagger.Stamp   ← LAST
//
// PURE — no EF, no I/O.
// Called from ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections
// ONLY when config flag Ai:DomainKnowledgeLayer:Enabled is true
// (default false).
internal static class DomainKnowledgePipeline
{
    // -------------------------------------------------------------------------
    // Fertilizer application खत safety-net strings
    // (mirrors the logic in ParseVoiceInputHandler so the guard fires under
    //  the same conditions as the original safety-net it replaces here)
    // -------------------------------------------------------------------------

    private static readonly string[] FertilizerPasteTenseMarkers =
    [
        "दिलं",
        "दिले",
        "घातले",
        "टाकले",
    ];

    // -------------------------------------------------------------------------
    // Public entry point (testable seam — no config flag here)
    // -------------------------------------------------------------------------

    /// <summary>
    /// Runs all 7 domain-knowledge normalizers on <paramref name="root"/> in
    /// the required pipeline order.  This method is the testable seam; the
    /// flag-guard lives in the calling site
    /// (<c>ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections</c>).
    /// </summary>
    /// <param name="root">The structured JSON object produced by the LLM/STT
    /// pipeline.  Modified in-place.</param>
    /// <param name="transcript">The full Marathi/Devanagari transcript string.</param>
    internal static void RunDomainKnowledgePipeline(JsonObject root, string transcript)
    {
        // C1 — NPK grade rescue (00:52:34 → 0-52-34 MKP)
        NpkGradeDictionary.RescueGrades(root, transcript);

        // C2 — Grape input lexicon (fuzzy product normalization)
        GrapeInputLexicon.Normalize(root);

        // खत safety-net (MOVED here — runs AFTER lexicon, GATED):
        //   Only fires when inputs[] is empty AND no row already carries
        //   a rawProductName (i.e. the lexicon / NPK rescue did not
        //   produce any input row).
        ApplyGuardedFertilizerSafetyNet(root, transcript);

        // C3 — Formulation recognizer (Bordeaux mixture synthesis)
        FormulationRecognizer.Recognize(root);

        // C4 — Unit and numeral normalization (ppf→ppm, Marathi fractions,
        //       Devanagari digits, diesel-cost rule)
        UnitAndNumeralNormalizer.Normalize(root, transcript);

        // C5 — Water role classifier (sprayCarrier / irrigation / fertigation)
        WaterRoleClassifier.Classify(root, transcript);

        // C6a — Labour wage model (piece-rate / daily / lump-sum + gender)
        LabourWageModel.Apply(root, transcript);

        // C6c — Work type dictionary (Marathi → canonical English work type)
        WorkTypeDictionary.Normalize(root, transcript);

        // C7 — Provenance tagger (spoken / derived / assumed) — MUST BE LAST
        ProvenanceTagger.Stamp(root);
    }

    // -------------------------------------------------------------------------
    // Guarded खत safety-net (demoted from ParseVoiceInputHandler)
    //
    // Preconditions for firing:
    //   1. Transcript contains "खत" + a past-tense verb.
    //   2. inputs[] is EMPTY (no row created by C1 or C2 above).
    //   3. No row in inputs[] already carries rawProductName (belt-and-
    //      suspenders — covers the case where a row exists without dose).
    //
    // When ALL preconditions are met, injects a generic खत row.
    // -------------------------------------------------------------------------

    private static void ApplyGuardedFertilizerSafetyNet(JsonObject root, string transcript)
    {
        if (!ContainsFertilizerApplication(transcript))
            return;

        var inputs = root["inputs"] as JsonArray ?? new JsonArray();

        // Gate: do not overwrite when any row already carries rawProductName
        if (inputs.Count == 0 || !AnyRowHasRawProductName(inputs))
        {
            // Only add the खत row when inputs is truly empty
            if (inputs.Count == 0)
            {
                var fertilzerRow = new JsonObject
                {
                    ["productName"] = "खत",
                    ["method"] = "Soil",
                    ["type"] = "fertilizer",
                    ["sourceText"] = transcript,
                    ["systemInterpretation"] = "खत देण्याचे काम नोंदवले"
                };
                inputs.Add(fertilzerRow);
                root["inputs"] = inputs;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static bool ContainsFertilizerApplication(string transcript)
    {
        if (!transcript.Contains("खत", StringComparison.OrdinalIgnoreCase))
            return false;

        foreach (var marker in FertilizerPasteTenseMarkers)
        {
            if (transcript.Contains(marker, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    /// <summary>
    /// Returns true if ANY row in <paramref name="inputs"/> already carries
    /// a non-empty <c>rawProductName</c> field.  Used to gate the खत
    /// safety-net so it never overwrites a product row created by the
    /// lexicon or NPK rescuer.
    /// </summary>
    private static bool AnyRowHasRawProductName(JsonArray inputs)
    {
        foreach (var node in inputs)
        {
            if (node is not JsonObject row)
                continue;

            var raw = row["rawProductName"]?.GetValue<string>() ?? "";
            if (!string.IsNullOrWhiteSpace(raw))
                return true;
        }

        return false;
    }
}
