// spec: dfes-companion-2026-07-11 (wave-3.4)
namespace ShramSafal.Domain.Dfes;

/// <summary>A recognised grape input: its canonical name, its chemical class, its
/// agronomic role, and the spoken forms the STT layer maps onto it.</summary>
/// <param name="CanonicalName">The name the product is stored under.</param>
/// <param name="ChemicalClass">What it is chemically (fungicide, cytokinin PGR, …).</param>
/// <param name="AgronomicRole">What it is FOR. This is the field
/// <see cref="ProductWaterAffinity"/> reads: a role that is painted on (a paste) carries
/// no water, while a fungicide / insecticide / PGR / foliar reaches the vine dissolved.</param>
/// <param name="SttAliases">Romanised spoken forms, including the manglings Sarvam
/// actually produces on real grape vlogs.</param>
/// <param name="DevanagariAliases">Devanagari spoken forms, compared directly (the
/// phonetic matcher is ASCII-only).</param>
public sealed record GrapeProduct(
    string CanonicalName,
    string ChemicalClass,
    string AgronomicRole,
    string[] SttAliases,
    string[] DevanagariAliases);

/// <summary>
/// The grape input catalogue.
///
/// <para><b>Why it lives in Domain.</b> Founder decision 14 (2026-08-16) decides the
/// water/carrier question from the PRODUCT, in <c>DfesLensExtractor</c> — an
/// <b>Application</b>-layer type that may not import Infrastructure. These entries used to
/// be a <c>private</c> array inside
/// <c>ShramSafal.Infrastructure.AI.DomainKnowledge.GrapeInputLexicon</c>, unreachable from
/// Application at any access level, so the table moved down rather than being copied.
/// <c>GrapeInputLexicon</c> keeps ALL of its fuzzy-matching machinery (Levenshtein ≤ 2 and
/// the phonetic consonant skeleton) and simply reads its entries from here — <b>one table,
/// two readers, never a second copy</b>.</para>
///
/// <para>Entries are drawn from the 18 real grape vlogs described in
/// <c>01_TRACK_A_CAPTURE_QUALITY.md</c> § Component 2. A product absent from this list
/// resolves to <see cref="WaterAffinity.Unknown"/> and keeps its water question — the
/// catalogue growing is what retires questions, and it must grow deliberately.</para>
/// </summary>
public static class GrapeProductRoles
{
    public static readonly IReadOnlyList<GrapeProduct> Entries =
    [
        new GrapeProduct(
            "Dormex",
            "hydrogen cyanamide",
            "dormancy-break paste",
            ["dormex", "dormox", "dormax"],
            ["डॉर्मेक्स", "डॉर्मेक्‍स"]),

        new GrapeProduct(
            "Ethrel",
            "ethephon PGR",
            "defoliation/ripening",
            ["ethrel", "ethephon", "ithrel", "ethril", "etrel"],
            ["इथरेल", "एथरेल", "इथ्रेल"]),

        new GrapeProduct(
            "6-BA",
            "cytokinin PGR",
            "berry sizing",
            ["6ba", "6 ba", "6b a", "6 b a", "sixba", "6-ba"],
            ["6-बीए", "सहा बीए", "बीए"]),

        new GrapeProduct(
            "CPPU",
            "cytokinin PGR",
            "berry sizing",
            ["cppu", "seepu", "cpu", "sepu"],
            ["सीपीपीयू", "सीपीयू"]),

        new GrapeProduct(
            "GA3",
            "gibberellin PGR",
            "berry elongation",
            ["ga3", "ga 3", "gibberellic acid", "gibrellic", "jibrelic"],
            ["जीए3", "जीए ३"]),

        new GrapeProduct(
            "Bavistin",
            "fungicide",
            "systemic fungicide",
            ["bavistin", "bavisteen", "bavistin", "bavistine"],
            ["बाविस्टीन", "बाविस्टिन"]),

        new GrapeProduct(
            "Curzate",
            "fungicide",
            "downy mildew control",
            ["curzate", "curzat", "cursate", "curzet", "curset"],
            ["कर्जट", "कुर्जट", "कर्ज़ट"]),

        new GrapeProduct(
            "Alphamethrin",
            "insecticide",
            "pyrethroid insecticide",
            ["alphamethrin", "alphametrin", "aplhamitren", "alphamitren",
             "alphamethrine", "alpha methrin", "alpha mitren", "alfamitren"],
            ["अल्फामेथ्रिन", "अल्फामिथ्रीन"]),

        new GrapeProduct(
            "Mancozeb",
            "fungicide",
            "contact fungicide",
            ["mancozeb", "mancozab", "mankozeb", "mancoseb"],
            ["मँकोजेब", "मँकोझेब"]),

        new GrapeProduct(
            "Copper sulfate",
            "fungicide",
            "Bordeaux mixture input",
            ["copper sulfate", "copper sulphate", "coppersulfate", "bluestone"],
            ["मोरचुद", "मोरचूद", "तांबे सल्फेट"]),

        new GrapeProduct(
            "Lime",
            "Bordeaux mixture input",
            "Bordeaux mixture alkalizer",
            ["lime", "chuna", "calcium hydroxide"],
            ["चुना", "चूना", "कळीचा चुना"]),

        new GrapeProduct(
            "Rally Gold",
            "fungicide",
            "systemic fungicide (myclobutanil)",
            ["rally gold", "rallygold", "rali gold", "rally", "raligold",
             "raligould", "rally gold", "ralligold"],
            ["रॅली gold", "रॅली गोल्ड", "रॅलीगोल्ड", "रॅली"]),

        new GrapeProduct(
            "PDH",
            "PGR adjuvant",
            "potassium di-hydrogen adjuvant",
            ["pdh", "p d h", "peedieach"],
            ["पीडीएच"]),
    ];
}
