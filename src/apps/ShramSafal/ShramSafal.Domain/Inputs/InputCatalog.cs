// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 2)
using System.Text;
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Inputs;

/// <summary>
/// His spoken product name to a catalogue product. The phone's <c>domain/inputs/inputCatalog.ts</c>
/// is the twin of this class; both run <c>sync-contract/reference/inputs/match-cases.json</c> and must
/// give identical answers.
///
/// <para><b>Exact match only</b> (Review Focus 1). After normalising (NFC, lowercase, drop
/// <c>- . ,</c>, Devanagari digits to ASCII, collapse whitespace, trim) the name must equal an alias, a
/// brand's English or Marathi name, or an ingredient's English or Marathi name. There is no fuzzy
/// match: a near spelling is <see cref="MatchState.NotFound"/>.</para>
///
/// <para><b>An ingredient name is a generic word.</b> It is Found only when exactly one product holds
/// that ingredient and that product is single-ingredient. When two or more products hold it (single
/// products and mixtures alike) every one of them is a candidate, so the answer is Ambiguous. A name
/// held only by one mixture matches nothing: a mixture is never Found by one of its ingredients.</para>
///
/// <para><b>More than one product</b> carrying the name is <see cref="MatchState.Ambiguous"/>, never
/// the first-listed one (Review Focus 2). When an NPK grade is given and a product carries that grade,
/// the grade wins over the name; a grade no product carries falls back to the name.</para>
///
/// <para><b>Common words never match</b> (review B008). A spoken name equal to one of the catalogue's
/// <c>nonMatchingWords</c> (a common English or Marathi word that is also printed as a brand, such as
/// "root" or "double") is <see cref="MatchState.NotFound"/>, so he gets the photo option. The brand still
/// shows on its product card.</para>
///
/// <para>Pure: it reads only the library (today the embedded catalogue, through one loader function) and never changes what he said (P7).</para>
/// </summary>
public static class InputCatalog
{
    private sealed record CatalogFile(string Version, IReadOnlyList<CatalogSource> Sources, IReadOnlyList<string>? NonMatchingWords, IReadOnlyList<CatalogProduct> Products);

    private static readonly Regex Whitespace = new(
        "[ \\t\\n\\r\\f\\v\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+",
        RegexOptions.CultureInvariant);

    private static readonly Regex Digits = new("[0-9]+", RegexOptions.CultureInvariant);

    // THE LOADER SEAM: the one place the library is read. It is the server's published copy when the host placed
    // one (lane IT1c, PublishedInputLibrary), else the embedded resource. Nothing else in this class reads the JSON.
    private static readonly (byte[] Raw, CatalogFile Data) Library = LoadLibrary();
    private static readonly byte[] Raw = Library.Raw;
    private static readonly CatalogFile Data = Library.Data;
    private static readonly Dictionary<string, CatalogProduct> ById = Data.Products.ToDictionary(p => p.Id, StringComparer.Ordinal);
    private static readonly Dictionary<string, int> Order = Data.Products.Select((p, i) => (p.Id, i)).ToDictionary(x => x.Id, x => x.i, StringComparer.Ordinal);
    private static readonly Dictionary<string, List<string>> NameIndex = BuildNameIndex(Data.Products);
    private static readonly Dictionary<string, List<string>> HolderIndex = BuildHolderIndex(Data.Products);
    private static readonly Dictionary<string, List<string>> GradeIndex = BuildGradeIndex(Data.Products);
    private static readonly HashSet<string> NonMatching = new(
        (Data.NonMatchingWords ?? []).Select(NormaliseSpokenName).Where(w => w.Length > 0), StringComparer.Ordinal);

    /// <summary>The catalogue version (<c>inputs-2</c>), stored with every identity answer.</summary>
    public static string Version => Data.Version;

    /// <summary>The sources the library lists (the founder's dosage guide is source 1).</summary>
    public static IReadOnlyList<CatalogSource> Sources => Data.Sources;

    /// <summary>Common words that never match a product, as listed in the catalogue.</summary>
    public static IReadOnlyList<string> NonMatchingWords => Data.NonMatchingWords ?? [];

    /// <summary>Every product, in catalogue order.</summary>
    public static IReadOnlyList<CatalogProduct> Products => Data.Products;

    /// <summary>The library's bytes as this process read them: the published copy when one was placed, else the embedded
    /// catalogue exactly as generated (a copy).</summary>
    public static byte[] RawJson() => (byte[])Raw.Clone();

    /// <summary>The product with this id, or <c>null</c>.</summary>
    public static CatalogProduct? Get(string productId) =>
        productId is not null && ById.TryGetValue(productId, out var p) ? p : null;

