using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice AI, founder 28 Nov 2026) — the <c>keyterms</c> of the speech-to-text calls:
/// the words Sarvam's saaras:v4 is nudged to expect, so a Marathi sentence with English chemical names ("इमिडाक्लोप्रिड" /
/// "Imidacloprid", "Mancozeb") keeps those names whole instead of breaking them into near-sounding Marathi words.
///
/// <para><b>What Sarvam allows</b> (docs.sarvam.ai, read 28 Nov): an optional list of at most <see cref="MaxTerms"/> terms of at most
/// <see cref="MaxTermChars"/> characters, sent as ONE JSON-array text in a form field named <c>keyterms</c>, saaras:v4 only. It only
/// BIASES the answer — a term is never guaranteed to appear — so nothing here may be treated as truth about what he said.</para>
///
/// <para><b>Which 50 (the rule, so it can be explained and re-run).</b> There is no farm usage data yet, so the list is a function of
/// ShramSafal's own product library, not a guess:
/// <list type="number">
/// <item>The <see cref="PilotCrops"/> he is asked to pick a plot for (Marathi, 6 slots).</item>
/// <item>One household brand, <see cref="ApprovedExampleBrand"/>: the founder-approved example sentence the recording screen teaches
/// him to say ("कॉन्फिडॉर अडीचशे एमएल"). Taken in the library's own spelling, and only if the library holds it.</item>
/// <item>The rest (43) are active-ingredient names (the long English words, where the bias helps most), chosen GREEDILY by coverage:
/// first the name held by the most library products, then the name that adds the most products not yet covered, and so on. So the 43
/// names between them reach as many of the library's products as 43 names can. Ties go to the name held by more products, then A-Z.</item>
/// </list>
/// Brand names are not ranked because the library gives no sign which of its 311 brands farmers say; once the pilot has real logs the
/// better list is each farmer's own most-used products (a follow-up, needs a read of his recent inputs).</para>
///
/// <para>Computed once from the live library (the published copy when one was placed, else the embedded seed), so the list follows the
/// library on its own and never drifts from what <see cref="InputCatalog.Match"/> will accept. It can never block a transcription:
/// any failure gives an empty list and the call goes without keyterms.</para>
/// </summary>
internal static class SttKeyterms
{
    /// <summary>Sarvam's limit: terms per call.</summary>
    public const int MaxTerms = 50;

    /// <summary>Sarvam's limit: characters per term.</summary>
    public const int MaxTermChars = 64;

    /// <summary>The model that accepts keyterms (any other model is sent none, whatever the options say).</summary>
    public const string SupportedModelPrefix = "saaras:v4";

    /// <summary>The plots he picks for, in Marathi: grapes, pomegranate, onion, sugarcane, cotton, soybean.</summary>
    internal static readonly IReadOnlyList<string> PilotCrops = ["द्राक्ष", "डाळिंब", "कांदा", "ऊस", "कापूस", "सोयाबीन"];

    /// <summary>The brand of the approved example sentence (matched case-insensitively against the library's brands and aliases).</summary>
    internal const string ApprovedExampleBrand = "Confidor";

    private static readonly Regex Parenthetical = new(@"\s*\([^)]*\)", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions WireJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static readonly Lazy<IReadOnlyList<string>> CurrentList = new(() =>
    {
        try
        {
            return Build(InputCatalog.Products, InputCatalog.NonMatchingWords);
        }
        catch (Exception)
        {
            // The library could not be read: speech-to-text goes on without keyterms, as it always did.
            return [];
        }
    });

    /// <summary>The list for this process, from the live library.</summary>
    public static IReadOnlyList<string> Current => CurrentList.Value;

    /// <summary>The wire value of <c>keyterms</c>: a JSON array text, or null when there is nothing to send.</summary>
    public static string? ToFormValue(IReadOnlyList<string> terms) =>
        terms.Count == 0 ? null : JsonSerializer.Serialize(terms, WireJson);

    /// <summary>Does this model take keyterms? (Sarvam: saaras:v4 only.)</summary>
    public static bool ModelSupports(string? model) =>
        !string.IsNullOrWhiteSpace(model) && model.Trim().StartsWith(SupportedModelPrefix, StringComparison.OrdinalIgnoreCase);

    public static IReadOnlyList<string> Build(IReadOnlyList<CatalogProduct> products, IReadOnlyList<string> nonMatchingWords)
    {
        var common = new HashSet<string>(nonMatchingWords.Select(w => w.Trim()), StringComparer.OrdinalIgnoreCase);
        var terms = new List<string>(MaxTerms);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        bool Add(string? raw)
        {
            var term = Clean(raw);
            return term is not null && !common.Contains(term) && seen.Add(term) && AddTo(terms, term);
        }

        foreach (var crop in PilotCrops)
        {
            Add(crop);
        }

        // The library's own spelling when a brand carries it (the alias list is lower-case); the constant when only an alias does.
        var brand = products.SelectMany(p => p.Brands).Select(b => b.En?.Trim())
                .FirstOrDefault(n => string.Equals(n, ApprovedExampleBrand, StringComparison.OrdinalIgnoreCase))
            ?? (products.Any(p => p.Aliases.Any(a => string.Equals(a?.Trim(), ApprovedExampleBrand, StringComparison.OrdinalIgnoreCase)))
                ? ApprovedExampleBrand
                : null);
        if (brand is not null)
        {
            Add(brand);
        }

        // Ingredient names, greedy by coverage. One set of cleaned names per product (a mixture holds several).
        var perProduct = products
            .Select(p => p.ActiveIngredients.Select(i => Clean(i.En)).Where(n => n is not null && !common.Contains(n!)).Select(n => n!)
                .ToHashSet(StringComparer.OrdinalIgnoreCase))
            .ToList();
        var holders = new Dictionary<string, HashSet<int>>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < perProduct.Count; i++)
        {
            foreach (var name in perProduct[i])
            {
                if (!holders.TryGetValue(name, out var set))
                {
                    holders[name] = set = [];
                }

                set.Add(i);
            }
        }

        var covered = new HashSet<int>();
        var remaining = holders.Keys.Where(n => !seen.Contains(n)).ToList();
        while (terms.Count < MaxTerms && remaining.Count > 0)
        {
            var best = remaining
                .Select(n => (Name: n, Gain: holders[n].Count(p => !covered.Contains(p)), Total: holders[n].Count))
                .OrderByDescending(x => x.Gain)
                .ThenByDescending(x => x.Total)
                .ThenBy(x => x.Name, StringComparer.Ordinal)
                .First();
            remaining.Remove(best.Name);
            covered.UnionWith(holders[best.Name]);
            Add(best.Name);
        }

        return terms;
    }

    private static bool AddTo(List<string> terms, string term)
    {
        if (terms.Count >= MaxTerms)
        {
            return false;
        }

        terms.Add(term);
        return true;
    }

    /// <summary>A term as it is sent: no bracketed notes, single spaces, at most 64 characters, no digits (strengths and grades are not words he says as a name); null when nothing is left.</summary>
    internal static string? Clean(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var term = Parenthetical.Replace(raw, string.Empty);
        term = string.Join(' ', term.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (term.Length == 0 || term.Length > MaxTermChars || term.Any(char.IsDigit))
        {
            return null;
        }

        return term;
    }
}
