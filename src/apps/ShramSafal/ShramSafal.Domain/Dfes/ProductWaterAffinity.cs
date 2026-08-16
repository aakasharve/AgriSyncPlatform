// spec: dfes-companion-2026-07-11 (wave-3.4)
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Dfes;

/// <summary>Whether a product reaches the vine carried by water.</summary>
public enum WaterAffinity
{
    /// <summary>It only reaches the crop dissolved — a spray, a fertigation, a foliar.
    /// The water/carrier question is real and the farmer can answer it.</summary>
    WaterCarried,

    /// <summary>A dry granular broadcast on the soil, or a paste painted on the cane.
    /// There is no tank and no water. The question has no honest answer.</summary>
    Dry,

    /// <summary>We do not recognise this product. <b>Keep asking</b> — see the class
    /// docstring on why this, not "assume dry", is the safe default.</summary>
    Unknown,
}

/// <summary>
/// FOUNDER DECISION 14 (2026-08-16). Whether an input product owes the water/carrier
/// question — decided from the <b>PRODUCT</b>, never from <c>inputs[].method</c>.
///
/// <para><b>The founder's words.</b> "It must understand from the word, or not flagging it
/// anywhere, but keep that fertilizer name — such as a farmer might say '0 52 34 दिल', that
/// means an NPK grade that is given. We already made the AI intelligent enough, don't just
/// confuse it." Follow-up ruling: <c>fertiliser rule = dry granular</c>.</para>
///
/// <para><b>This is NOT the method bypass forbidden on 2026-08-13.</b> That decision
/// answered "should a soil-applied fertiliser still owe the water question?" with "keep
/// asking", and forbade a <c>method == "Soil"</c> test. Decision 14 does not reinstate that
/// test; it removes the method flag from the decision entirely. The difference is visible in
/// behaviour, not just in wording: a 0:52:34 row flagged <c>method: "Soil"</c> still owes
/// water here, and DAP flagged <c>method: "Spray"</c> still does not. A method bypass would
/// get both backwards.</para>
///
/// <para><b>Resolution order is fixed and total</b> — each step is tried only when the one
/// above it did not resolve:</para>
/// <list type="number">
///   <item><b>A recognised NPK grade → WaterCarried.</b> Water-soluble fertilisers only
///   exist dissolved, so a grade that shapes like <c>N-P-K</c> AND appears in
///   <see cref="NpkGradeTable"/> answers the question by itself. This is exactly what makes
///   the founder's "0 52 34" self-classifying with <i>no flag and no AI change</i> — the
///   grade is already emitted verbatim on <c>mix[].npkGrade</c> and persisted to
///   <c>ssf.application_input_items.npk_grade</c>.</item>
///   <item><b>A recognised grape input → its agronomic role.</b> A paste is painted on the
///   cane (Dormex on a dormant vine) and carries no water; a fungicide, insecticide, PGR or
///   foliar reaches the vine dissolved.</item>
///   <item><b>A named dry granular → Dry.</b> The founder's own follow-up rule. A short,
///   explicitly-named list — DAP, urea, MOP, FYM, SSP.</item>
///   <item><b>Anything else → Unknown.</b></item>
/// </list>
///
/// <para><b>Why Unknown keeps asking (doctrine P4).</b> Unknown falls back to today's
/// behaviour: the question stays owed. That will be most logs until the catalogue grows, and
/// it is the correct default in both directions — retiring a question we should have asked
/// silently removes a route for the farmer to raise his number, whereas asking one we could
/// have retired merely leaves an already-existing question in place. Never guess a
/// farmer's day away.</para>
///
/// <para><b><c>method</c> may be a tie-breaker only, never the primary signal.</b> It is not
/// read anywhere in this type. If a later change introduces it, it may only break a tie
/// between two equally-ranked affinities — it may never override one that resolved here,
/// and it may never be consulted before step 1.</para>
/// </summary>
public static partial class ProductWaterAffinity
{
    /// <summary>N-P-K in hyphen or colon form, 1–2 digits per segment and nothing else in
    /// the string. Anchored deliberately: "19-19-19" is a grade, but a product name that
    /// merely CONTAINS three numbers is not.</summary>
    [GeneratedRegex(@"^\s*\d{1,2}[-:]\d{1,2}[-:]\d{1,2}\s*$", RegexOptions.Compiled)]
    private static partial Regex GradeShape();

