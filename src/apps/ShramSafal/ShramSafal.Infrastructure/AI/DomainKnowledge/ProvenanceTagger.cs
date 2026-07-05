using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 7 — ProvenanceTagger (spoken | confirmed | derived | assumed).
//
// The FINAL pass in the domain-knowledge pipeline.  Stamps a sibling
// "provenance" field on every quantity-bearing node in the structured JSON.
//
// Four provenance classes (internal use only — NEVER farmer-facing):
//   spoken    — value lifted verbatim from the farmer's transcript (a stated
//               dose, a stated rupee figure, a stated duration).
//   derived   — produced by a CONFIRMED deterministic rule:
//               • 00:52:34 → 0-52-34 MKP  (NpkGradeDictionary)
//               • Bordeaux synthesis        (FormulationRecognizer)
//               • piece-rate total = vine× rate (LabourWageModel) — NOT set here.
//               These are already stamped upstream; this pass PRESERVES them.
//   assumed   — produced from an UNCONFIRMED premise (a fabricated tank-total
//               from an assumed carrier volume nobody stated).  This pass marks
//               such nodes "assumed" AND forces doseBasis="NOT_MENTIONED".
//   confirmed — RESERVED; set later by the confirm screen (Track C), NEVER here.
//
// Decision logic (reading upstream signals, NOT re-deriving):
//   • If a node already carries provenance="derived"  → preserve it.
//   • If a node already carries provenance="spoken"   → preserve it.
//   • If a node carries assumedCarrier=true (or has a totalMl with no confirmed
//     carrier volume) → assign provenance="assumed", force doseBasis="NOT_MENTIONED".
//   • Otherwise → assign provenance="spoken" (verbatim default).
//
// PURE — no EF, no I/O.
// NEVER writes to summary/farmerSummary or any other farmer-facing string field.
internal static class ProvenanceTagger
{
    // -------------------------------------------------------------------------
    // Farmer-facing fields that the tagger must never touch
    // -------------------------------------------------------------------------

