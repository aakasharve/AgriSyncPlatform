// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 2)
using System.Text.Json;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// His word to a catalogue product. The cases live ONCE in
/// <c>sync-contract/reference/inputs/match-cases.json</c>; the phone's <c>inputCatalog.test.ts</c>
/// runs the same file, so server and phone give identical answers.
///
/// Exact match only (Review Focus 1): a near spelling is NotFound, never half credit.
/// One alias on two products (Review Focus 2) is Ambiguous, never the first-listed product.
/// </summary>
public sealed class InputCatalogMatchTests
{
    public static IEnumerable<object[]> SharedCases()
    {
        foreach (var c in InputReferenceFiles.Read("match-cases.json").EnumerateArray())
        {
            yield return [c.GetProperty("name").GetString()!, c.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(SharedCases))]
    public void Match_SharedCase_GivesTheExpectedAnswer(string name, string caseJson)
    {
        using var doc = JsonDocument.Parse(caseJson);
        var c = doc.RootElement;
        var grade = c.GetProperty("npkGrade").ValueKind == JsonValueKind.Null
            ? null
            : c.GetProperty("npkGrade").GetString();
        var expect = c.GetProperty("expect");

        var match = InputCatalog.Match(c.GetProperty("spoken").GetString()!, grade);

        Assert.True(Enum.TryParse<MatchState>(expect.GetProperty("state").GetString(), ignoreCase: true, out var state), name);
        Assert.Equal(state, match.State);
        Assert.Equal(
            expect.GetProperty("productId").ValueKind == JsonValueKind.Null ? null : expect.GetProperty("productId").GetString(),
            match.ProductId);
        Assert.Equal(
            expect.GetProperty("candidateIds").EnumerateArray().Select(x => x.GetString()!).ToArray(),
            match.CandidateIds.ToArray());
    }

    [Fact]
    public void SharedCases_CarryThePinnedReviewFocusCases()
    {
        var names = SharedCases().Select(x => (string)x[0]).ToList();
        Assert.Contains(names, n => n.StartsWith("Match_NearSpelling_IsNotFound", StringComparison.Ordinal));
        Assert.Contains(names, n => n.StartsWith("Match_SharedAlias_IsAmbiguous", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("contaf plus")]
    [InlineData("contof plu")]
    [InlineData("कोंटाफ")]
    public void Match_NearSpelling_IsNotFound(string spoken)
    {
        var match = InputCatalog.Match(spoken, null);

        Assert.Equal(MatchState.NotFound, match.State);
        Assert.Null(match.ProductId);
        Assert.Empty(match.CandidateIds);
    }

    [Fact]
    public void Match_SharedAlias_IsAmbiguous()
    {
        var match = InputCatalog.Match("ga3", null);

        Assert.Equal(MatchState.Ambiguous, match.State);
        Assert.Null(match.ProductId);
        Assert.Equal(["p-gibberellic-acid-technical-90", "p-gibberellic-acid-40-wsg", "p-gibberellic-acid-0-001"], match.CandidateIds);
    }

    [Fact]
    public void Match_NpkGrade_WinsOverTheName()
    {
        Assert.Equal("p-npk-19-19-19", InputCatalog.Match("Contof Plus", "19:19:19").ProductId);
    }

    [Theory]
    [InlineData("  Contof\t  PLUS. ", "contof plus")]
    [InlineData("a-b.c,d", "abcd")]
    [InlineData("१९:१९:१९", "19:19:19")]
    [InlineData("", "")]
    public void NormaliseSpokenName_FollowsThePhoneRule(string raw, string expected)
    {
        Assert.Equal(expected, InputCatalog.NormaliseSpokenName(raw));
    }

    [Theory]
    [InlineData("००:५२:३४", "0:52:34")]
    [InlineData("19-19-19", "19:19:19")]
    [InlineData("19:19", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void NormaliseNpkGrade_ReadsWholeNumbersOrNull(string? raw, string? expected)
    {
        Assert.Equal(expected, InputCatalog.NormaliseNpkGrade(raw));
    }

    [Fact]
    public void Version_And_Get_ReadTheEmbeddedCatalogue()
    {
        Assert.Equal("inputs-2", InputCatalog.Version);
        Assert.Equal(297, InputCatalog.Products.Count);

        var p = InputCatalog.Get("p-hexaconazole-5-sc");
        Assert.NotNull(p);
        Assert.Equal("Hexaconazole", p!.ActiveIngredients[0].En);
        Assert.Equal("5%", p.ActiveIngredients[0].Pct);
        Assert.Equal("sc", p.Formulation!.Code);
        Assert.Equal("tata", p.Brands[0].Company);
        Assert.Null(InputCatalog.Get("nope"));
    }

    [Fact]
    public void EmbeddedCatalogue_IsTheReferenceFileByteForByte()
    {
        var reference = File.ReadAllBytes(InputReferenceFiles.Path("catalog.json"));
        Assert.Equal(reference, InputCatalog.RawJson());
    }

    public static IEnumerable<object[]> NonMatchingWords()
    {
        foreach (var w in InputReferenceFiles.Read("catalog.json").GetProperty("nonMatchingWords").EnumerateArray())
        {
            yield return [w.GetString()!];
        }
    }

    [Theory]
    [MemberData(nameof(NonMatchingWords))]
    public void Match_NonMatchingWord_IsNotFound(string word)
    {
        var match = InputCatalog.Match(word, null);

        Assert.Equal(MatchState.NotFound, match.State);
        Assert.Empty(match.CandidateIds);
        // The same word in a different case or with spaces is the same word.
        Assert.Equal(MatchState.NotFound, InputCatalog.Match("  " + word.ToUpperInvariant() + " ", null).State);
    }

    [Fact]
    public void NonMatchingWords_AreTheCatalogueList_AndBrandsStayOnTheirCards()
    {
        Assert.Contains("root", InputCatalog.NonMatchingWords);
        Assert.Contains("double", InputCatalog.NonMatchingWords);
        // The brand is not removed from its product: p-humic-acid-98 (was g259) still shows "Root".
        Assert.Contains(InputCatalog.Get("p-humic-acid-98")!.Brands, b => b.En == "Root");
    }

    [Fact]
    public void BrandOnlyProducts_CarryIngredientUnknown_AndCompanyMovesToTheProduct()
    {
        foreach (var id in new[] { "p-brand-dhaman-bio-303", "p-brand-orondis-ultra", "p-brand-diamore-combine", "p-brand-mc-extra", "p-brand-ralligold" })
        {
            var p = InputCatalog.Get(id)!;
            Assert.Empty(p.ActiveIngredients);
            Assert.True(p.IngredientUnknown, id);
        }

        var neem = InputCatalog.Get("p-neem-oil-3000-ppm")!;
        Assert.Equal("Dr. Anand", neem.Company);
        Assert.Empty(neem.Brands);
        Assert.False(neem.IngredientUnknown);
    }
}
