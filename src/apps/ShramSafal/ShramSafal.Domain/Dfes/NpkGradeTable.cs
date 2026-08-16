// spec: dfes-companion-2026-07-11 (wave-3.4)
namespace ShramSafal.Domain.Dfes;

/// <summary>
/// The canonical set of KNOWN water-soluble NPK grades, keyed by their normalized hyphen
/// form and valued by the human-readable product identity used in grape context.
///
/// <para><b>Why it lives in Domain.</b> Founder decision 14 (2026-08-16) decides the
/// water/carrier question from the PRODUCT, and that decision is made by
/// <c>DfesLensExtractor</c>, which sits in the <b>Application</b> layer and may not import
/// Infrastructure. The table used to be a <c>private</c> field of
/// <c>ShramSafal.Infrastructure.AI.DomainKnowledge.NpkGradeDictionary</c>, invisible to
/// Application at any access level. It moved down here so BOTH readers share it —
/// the STT colon-triple rescue (Infrastructure) and the water-affinity rule
/// (<see cref="ProductWaterAffinity"/>). <b>One table, two readers — never two
/// copies</b>, or the two would drift and the same grade would classify differently
/// depending on which code path saw it.</para>
///
/// <para><b>What membership MEANS.</b> A key here is a recognised water-soluble
/// fertiliser (WSF) grade. WSFs only exist dissolved, so membership is precisely what
/// makes the founder's own example — a farmer saying "0 52 34 दिल" — self-classifying
/// with no flag anywhere and no change to the AI. The grade IS the signal.</para>
///
/// <para><b>Deliberately short.</b> A grade absent from this table is UNKNOWN, not
/// "not water-soluble": <see cref="ProductWaterAffinity"/> keeps asking on Unknown
/// (doctrine P4). Adding a grade here therefore retires a question and must be a
/// deliberate, agronomically-checked act — never a convenience.</para>
/// </summary>
public static class NpkGradeTable
{
    public static readonly IReadOnlyDictionary<string, string> KnownGrades =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
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
}
