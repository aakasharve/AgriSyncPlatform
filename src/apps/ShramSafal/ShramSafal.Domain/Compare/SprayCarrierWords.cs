namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WORK-ID, item I29)
/// <summary>
/// The words that say "water here is the carrier of a spray, not irrigation". MOVED out of
/// <c>ShramSafal.Infrastructure.AI.DomainKnowledge.WaterRoleClassifier</c> (an <c>internal</c> Infrastructure type that
/// Domain cannot call): the classifier now reads this Domain copy, and so does <see cref="WorkRecogniser"/> - one table,
/// two readers, never two copies (the <c>GrapeProductRoles</c> pattern). Pure: no I/O.
/// </summary>
public static class SprayCarrierWords
{
    /// <summary>
    /// "फवारण" (spraying) and "मारल" (colloquial "applied/sprayed"). A transcript containing either has a spray verb.
    /// These two stems are exactly what the classifier's old <c>फवारण|मारल</c> pattern held.
    /// </summary>
    public static readonly IReadOnlyList<string> SprayVerbStems = ["फवारण", "मारल"];

    /// <summary>Words for water as a thing (a carrier or an irrigation water): Marathi "पाणी" (and its inflections) and English.</summary>
    public static readonly IReadOnlyList<string> WaterStems = ["पाणी", "पाण्", "water"];

    /// <summary>Does the text hold a spray verb (the classifier's spray-verb test)?</summary>
    public static bool HasSprayVerb(string text)
    {
        foreach (var stem in SprayVerbStems)
        {
            if (text.Contains(stem, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Does the text name water?</summary>
    public static bool HasWater(string text)
    {
        foreach (var stem in WaterStems)
        {
            if (text.Contains(stem, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Is water named here as a spray carrier: a spray word (a spray verb, "फवार", or "spray") together with a water word?
    /// "फवारणीसाठी पाणी आणलं" is spray work; it is never irrigation.
    /// </summary>
    public static bool IsSprayCarrierPhrase(string text)
    {
        var spray = HasSprayVerb(text)
            || text.Contains("फवार", StringComparison.Ordinal)
            || text.Contains("spray", StringComparison.OrdinalIgnoreCase);
        return spray && HasWater(text);
    }
}
