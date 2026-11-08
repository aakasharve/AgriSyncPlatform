using System.Globalization;
using System.Text;

namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WORK-ID, item I29; founder D-77, D-104a)

/// <summary>The four parts of farm work ShramSafal tells apart (the phone's part words: सिंचन / खत / फवारणी / कामे).</summary>
public enum WorkPart
{
    Irrigation = 0,
    Nutrition = 1,
    Spray = 2,
    Work = 3,
}

/// <summary>One kind of work and the words that say it. <see cref="English"/> and <see cref="Marathi"/> are word
/// STEMS: a single word matches a spoken word that starts with it (so "फवार" holds फवारणी, फवारली, फवारलं; "prun" holds
/// pruning, pruned); a stem with a space is a phrase that must appear whole. A short English stem (three letters or
/// fewer) must equal the spoken word. <see cref="OperationKey"/> is the phone's <c>op_*</c> id (so both ends name work
/// alike) where the phone has one; null when the kind is told apart only by its part.</summary>
public sealed record WorkWord(string Id, WorkPart Part, string? OperationKey, IReadOnlyList<string> English, IReadOnlyList<string> Marathi);

/// <summary>A product role (fungicide, insecticide, herbicide, pgr, nutrient) and the words that name it without a product.</summary>
public sealed record RoleWords(string Role, IReadOnlyList<string> Words);

/// <summary>A nutrient told apart by name (boron, calcium …) and the words that name it. <see cref="Key"/> is the
/// nutrient key a record carries when no NPK grade is named.</summary>
public sealed record NutrientWords(string Key, IReadOnlyList<string> Words);

/// <summary>
/// ONE table for "the same work said in different words" (D-77: "वेगळं" never means wrong). Every answer is explainable
/// from this table (P4): no AI, no model call, no I/O. It replaces four separate keyword lists (the stage comparison's
/// <c>Categorize</c>, the library's <c>DeriveCategory</c>, the phone's <c>categoryOfStep</c> and
/// <c>mapActivityToOperationId</c>) as the place the SERVER decides sameness; the phone's lists only label.
///
/// <para>Order matters: the FIRST kind whose words appear decides the part (mending a pipe is repair work, not
/// irrigation; "फवारणीसाठी पाणी आणलं" is spray work, the water is the carrier; "ठिबकातून खत सोडलं" is fertiliser).
/// Bump <see cref="Version"/> on every change; it is carried in every answer (<see cref="WorkIdentity"/>,
/// <see cref="WorkMatch"/>) and the golden set (<c>work-identity-golden.json</c>) names the version it was reviewed at.</para>
/// </summary>
public static class WorkVocabulary
{
    /// <summary>The version of this table, carried in every answer that rests on it.</summary>
    public const string Version = "work-vocab-1";

    /// <summary>The phone's coarse operation keys for the parts that have no finer key of their own.</summary>
    public const string SprayOperationKey = "op_spray_gen";
    public const string FertiliserOperationKey = "op_fert_gen";

    /// <summary>Spoken words that begin a record ("Spray ‹product›" / "Fertilizer ‹product›" is what the phone writes) and
    /// say only the part. The first word of a record is dropped from the product search.</summary>
    public static readonly IReadOnlyList<string> PrefixWords = ["spray", "fertilizer", "फवारणी", "खत"];

    // Order = priority (see the class remarks).
    public static readonly IReadOnlyList<WorkWord> Words =
    [
        new("repair", WorkPart.Work, "op_repair",
            ["repair", "fix", "mend"],
            ["दुरुस्त", "दुरूस्त", "दुरुस्ती"]),

        new("spray", WorkPart.Spray, SprayOperationKey,
            ["spray", "foliar", "pesticid", "fungicid", "insecticid", "herbicid", "weedicid", "pgr", "drench"],
            ["फवार", "औषध", "बुडवण", "बुरशीनाशक", "कीटकनाशक", "तणनाशक", "संजीवक", .. SprayCarrierWords.SprayVerbStems]),

        new("fertiliser", WorkPart.Nutrition, FertiliserOperationKey,
            ["fert", "nutri", "urea", "dap", "npk", "potash", "manure", "fym", "micronutri", "mop"],
            ["खत", "युरिया", "डीएपी", "विद्राव्य", "पोषण", "शेणखत"]),

        new("irrigation-drip", WorkPart.Irrigation, "op_irrig_drip",
            ["drip"],
            ["ठिबक"]),

        new("irrigation-flood", WorkPart.Irrigation, "op_irrig_flood",
            ["flood"],
            ["पाटाने", "पाटपाणी"]),

        new("irrigation", WorkPart.Irrigation, null,
            ["irrig", "water"],
            ["सिंचन", "पाणी", "पाण्", "भिजवण"]),

        new("weeding", WorkPart.Work, "op_weed_man",
            ["weed", "hoeing"],
            ["खुरपण", "निंदण", "तण काढ", "तणकाढ", "गवत काढ", "तण काढणी"]),

        new("defoliation", WorkPart.Work, "op_defoliation",
            ["defoliat", "leaf removal"],
            ["पानगळ", "पाने काढ", "पान काढ"]),

        new("pruning", WorkPart.Work, "op_pruning",
            ["prun"],
            ["छाट"]),

        new("thinning", WorkPart.Work, "op_thinning",
            ["thinning", "thinned"],
            ["विरळण"]),

        new("harvest", WorkPart.Work, "op_harvest",
            ["harvest"],
            ["काढणी", "तोडणी", "तोडण"]),

        new("tying", WorkPart.Work, "op_tying",
            ["tying", "tie", "trellis"],
            ["बांधण"]),

        new("earthing-up", WorkPart.Work, "op_earthing_up",
            ["earthing"],
            ["भर देणे", "बुंध्याला माती"]),

        new("leaf-check", WorkPart.Work, "op_leaf_check",
            ["leaf check", "leaf inspection"],
            ["पानांची तपासणी", "पान तपासणी", "पाने तपास"]),

        new("pest-scout", WorkPart.Work, "op_pest_scout",
            ["scout"],
            ["कीड पाहणी", "कीड तपास", "कीड पाहा"]),

        new("growth-check", WorkPart.Work, "op_growth_check",
            ["growth check"],
            ["वाढ तपास"]),

        new("gap-fill", WorkPart.Work, "op_gap_fill",
            ["gap fill"],
            ["नांगे भर"]),

        new("field-prep", WorkPart.Work, "op_field_prep",
            ["field prep", "ploughing", "plowing"],
            ["शेत तयार", "नांगरण"]),

        new("paste", WorkPart.Work, "op_paste",
            ["paste"],
            ["डॉर्मेक्स लावण", "dormex लावण"]),
    ];

