// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WORK-ID, item I29; founder D-77, D-104a)
using System.Text.Json;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

/// <summary>
/// The vocabulary's own golden set: one table for "the same work said in different words", every answer explainable
/// (P4), no AI in the path. Pairs live in <c>work-identity-golden.json</c>; each is tried in both directions.
/// </summary>
public sealed class WorkIdentityGoldenSetTests
{
    private static JsonElement Golden()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Compare", "work-identity-golden.json")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "Compare", "work-identity-golden.json")));
        return doc.RootElement.Clone();
    }

    public static IEnumerable<object[]> SamePairs() => Pairs("same");

    public static IEnumerable<object[]> DifferentPairs() => Pairs("different");

    private static IEnumerable<object[]> Pairs(string kind) =>
        Golden().GetProperty(kind).EnumerateArray()
            .Select(p => new object[] { p.GetProperty("a").GetString()!, p.GetProperty("b").GetString()!, p.GetProperty("why").GetString()! });

    private static WorkIdentity Id(string words)
    {
        var identity = WorkRecogniser.Recognise(words);
        Assert.True(identity is not null, $"'{words}' should be recognised.");
        return identity!;
    }

    [Fact]
    public void The_golden_file_is_big_enough_and_names_the_current_vocabulary_version()
    {
        var golden = Golden();
        Assert.True(golden.GetProperty("same").GetArrayLength() >= 40);
        Assert.True(golden.GetProperty("different").GetArrayLength() >= 25);
        Assert.Equal(WorkVocabulary.Version, golden.GetProperty("vocabularyVersion").GetString());
    }

    [Theory]
    [MemberData(nameof(SamePairs))]
    public void Every_same_pair_matches_with_the_words_that_matched(string a, string b, string why)
    {
        foreach (var (left, right) in new[] { (a, b), (b, a) })
        {
            var match = WorkRecogniser.Same(Id(left), Id(right));
            Assert.True(match.Matched, $"'{left}' / '{right}' should be the same work ({why}); reason was '{match.ReasonKey}'.");
            Assert.False(string.IsNullOrWhiteSpace(match.ReasonKey));
            Assert.NotEmpty(match.MatchedWords);
        }
    }

    [Theory]
    [MemberData(nameof(DifferentPairs))]
    public void No_different_pair_matches(string a, string b, string why)
    {
        foreach (var (left, right) in new[] { (a, b), (b, a) })
        {
            var match = WorkRecogniser.Same(Id(left), Id(right));
            Assert.False(match.Matched, $"'{left}' / '{right}' must NOT be the same work ({why}); reason was '{match.ReasonKey}'.");
            Assert.False(string.IsNullOrWhiteSpace(match.ReasonKey));
        }
    }

    [Fact]
    public void Unknown_words_are_not_recognised_and_never_called_different()
    {
        foreach (var words in Golden().GetProperty("unknown").EnumerateArray().Select(e => e.GetString()!))
        {
            Assert.Null(WorkRecogniser.Recognise(words)); // R12: null, not a "different" work
        }

        Assert.Null(WorkRecogniser.Recognise(""));
        Assert.Null(WorkRecogniser.Recognise("   "));
    }

    [Fact]
    public void Foliar_nutrient_spray_is_the_spray_part_and_keeps_its_product()
    {
        var urea = Id("Spray Urea");
        Assert.Equal(WorkPart.Spray, urea.Part);
        Assert.Equal("nutrient", urea.Role);
        Assert.Equal("p-urea-n-46", urea.ProductKey);

        var boron = Id("बोरॉन फवारणी");
        Assert.Equal(WorkPart.Spray, boron.Part);
        Assert.Equal("nutrient", boron.Role);
        Assert.Equal("boron", boron.NutrientKey);
    }

    [Theory]
    [InlineData("फवारणीसाठी पाणी आणलं")]
    [InlineData("water for the spray tank")]
    [InlineData("Spray water 1000 L")]
    public void Water_named_as_a_spray_carrier_is_never_irrigation(string words)
    {
        Assert.Equal(WorkPart.Spray, Id(words).Part);
    }

    // ---- round 3: the ROLE level ----

    [Theory]
    [InlineData("मॅन्कोझेब फवारली", "बुरशीनाशक फवारणी", true)]
    [InlineData("निंबोळी अर्क फवारला", "कीटकनाशक फवारणी", true)]
    [InlineData("जीए बुडवणी", "संजीवक", true)]
    [InlineData("फवारणी केली", "बुरशीनाशक फवारणी", true)]
    [InlineData("कीटकनाशक फवारणी", "बुरशीनाशक फवारणी", false)]
    [InlineData("बोरॉन फवारणी", "बुरशीनाशक फवारणी", false)]
    [InlineData("तणनाशक फवारलं", "कीटकनाशक फवारणी", false)]
    [InlineData("बोरॉन फवारणी", "विद्राव्य खत 0:52:34 (ठिबकातून)", false)]
    public void Roles_decide_between_two_sprays(string a, string b, bool expected)
    {
        Assert.Equal(expected, WorkRecogniser.Same(Id(a), Id(b)).Matched);
        Assert.Equal(expected, WorkRecogniser.Same(Id(b), Id(a)).Matched);
    }

    [Theory]
    [InlineData("Spray Mancozeb", "बुरशीनाशक फवारणी", true)]
    [InlineData("Spray Imidacloprid", "कीटकनाशक फवारणी", true)]
    [InlineData("Fertilizer Boron", "बोरॉन फवारणी", true)]
    [InlineData("Fertilizer 19:19:19", "विद्राव्य खत", true)]
    [InlineData("Spray Mancozeb", "कीटकनाशक फवारणी", false)]
    [InlineData("Fertilizer Boron", "विद्राव्य खत 0:52:34 (ठिबकातून)", false)]
    [InlineData("Fertilizer Urea", "विद्राव्य खत 0:52:34 (ठिबकातून)", false)]
    public void Roles_on_real_record_shapes(string a, string b, bool expected)
    {
        Assert.Equal(expected, WorkRecogniser.Same(Id(a), Id(b)).Matched);
        Assert.Equal(expected, WorkRecogniser.Same(Id(b), Id(a)).Matched);
    }

    [Fact]
    public void Role_and_nutrient_key_follow_the_one_rule()
    {
        var mancozeb = Id("Spray Mancozeb");
        Assert.Equal("fungicide", mancozeb.Role);
        Assert.Null(mancozeb.ProductKey); // ambiguous in the catalogue: no single product

        Assert.Equal("insecticide", Id("निंबोळी अर्क फवारला").Role);
        Assert.Equal("pgr", Id("जीए बुडवणी").Role);
        Assert.Equal("herbicide", Id("तणनाशक फवारलं").Role);

        var grade = Id("विद्राव्य खत 0:52:34 (ठिबकातून)");
        Assert.Equal(WorkPart.Nutrition, grade.Part);
        Assert.Equal("nutrient", grade.Role);
        Assert.Equal("npk-0-52-34", grade.NutrientKey);

        Assert.Equal("npk-19-19-19", Id("Fertilizer 19:19:19").NutrientKey);
        Assert.Equal("urea", Id("Fertilizer Urea").NutrientKey);
        Assert.Equal("boron", Id("Fertilizer Boron").NutrientKey);

        // a plain line carries no role (D-104a: "फवारणी केली" carries no role)
        Assert.Null(Id("फवारणी केली").Role);
        Assert.Null(Id("Fertigation").Role);
        Assert.Null(Id("ठिबक सिंचन").Role);
    }

    [Fact]
    public void An_ambiguous_product_with_mixed_categories_gives_no_role()
    {
        var match = InputCatalog.Match("fipronil", null);
        Assert.Equal(MatchState.Ambiguous, match.State);
        var categories = match.CandidateIds.Select(i => InputCatalog.Get(i)!.Category).Distinct().ToList();
        Assert.True(categories.Count > 1, "the test needs a name whose candidates differ in category");

        var identity = Id("Spray Fipronil");
        Assert.Equal(WorkPart.Spray, identity.Part);
        Assert.Null(identity.Role);
    }

    [Fact]
    public void Answers_carry_the_vocabulary_and_catalog_versions()
    {
        var a = Id("Spray Mancozeb");
        var b = Id("बुरशीनाशक फवारणी");
        Assert.Equal(WorkVocabulary.Version, a.VocabularyVersion);
        Assert.Equal(InputCatalog.Version, a.CatalogVersion);
        var match = WorkRecogniser.Same(a, b);
        Assert.Equal(WorkVocabulary.Version, match.VocabularyVersion);
        Assert.Equal(InputCatalog.Version, match.CatalogVersion);
    }

    // ---- the founder-approved worked plot (index-L8R3.html): titles as the page names their work ----

    private static readonly (string Title, string Key)[] PageWork =
    [
        ("ठिबक सिंचन", "irrigation:drip"),
        ("विद्राव्य खत 0:52:34 (ठिबकातून)", "nutrient:npk-0-52-34"),
        ("बुरशीनाशक फवारणी", "spray:fungicide"),
        ("जीए (संजीवक) बुडवणी", "spray:pgr"),
        ("घड विरळणी", "work:bunch-thinning"),
        ("कीटकनाशक फवारणी", "spray:insecticide"),
        ("पानांची तपासणी", "work:leaf-check"),
        ("बोरॉन फवारणी", "nutrient:boron"),
        ("खुरपणी (गवत काढणे)", "work:weeding"),
        ("खुरपणी केली", "work:weeding"),
        ("वेली बांधणी", "work:vine-tying"),
    ];

    [Fact]
    public void The_confirmation_pages_titles_recognise_as_the_page_counts()
    {
        foreach (var (title, key) in PageWork)
        {
            var identity = Id(title);
            switch (key.Split(':')[0])
            {
                case "irrigation":
                    Assert.Equal(WorkPart.Irrigation, identity.Part);
                    Assert.Null(identity.Role);
                    break;
                case "work":
                    Assert.Equal(WorkPart.Work, identity.Part);
                    Assert.Null(identity.Role);
                    break;
                case "spray":
                    Assert.Equal(WorkPart.Spray, identity.Part);
                    Assert.Equal(key.Split(':')[1], identity.Role);
                    break;
                case "nutrient":
                    Assert.Equal("nutrient", identity.Role);
                    Assert.Equal(key.Split(':')[1], identity.NutrientKey);
                    break;
            }
        }

        // The page counts by key: two titles are the same work exactly when the page gives them the same key.
        foreach (var (titleA, keyA) in PageWork)
        {
            foreach (var (titleB, keyB) in PageWork)
            {
                var match = WorkRecogniser.Same(Id(titleA), Id(titleB));
                Assert.True(match.Matched == (keyA == keyB), $"'{titleA}' ({keyA}) / '{titleB}' ({keyB}) -> {match.ReasonKey}");
            }
        }

        // "वेली बांधणी" is recognised, in the Work part, and matches none of the page's other works.
        var tying = Id("वेली बांधणी");
        Assert.Equal(WorkPart.Work, tying.Part);
        Assert.All(PageWork.Where(p => p.Key != "work:vine-tying"), p => Assert.False(WorkRecogniser.Same(tying, Id(p.Title)).Matched));
    }

    // ---- CompareEngine.Categorize stays the thin wrapper with its old bucket names (P11) ----

    /// <summary>The old rule, copied here as the oracle: what <c>Categorize</c> answered before this lane.</summary>
    private static string Legacy(string activityName)
    {
        var n = activityName.Trim().ToLowerInvariant();
        if (n.Contains("spray") || n.Contains("pesticide") || n.Contains("fungicide")) return "spray";
        if (n.Contains("fert") || n.Contains("urea") || n.Contains("dap") || n.Contains("nutri")) return "fertigation";
        if (n.Contains("irrig") || n.Contains("water")) return "irrigation";
        return "activity";
    }

    private static readonly string[] EnglishNames =
    [
        "Foliar Spray", "Drip Irrigation", "Spray Mancozeb", "Spray Sulphur", "Irrigation", "Fertigation", "Fertilizer Urea",
        "Fertilizer 19:19:19", "Foliar Spray with Sticker", "Spraying", "Fertilizer application", "Observation", "Machinery",
        "Reminder", "Pruning", "Weeding", "Harvest", "Insecticide", "Herbicide application", "Basal DAP", "Nutrition schedule",
        "Pesticide", "Fungicide drench", "Water pump check", "Repair pipe", "Pipe repair", "Watering", "Top dressing",
        "Thinning", "Dormex paste", "Vine tying", "Leaf check", "Pest scouting", "Soil test", "Planting", "", "  SPRAY  ",
        "Urea", "dap", "Nutri spray", "spray water", "Staking", "Intercultural operation", "Hydration", "Adaptation",
    ];

    [Fact]
    public void Every_english_pair_in_CompareEngineTests_keeps_todays_answer()
    {
        foreach (var name in EnglishNames)
        {
            Assert.Equal(Legacy(name), CompareEngine.Categorize(name));
        }

        // the exact names CompareEngineTests / the matcher tests feed it
        Assert.Equal("spray", CompareEngine.Categorize("Foliar Spray"));
        Assert.Equal("irrigation", CompareEngine.Categorize("Drip Irrigation"));
        Assert.Equal("fertigation", CompareEngine.Categorize("Fertilizer Urea"));
        Assert.Equal("activity", CompareEngine.Categorize("Pruning"));
    }

    [Fact]
    public void Marathi_names_that_Categorize_could_not_place_now_get_their_kind()
    {
        Assert.Equal("spray", CompareEngine.Categorize("फवारणी"));
        Assert.Equal("fertigation", CompareEngine.Categorize("खत टाकलं"));
        Assert.Equal("irrigation", CompareEngine.Categorize("पाणी दिलं"));
        Assert.Equal("activity", CompareEngine.Categorize("छाटणी"));
        Assert.Equal("activity", CompareEngine.Categorize("गाडी धुतली"));
    }
}
