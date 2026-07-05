using System.Text.Json.Nodes;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 6c — WorkTypeDictionary
//
// Maps Marathi (Devanagari) activity names and their aliases to canonical
// English work-type tokens used by buildWorkDoneProjection (frontend).
//
// Canonical types and their aliases (from the 18-vlog corpus):
//
//   defoliation   = पानगळ / पाने काढणे             (19/10)
//   paste         = Dormex लावणे                    (22/10)
//   earthing-up   = बुंध्याला माती                  (31/10)
//   weeding       = खुरपणी (primary), निंदणी (alias) (1/11, 6/11)
//   pruning       = छाटणी                           (21/10)
//
// Normalize() operates on:
//   labour[].activity          — set to canonical English work type
//   cropActivities[].title     — same canonical mapping
//
// Fields that do not match any alias are left unchanged.
//
// PURE — no EF, no I/O.
internal static class WorkTypeDictionary
{
    // -------------------------------------------------------------------------
    // Alias table
    //   Key   : Marathi alias (case-insensitive comparison via OrdinalIgnoreCase)
    //   Value : canonical English work-type token
    //
    // Each entry is checked against a CONTAINS match (not exact equality) so
    // compound phrases like "Dormex लावणे" match the "dormex" and "लावणे" tokens.
    // The match strategy: for single-word aliases use CONTAINS; for multi-word
    // canonical phrases (e.g. "बुंध्याला माती") use CONTAINS on the full phrase.
    // -------------------------------------------------------------------------

    private static readonly (string Alias, string Canonical)[] AliasTable =
    [
        // ----- defoliation -----
        ("पानगळ",     "defoliation"),
        ("पाने काढणे", "defoliation"),

        // ----- paste -----
        // "Dormex लावणे" — matches any activity containing both Dormex + लावणे,
        // or just the compound phrase.  We check each alias independently.
        ("dormex लावणे", "paste"),   // case-insensitive match covers Dormex/dormex
        ("डॉर्मेक्स लावणे", "paste"),

        // ----- earthing-up -----
        ("बुंध्याला माती", "earthing-up"),

        // ----- weeding -----
        ("खुरपणी", "weeding"),
        ("निंदणी",  "weeding"),

        // ----- pruning -----
        ("छाटणी", "pruning"),
    ];

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Normalizes work-type labels on <c>labour[].activity</c> and
    /// <c>cropActivities[].title</c> in <paramref name="root"/> to canonical
    /// English tokens, enabling <c>buildWorkDoneProjection</c> on the frontend
    /// to match without title-less row drops.
    /// </summary>
    /// <param name="root">The structured JSON object being normalised.</param>
    /// <param name="transcript">
    /// The full Marathi/Devanagari transcript string (reserved for future
    /// transcript-level work-type detection; currently unused but kept for
    /// pipeline signature consistency).
    /// </param>
    internal static void Normalize(JsonObject root, string transcript)
    {
        // 1. labour[].activity
        if (root["labour"] is JsonArray labour)
        {
            foreach (var node in labour.OfType<JsonObject>())
            {
                var activity = node["activity"]?.GetValue<string>();
                if (activity is not null)
                {
                    var canonical = TryNormalize(activity);
                    if (canonical is not null)
                        node["activity"] = canonical;
                }
            }
        }

        // 2. cropActivities[].title
        if (root["cropActivities"] is JsonArray cropActivities)
        {
            foreach (var node in cropActivities.OfType<JsonObject>())
            {
                var title = node["title"]?.GetValue<string>();
                if (title is not null)
                {
                    var canonical = TryNormalize(title);
                    if (canonical is not null)
                        node["title"] = canonical;
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Attempts to find a canonical work type for <paramref name="raw"/>.
    /// Returns the canonical token on a match, or <c>null</c> if no alias matched.
    /// </summary>
    private static string? TryNormalize(string raw)
    {
        foreach (var (alias, canonical) in AliasTable)
        {
            if (raw.Contains(alias, StringComparison.OrdinalIgnoreCase))
                return canonical;
        }

        return null;
    }
}
