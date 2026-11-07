// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1b)
using System.Text.RegularExpressions;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The library's shape (<c>catalog.json</c>, version <c>inputs-2</c>): ids are ShramSafal's own and no
/// source owns one; every product names where it came from through <c>sourceRefs</c>, and each ref
/// points at a source the library lists. Read from the shared file, so the phone's twin in
/// <c>sync-contract/tests/inputReference.test.ts</c> holds the same data to the same rules.
/// </summary>
public sealed class InputLibraryShapeTests
{
    private static readonly Regex OwnId = new("^p-[a-z0-9-]+$", RegexOptions.CultureInvariant);
    private static readonly Regex SourceId = new("^g[0-9]+$", RegexOptions.CultureInvariant);

    private static System.Text.Json.JsonElement Catalog => InputReferenceFiles.Read("catalog.json");

    [Fact]
    public void Catalog_EveryProduct_HasAtLeastOneSourceRef()
    {
        foreach (var p in Catalog.GetProperty("products").EnumerateArray())
        {
            Assert.True(p.GetProperty("sourceRefs").GetArrayLength() >= 1, p.GetProperty("id").GetString());
        }
    }

    [Fact]
    public void Catalog_Ids_AreUniqueAndCarryNoSourcePrefix()
    {
        var ids = Catalog.GetProperty("products").EnumerateArray().Select(p => p.GetProperty("id").GetString()!).ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
        foreach (var id in ids)
        {
            Assert.DoesNotMatch(SourceId, id);
            Assert.Matches(OwnId, id);
        }
    }

    [Fact]
    public void Catalog_SourceRef_PointsAtAListedSource()
    {
        var sources = Catalog.GetProperty("sources").EnumerateArray().Select(s => s.GetProperty("id").GetString()!).ToHashSet();
        Assert.NotEmpty(sources);
        foreach (var p in Catalog.GetProperty("products").EnumerateArray())
        {
            foreach (var r in p.GetProperty("sourceRefs").EnumerateArray())
            {
                Assert.Contains(r.GetProperty("source").GetString()!, sources);
                Assert.False(string.IsNullOrWhiteSpace(r.GetProperty("ref").GetString()));
            }
        }
    }

    [Fact]
    public void Catalog_IdsAreStoredNotDerived()
    {
        // Pinned: a regenerate that moves an id fails here. Ids are data from the day they were written.
        var pinned = new Dictionary<string, string>
        {
            ["line 38"] = "p-abamectin-1-9-ec",
            ["line 55"] = "p-acephate-50-imidacloprid-1-8-sp",
            ["line 1485"] = "p-brand-dhaman-bio-303",
            ["line 3149"] = "p-npk-19-19-19",
            ["line 3227"] = "p-calcium-nitrate",
        };
        var byRef = Catalog.GetProperty("products").EnumerateArray()
            .ToDictionary(p => p.GetProperty("sourceRefs")[0].GetProperty("ref").GetString()!, p => p.GetProperty("id").GetString()!);
        foreach (var (line, id) in pinned)
        {
            Assert.Equal(id, byRef[line]);
        }
    }

    [Fact]
    public void Catalog_Loaded_ExposesVersionSourcesAndSourceRefs()
    {
        Assert.Equal("inputs-2", InputCatalog.Version);
        var guide = Assert.Single(InputCatalog.Sources);
        Assert.Equal("agro-dosage-guide-en", guide.Id);
        Assert.Equal("guide", guide.Kind);
        var p = InputCatalog.Get("p-abamectin-1-9-ec")!;
        Assert.Equal("agro-dosage-guide-en", p.SourceRefs[0].Source);
        Assert.Equal("line 38", p.SourceRefs[0].Ref);
    }
}