    /// <summary>Matches his spoken name (and the grade he said, if any) to the catalogue.</summary>
    public static ProductMatch Match(string spokenName, string? npkGrade)
    {
        var grade = NormaliseNpkGrade(npkGrade);
        if (grade is not null && GradeIndex.TryGetValue(grade, out var byGrade))
        {
            return From(byGrade);
        }

        var key = NormaliseSpokenName(spokenName);
        if (key.Length == 0 || NonMatching.Contains(key))
        {
            return new ProductMatch(MatchState.NotFound, null, []);
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        if (NameIndex.TryGetValue(key, out var byName))
        {
            ids.UnionWith(byName);
        }

        if (HolderIndex.TryGetValue(key, out var holders)
            && (holders.Count >= 2 || ById[holders[0]].ActiveIngredients.Count == 1))
        {
            ids.UnionWith(holders);
        }

        return ids.Count == 0
            ? new ProductMatch(MatchState.NotFound, null, [])
            : From(ids.OrderBy(id => Order[id]).ToList());
    }

    private static (byte[] Raw, CatalogFile Data) LoadLibrary()
    {
        // spec: lane IT1c Task 2 - the server's PUBLISHED copy, when the host placed one before first use
        // (PublishedInputLibrary); the embedded seed (source 1) when none was placed or the copy does not parse.
        var published = PublishedInputLibrary.TakeForCatalog();
        if (published is not null && PublishedInputLibrary.Validate(published) is null
            && System.Text.Json.JsonSerializer.Deserialize<CatalogFile>(published, InputReferenceResource.JsonOptions) is { } publishedData)
        {
            return (published, publishedData);
        }

        var raw = InputReferenceResource.ReadBytes("catalog.json");
        var data = System.Text.Json.JsonSerializer.Deserialize<CatalogFile>(raw, InputReferenceResource.JsonOptions)
            ?? throw new InvalidOperationException("Embedded resource 'catalog.json' is empty.");
        return (raw, data);
    }

    /// <summary>NFC, lowercase, drop <c>- . ,</c>, Devanagari digits to ASCII, collapse whitespace, trim.</summary>
    public static string NormaliseSpokenName(string? spokenName)
    {
        if (string.IsNullOrEmpty(spokenName))
        {
            return string.Empty;
        }

        var lowered = spokenName.Normalize(NormalizationForm.FormC).ToLowerInvariant();
        var sb = new StringBuilder(lowered.Length);
        foreach (var c in lowered)
        {
            if (c is '-' or '.' or ',')
            {
                continue;
            }

            sb.Append(MapDigit(c));
        }

        return Whitespace.Replace(sb.ToString(), " ").Trim(' ');
    }

    /// <summary>An NPK grade as whole numbers joined by colons (<c>००:५२:३४</c> → <c>0:52:34</c>), or
    /// <c>null</c> when fewer than three numbers are present.</summary>
    public static string? NormaliseNpkGrade(string? npkGrade)
    {
        if (string.IsNullOrWhiteSpace(npkGrade))
        {
            return null;
        }

        var mapped = new string(npkGrade.Select(MapDigit).ToArray());
        var parts = Digits.Matches(mapped).Select(m => m.Value.TrimStart('0')).Select(v => v.Length == 0 ? "0" : v).ToList();
        return parts.Count < 3 ? null : string.Join(":", parts);
    }

    private static char MapDigit(char c) => c is >= '\u0966' and <= '\u096F' ? (char)('0' + (c - '\u0966')) : c;

    private static ProductMatch From(List<string> ids) => ids.Count == 1
        ? new ProductMatch(MatchState.Found, ids[0], [ids[0]])
        : new ProductMatch(MatchState.Ambiguous, null, ids.ToArray());

    private static Dictionary<string, List<string>> BuildNameIndex(IReadOnlyList<CatalogProduct> products)
    {
        var index = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var p in products)
        {
            var names = new List<string?>();
            names.AddRange(p.Aliases);
            foreach (var b in p.Brands)
            {
                names.Add(b.En);
                names.Add(b.Mr);
            }

            foreach (var name in names)
            {
                Add(index, NormaliseSpokenName(name), p.Id);
            }
        }

        return index;
    }

    /// <summary>Ingredient name → every product holding that ingredient (single products and mixtures).</summary>
    private static Dictionary<string, List<string>> BuildHolderIndex(IReadOnlyList<CatalogProduct> products)
    {
        var index = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var p in products)
        {
            foreach (var a in p.ActiveIngredients)
            {
                Add(index, NormaliseSpokenName(a.En), p.Id);
                Add(index, NormaliseSpokenName(a.Mr), p.Id);
            }
        }

        return index;
    }

    private static Dictionary<string, List<string>> BuildGradeIndex(IReadOnlyList<CatalogProduct> products)
    {
        var index = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var p in products)
        {
            var grade = NormaliseNpkGrade(p.NpkGrade);
            if (grade is not null)
            {
                Add(index, grade, p.Id);
            }
        }

        return index;
    }

    private static void Add(Dictionary<string, List<string>> index, string key, string id)
    {
        if (key.Length == 0)
        {
            return;
        }

        if (!index.TryGetValue(key, out var ids))
        {
            index[key] = ids = [];
        }

        if (!ids.Contains(id, StringComparer.Ordinal))
        {
            ids.Add(id);
        }
    }
}