    private static readonly HashSet<string> FarmerFacingFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "summary",
        "farmerSummary",
        "displaySummary",
        "farmerDescription",
        "message"
    };

    // -------------------------------------------------------------------------
    // Array keys that contain quantity-bearing nodes
    // -------------------------------------------------------------------------

    private static readonly string[] QuantityArrayKeys =
    [
        "inputs",
        "irrigation",
        "labour",
        "machinery",
        "activityExpenses",
        "cropActivities"
    ];

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Stamps <c>provenance</c> on every quantity-bearing node in
    /// <paramref name="root"/>.  Runs LAST in the domain-knowledge pipeline.
    ///
    /// <para>Rules:</para>
    /// <list type="bullet">
    ///   <item>Existing <c>provenance="derived"</c> or <c>provenance="spoken"</c>
    ///         are preserved without change.</item>
    ///   <item>Nodes carrying <c>assumedCarrier=true</c> (or a <c>totalMl</c>
    ///         produced from an unconfirmed tank) receive <c>provenance="assumed"</c>
    ///         and <c>doseBasis="NOT_MENTIONED"</c>.</item>
    ///   <item>All other quantity-bearing nodes receive <c>provenance="spoken"</c>
    ///         (the safe default: the value came verbatim from the transcript).</item>
    ///   <item><c>provenance="confirmed"</c> is NEVER written here — it is reserved
    ///         for Track C's confirm screen.</item>
    ///   <item>Farmer-facing string fields (<c>summary</c>, <c>farmerSummary</c>)
    ///         are NEVER touched — the word "assumed" must never appear in them.</item>
    /// </list>
    /// </summary>
    /// <param name="root">The structured JSON object produced by the LLM/STT
    /// pipeline after all prior normalizer passes have run.</param>
    internal static void Stamp(JsonObject root)
    {
        foreach (var key in QuantityArrayKeys)
        {
            if (root[key] is not JsonArray array)
                continue;

            foreach (var node in array.OfType<JsonObject>())
            {
                StampNode(node);
            }
        }

        // Safety assertion: confirm we never wrote "assumed" into a farmer-facing field.
        // This is a defensive guard — the implementation above never touches those fields,
        // but this makes the contract explicit and unit-testable.
        EnforceFarmerFacingFieldsUntouched(root);
    }

    // -------------------------------------------------------------------------
    // Per-node stamping
    // -------------------------------------------------------------------------

    private static void StampNode(JsonObject node)
    {
        // 1. If provenance is already set by an upstream pass — preserve it.
        //    Upstream passes that set provenance:
        //      - NpkGradeDictionary → "derived"
        //      - FormulationRecognizer → "derived" (Bordeaux row)
        //      - WaterRoleClassifier → "spoken" (irrigation rows)
        //      - UnitAndNumeralNormalizer → "spoken" (diesel expense rows)
        //      - LabourWageModel → "spoken" (via wageProvenance, not "provenance")
        var existingProvenance = node["provenance"]?.GetValue<string>();
        if (IsKnownUpstreamProvenance(existingProvenance))
        {
            // Upstream already made the right call — do not overwrite.
            return;
        }

        // 2. Detect "assumed" condition: a value produced from an unconfirmed premise.
        //    Signal: assumedCarrier=true (set by the pipeline when a carrier volume
        //    was injected without transcript confirmation).
        if (IsAssumed(node))
        {
            node["provenance"] = "assumed";
            node["doseBasis"] = "NOT_MENTIONED";
            return;
        }

        // 3. Default: the value came verbatim from the transcript → "spoken".
        //    We only stamp nodes that are quantity-bearing (have at least one of:
        //    dose, amount, durationHours, workerCount, carrierVolume, totalMl, wage).
        if (IsQuantityBearing(node))
        {
            node["provenance"] = "spoken";
        }
    }

    // -------------------------------------------------------------------------
    // Detection helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Returns true if the provenance value was set by a prior normalizer pass
    /// and should be preserved.
    /// </summary>
    private static bool IsKnownUpstreamProvenance(string? provenance)
    {
        if (string.IsNullOrWhiteSpace(provenance))
            return false;

        // "confirmed" is reserved — this tagger must not see it (Track C sets it post-confirm).
        // If somehow present, leave it in place (do not overwrite) to avoid clobbering.
        return
            string.Equals(provenance, "derived", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(provenance, "spoken", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(provenance, "confirmed", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Returns true if the node represents a value produced from an UNCONFIRMED
    /// premise — i.e., a fabricated total that the farmer never stated.
    ///
    /// <para>Current signals:</para>
    /// <list type="bullet">
    ///   <item><c>assumedCarrier=true</c> — explicitly flagged by an upstream pass
    ///         (e.g. the old ethrel-blower scenario injected totalMl from a presumed
    ///         600 L tank).</item>
    ///   <item><c>totalMl</c> is present BUT <c>carrierVolume</c> is absent or
    ///         <c>NOT_MENTIONED</c> — a totalMl with no confirmed carrier is
    ///         fabricated by definition.</item>
    /// </list>
    /// </summary>
    private static bool IsAssumed(JsonObject node)
    {
        // Signal 1: explicit assumedCarrier flag
        var assumedCarrierNode = node["assumedCarrier"];
        if (assumedCarrierNode is not null)
        {
            try
            {
                if (assumedCarrierNode.GetValue<bool>())
                    return true;
            }
            catch
            {
                // If the value is a string "true" rather than a bool
                var raw = assumedCarrierNode.ToString();
                if (string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
        }

        // Signal 2: totalMl present with no confirming carrier volume
        if (node["totalMl"] is not null)
        {
            var carrierVolume = node["carrierVolume"]?.ToString() ?? "";
            var isCarrierAbsent =
                string.IsNullOrWhiteSpace(carrierVolume)
                || string.Equals(carrierVolume, "NOT_MENTIONED", StringComparison.OrdinalIgnoreCase);

            if (isCarrierAbsent)
                return true;
        }

        return false;
    }

    /// <summary>
    /// Returns true if the node carries at least one quantity-bearing field,
    /// making it a candidate for a provenance stamp.
    /// </summary>
    private static bool IsQuantityBearing(JsonObject node)
    {
        return
            node["dose"] is not null ||
            node["amount"] is not null ||
            node["durationHours"] is not null ||
            node["workerCount"] is not null ||
            node["carrierVolume"] is not null ||
            node["totalMl"] is not null ||
            node["wage"] is not null ||
            node["quantity"] is not null;
    }

    // -------------------------------------------------------------------------
    // Contract enforcement: never touch farmer-facing string fields
    // -------------------------------------------------------------------------

    /// <summary>
    /// Defensive guard: verifies that none of the farmer-facing summary string
    /// fields have had the word "assumed" written into them.
    /// The tagger must NEVER place provenance metadata into farmer-facing output.
    /// </summary>
    private static void EnforceFarmerFacingFieldsUntouched(JsonObject root)
    {
        foreach (var field in FarmerFacingFields)
        {
            if (root[field] is not JsonNode node)
                continue;

            // This is purely defensive — if somehow "assumed" crept in, we catch it.
            // In normal operation the tagger never writes to these fields, so the
            // string will never contain "assumed".  This check makes the contract
            // explicit and enables unit testing of the architecture assertion.
            var value = node.ToString();
            if (value.Contains("assumed", StringComparison.OrdinalIgnoreCase))
            {
                // The ProvenanceTagger must not produce this state.
                // This would be a bug in the implementation above.
                throw new InvalidOperationException(
                    $"ProvenanceTagger contract violation: field '{field}' contains the word " +
                    "'assumed'. Provenance metadata is INTERNAL ONLY and must never appear " +
                    "in farmer-facing fields.");
            }
        }
    }
}