    /// <summary>Role words, used when a record names no product ShramSafal's input list knows. The list (the catalogue)
    /// decides first; these are the next resort. Product SPELLINGS the catalogue lacks are listed here (the catalogue
    /// writes mancozeb "मँकोझेब"; a farmer says "मॅन्कोझेब").</summary>
    public static readonly IReadOnlyList<RoleWords> Roles =
    [
        new("fungicide", ["fungicid", "बुरशीनाशक", "मॅन्कोझेब", "मँकोझेब", "मॅन्कोजेब", "मँकोजेब", "mancozeb"]),
        new("insecticide", ["insecticid", "कीटकनाशक"]),
        new("herbicide", ["herbicid", "weedicid", "तणनाशक"]),
        new("pgr", ["pgr", "ga3", "gibberell", "growth regulator", "संजीवक", "जीए"]),
    ];

    /// <summary>Nutrients told apart by name. A nutrient record without a named NPK grade carries one of these keys.</summary>
    public static readonly IReadOnlyList<NutrientWords> Nutrients =
    [
        new("boron", ["boron", "बोरॉन", "बोरान", "बोरोन"]),
        new("calcium", ["calcium", "कॅल्शियम", "कॅल्शिअम", "कॅल्शिय"]),
        new("zinc", ["zinc", "झिंक"]),
        new("magnesium", ["magnesium", "मॅग्नेशियम", "मॅग्नेशिअम"]),
        new("iron", ["iron", "आयर्न", "लोह"]),
        new("sulphur", ["sulphur", "sulfur", "गंधक", "सल्फर"]),
        new("urea", ["urea", "युरिया"]),
    ];

    /// <summary>
    /// The bucket name <see cref="CompareEngine.Categorize"/> has always answered for an English activity name:
    /// <c>spray</c>, <c>fertigation</c>, <c>irrigation</c> or the catch-all <c>activity</c>. Kept exactly as it was so
    /// every English input keeps its answer (P11: DFES scoring and the stage comparison depend on it). The one
    /// copy of those four substring rules.
    /// </summary>
    public static string LegacyBucket(string activityName)
    {
        var normalized = activityName.Trim().ToLowerInvariant();
        if (normalized.Contains("spray") ||
            normalized.Contains("pesticide") ||
            normalized.Contains("fungicide"))
        {
            return "spray";
        }

        if (normalized.Contains("fert") ||
            normalized.Contains("urea") ||
            normalized.Contains("dap") ||
            normalized.Contains("nutri"))
        {
            return "fertigation";
        }

        if (normalized.Contains("irrig") || normalized.Contains("water"))
        {
            return "irrigation";
        }

        return "activity";
    }

    // ---- reading spoken words ----

    /// <summary>NFC, lowercase, Devanagari digits to ASCII; every character that is not a letter, digit or part of a
    /// Devanagari word (including brackets, commas and joiners) becomes a space; spaces collapsed.</summary>
    public static string Normalise(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        var sb = new StringBuilder(text.Length);
        foreach (var raw in text.Normalize(NormalizationForm.FormC).ToLowerInvariant())
        {
            var c = raw is >= '०' and <= '९' ? (char)('0' + (raw - '०')) : raw;
            if (c is '‌' or '‍')
            {
                continue; // joiners inside a Devanagari word carry no meaning for matching
            }

            var category = char.GetUnicodeCategory(c);
            var keep = char.IsLetterOrDigit(c)
                || category is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark;
            sb.Append(keep ? c : ' ');
        }

        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>The spoken words of already-normalised text that one stem list hits (empty when none).</summary>
    public static IReadOnlyList<string> Hits(string normalised, IReadOnlyList<string> tokens, IEnumerable<string> stems)
    {
        var hits = new List<string>();
        foreach (var stem in stems)
        {
            if (stem.Contains(' '))
            {
                if ((" " + normalised).Contains(" " + stem, StringComparison.Ordinal))
                {
                    hits.Add(stem);
                }

                continue;
            }

            var exactOnly = stem.Length <= 3 && stem.All(char.IsAsciiLetterOrDigit);
            foreach (var token in tokens)
            {
                var hit = exactOnly
                    ? string.Equals(token, stem, StringComparison.Ordinal)
                    : token.StartsWith(stem, StringComparison.Ordinal);
                if (hit)
                {
                    hits.Add(token);
                    break;
                }
            }
        }

        return hits;
    }
}