    /// <summary>
    /// Broadcast / soil granulars and bulk organics — the founder's <c>fertiliser rule =
    /// dry granular</c>. Deliberately a SHORT, explicitly-named list: an unrecognised name
    /// must fall through to <see cref="WaterAffinity.Unknown"/> and keep asking, never be
    /// guessed dry. Every addition here silences a real question, so it is an agronomic
    /// decision rather than a convenience.
    /// </summary>
    private static readonly HashSet<string> DryGranulars =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "DAP", "urea", "MOP", "FYM", "SSP",
            "potash", "MOP potash", "single super phosphate",
            "di-ammonium phosphate", "farm yard manure",
            "डीएपी", "युरिया", "पोटॅश", "शेणखत",
        };

    /// <summary>Resolve one product row. <paramref name="npkGrade"/> is
    /// <c>mix[].npkGrade</c> (emitted verbatim by the extraction contract);
    /// <paramref name="productName"/> is the product as spoken/stored.</summary>
    public static WaterAffinity Resolve(string? npkGrade, string? productName)
    {
        // 1. A recognised NPK grade is water-soluble BY DEFINITION. The grade may arrive
        //    on its own field or as the product name itself ("0-52-34" IS what he called
        //    it), so both are canonicalised and tried.
        var grade = Canonical(npkGrade) ?? Canonical(productName);
        if (grade is not null && NpkGradeTable.KnownGrades.ContainsKey(grade))
            return WaterAffinity.WaterCarried;

        // 2. A recognised grape input: use its agronomic role.
        var role = GrapeProductRoles.Entries
            .FirstOrDefault(e => Matches(e, productName))?.AgronomicRole;
        if (role is not null)
            return role.Contains("paste", StringComparison.OrdinalIgnoreCase)
                ? WaterAffinity.Dry            // painted on the cane, not sprayed
                : WaterAffinity.WaterCarried;  // fungicide / insecticide / PGR / foliar

        // 3. A named dry granular.
        if (!string.IsNullOrWhiteSpace(productName) && DryGranulars.Contains(productName.Trim()))
            return WaterAffinity.Dry;

        // 4. Anything else. P4 — do not guess.
        return WaterAffinity.Unknown;
    }

    /// <summary>Normalises a grade to the hyphen form <see cref="NpkGradeTable"/> is keyed
    /// by, or returns null when the string is not grade-shaped at all. Note this does NOT
    /// strip leading zeros: "00-52-34" is intentionally not "0-52-34" here, because the
    /// STT rescue in Infrastructure already reduces spoken colon triples to the canonical
    /// form before they are persisted.</summary>
    private static string? Canonical(string? s)
        => !string.IsNullOrWhiteSpace(s) && GradeShape().IsMatch(s)
            ? s.Trim().Replace(':', '-')
            : null;

    /// <summary>Exact (case-insensitive) match against the canonical name or any spoken
    /// alias. <b>Deliberately not fuzzy.</b> <c>GrapeInputLexicon</c>'s Levenshtein /
    /// phonetic matcher exists to RESCUE a mangled name into a product; here a near-miss
    /// must fall through to Unknown and keep the question, because a wrong match would
    /// retire a question the farmer could have answered.</summary>
    private static bool Matches(GrapeProduct e, string? productName)
        => !string.IsNullOrWhiteSpace(productName)
           && (string.Equals(e.CanonicalName, productName.Trim(), StringComparison.OrdinalIgnoreCase)
               || e.SttAliases.Contains(productName.Trim(), StringComparer.OrdinalIgnoreCase)
               || e.DevanagariAliases.Contains(productName.Trim(), StringComparer.OrdinalIgnoreCase));
}
