// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 3)
using System.Text.Json;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// Tank combinations and the sourced mixing verdict. The verdict cases live ONCE in
/// <c>sync-contract/reference/inputs/verdict-cases.json</c>; the phone's <c>mixVerdict.test.ts</c>
/// runs the same file. They are judged against the case file's own rules, marked reviewed HERE (a
/// test fixture), never by editing the data, so these tests keep passing after the founder fills
/// <c>reviewedBy</c>/<c>reviewedOn</c> in the live file.
///
/// Doctrine P4: red only from a sourced, reviewed rule, and only when the record says the
/// products shared a tank. Review Focus 5: an unknown member is never green.
/// </summary>
public sealed class MixVerdictTests
{
    private sealed record RulesFile(string Version, List<MixRule> Rules);

    private static readonly LocalizedText Text = new("चाचणी", "test");
    private static readonly RuleSource Source = new("Test source", "Test", "https://example.org/source", "2026-11-06");

    private static readonly MixRule NeverFixture = new(
        "T-NEVER", "never", new RuleSelector("calcium-source", null), new RuleSelector("phosphate-source", null),
        Text, Text, Text, [Source], "test-fixture", "2026-11-06", [MixVerdict.Fertigation, MixVerdict.Spray]);

    /// <summary>The case file's rules, marked reviewed in the test only.</summary>
    private static readonly IReadOnlyList<MixRule> CaseRules = JsonSerializer
        .Deserialize<RulesFile>(File.ReadAllText(InputReferenceFiles.Path("mix-rules.json")), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!
        .Rules.Select(r => r with { ReviewedBy = "test-fixture", ReviewedOn = "2026-11-06" })
        .ToArray();

    public static IEnumerable<object[]> SharedCases()
    {
        foreach (var c in InputReferenceFiles.Read("verdict-cases.json").EnumerateArray())
        {
            yield return [c.GetProperty("name").GetString()!, c.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(SharedCases))]
    public void JudgeProducts_SharedCase_GivesTheExpectedVerdict(string name, string caseJson)
    {
        using var doc = JsonDocument.Parse(caseJson);
        var c = doc.RootElement;
        var ids = c.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("productId").ValueKind == JsonValueKind.Null ? null : i.GetProperty("productId").GetString())
            .ToList();
        var expectedRule = c.GetProperty("ruleId").ValueKind == JsonValueKind.Null ? null : c.GetProperty("ruleId").GetString();
        var expectedPair = c.GetProperty("pairProductIds").EnumerateArray().Select(x => x.GetString()!).ToArray();

        var method = c.GetProperty("method").ValueKind == JsonValueKind.Null ? null : c.GetProperty("method").GetString();

        var result = MixVerdict.JudgeProducts(ids, method, CaseRules);

        Assert.True(Enum.TryParse<MixState>(c.GetProperty("expect").GetString(), ignoreCase: true, out var state), name);
        Assert.Equal(state, result.State);
        Assert.Equal(expectedRule, result.RuleId);
        Assert.Equal(expectedPair, result.PairProductIds.ToArray());
        if (state == MixState.Red)
        {
            Assert.False(string.IsNullOrWhiteSpace(result.Why!.Mr));
            Assert.False(string.IsNullOrWhiteSpace(result.NowDo!.En));
            Assert.False(string.IsNullOrWhiteSpace(result.NextTime!.Mr));
            Assert.NotEmpty(result.Sources);
        }
        else
        {
            Assert.Null(result.Why);
            Assert.Empty(result.Sources);
        }
    }

    private static JsonElement Inputs(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    /// <summary>A drip tank (fertigation) holding these items.</summary>
    private static Combination Tank(params (string Name, string? Grade)[] items) => TankBy(MixVerdict.Fertigation, items);

    private static Combination TankBy(string? method, params (string Name, string? Grade)[] items) =>
        new(items.Select((x, i) => new TankItem("e1", i, x.Name, x.Grade)).ToList(), method);

    [Fact]
    public void CombinationsOf_SameEventMix_IsOneCombination()
    {
        var combos = MixVerdict.CombinationsOf(Inputs("""
            [{ "id": "e1", "mix": [
                { "id": "m0", "productName": "calcium nitrate" },
                { "id": "m1", "productName": "19:19:19", "npkGrade": "19:19:19" } ] }]
            """));

        var combo = Assert.Single(combos);
        Assert.Null(combo.Method);
        Assert.Equal(
            new[] { new TankItem("e1", 0, "calcium nitrate", null), new TankItem("e1", 1, "19:19:19", "19:19:19") },
            combo.Items);
    }

    [Fact]
    public void CombinationsOf_SharedMixIdAcrossEvents_IsOneCombination()
    {
        var combos = MixVerdict.CombinationsOf(Inputs("""
            [
              { "id": "e1", "mixId": "m1", "mix": [{ "id": "a", "productName": "calcium nitrate" }] },
              { "id": "e2", "mix": [{ "id": "b", "productName": "contof plus" }] },
              { "id": "e3", "mixId": "m1", "mix": [{ "id": "c", "productName": "19:19:19" }] }
            ]
            """));

        var combo = Assert.Single(combos);
        Assert.Equal(
            new[] { ("e1", 0, "calcium nitrate"), ("e3", 0, "19:19:19") },
            combo.Items.Select(i => (i.InputEventId, i.MixIndex, i.SpokenName)).ToArray());
    }

    [Fact]
    public void CombinationsOf_SameDayDifferentEventsNoMixId_IsNone()
    {
        Assert.Empty(MixVerdict.CombinationsOf(Inputs("""
            [
              { "id": "e1", "mix": [{ "id": "a", "productName": "calcium nitrate" }] },
              { "id": "e2", "mix": [{ "id": "b", "productName": "19:19:19" }] }
            ]
            """)));
        Assert.Empty(MixVerdict.CombinationsOf(Inputs("""
            [
              { "id": "e1", "mixId": "  ", "mix": [{ "id": "a", "productName": "calcium nitrate" }] },
              { "id": "e2", "mixId": "  ", "mix": [{ "id": "b", "productName": "19:19:19" }] }
            ]
            """)));
    }

    [Theory]
    [InlineData("""[{ "id": "e1", "mix": [{ "id": "a", "productName": "calcium nitrate" }] }]""")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("""{ "inputs": [] }""")]
    [InlineData("""[{ "id": "e1" }]""")]
    [InlineData("""[42, "x", { "id": "e1", "mix": "nope" }]""")]
    public void CombinationsOf_SingleProductOrOddInput_IsNone(string json)
    {
        Assert.Empty(MixVerdict.CombinationsOf(Inputs(json)));
    }

    [Theory]
    [InlineData("Drip", MixVerdict.Fertigation)]
    [InlineData("fertigation", MixVerdict.Fertigation)]
    [InlineData(" DRIP ", MixVerdict.Fertigation)]
    [InlineData("Spray", MixVerdict.Spray)]
    [InlineData("foliar", MixVerdict.Spray)]
    [InlineData("Soil", null)]
    [InlineData("Drenching", null)]
    [InlineData("paste_manual", null)]
    [InlineData("basal", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void TankMethodOf_MapsThePhoneInputMethod(string? method, string? expected)
    {
        Assert.Equal(expected, MixVerdict.TankMethodOf(method));
    }

    [Fact]
    public void CombinationsOf_CarriesTheEventsMethod_AndDisagreementIsNoMethod()
    {
        var agreed = Assert.Single(MixVerdict.CombinationsOf(Inputs("""
            [
              { "id": "e1", "mixId": "m1", "method": "Drip", "mix": [{ "id": "a", "productName": "calcium nitrate" }] },
              { "id": "e2", "mixId": "m1", "method": "fertigation", "mix": [{ "id": "b", "productName": "19:19:19" }] }
            ]
            """)));
        Assert.Equal(MixVerdict.Fertigation, agreed.Method);

        var disagree = Assert.Single(MixVerdict.CombinationsOf(Inputs("""
            [
              { "id": "e1", "mixId": "m1", "method": "Drip", "mix": [{ "id": "a", "productName": "calcium nitrate" }] },
              { "id": "e2", "mixId": "m1", "method": "Spray", "mix": [{ "id": "b", "productName": "19:19:19" }] }
            ]
            """)));
        Assert.Null(disagree.Method);
        Assert.Equal(MixState.Grey, MixVerdict.Judge(disagree, [NeverFixture]).State);

        var oneSilent = Assert.Single(MixVerdict.CombinationsOf(Inputs("""
            [
              { "id": "e1", "mixId": "m1", "method": "Drip", "mix": [{ "id": "a", "productName": "calcium nitrate" }] },
              { "id": "e2", "mixId": "m1", "mix": [{ "id": "b", "productName": "19:19:19" }] }
            ]
            """)));
        Assert.Null(oneSilent.Method);
    }

    [Fact]
    public void Verdict_FiresOnlyForTankSolutions()
    {
        (string, string?)[] cnPlus191919 = [("calcium nitrate", null), ("19:19:19", "19:19:19")];

        var drip = MixVerdict.Judge(TankBy("Drip", cnPlus191919), [NeverFixture]);
        Assert.Equal(MixState.Red, drip.State);
        Assert.Equal(new[] { "g280", "g273" }, drip.PairProductIds.ToArray());
        Assert.Equal(MixState.Red, MixVerdict.Judge(TankBy("Spray", cnPlus191919), [NeverFixture]).State);
        Assert.Equal(MixState.Grey, MixVerdict.Judge(TankBy(null, cnPlus191919), [NeverFixture]).State);
        Assert.Equal(MixState.Grey, MixVerdict.Judge(TankBy("Soil", cnPlus191919), [NeverFixture]).State);
        // A rule that names no method never fires.
        Assert.Equal(MixState.Grey, MixVerdict.Judge(TankBy("Drip", cnPlus191919), [NeverFixture with { AppliesTo = null }]).State);
        Assert.Equal(MixState.Grey, MixVerdict.Judge(TankBy("Spray", cnPlus191919), [NeverFixture with { AppliesTo = [MixVerdict.Fertigation] }]).State);
    }

    [Fact]
    public void Verdict_SameProductTwice_IsNeverAPair()
    {
        // SSP carries calcium, phosphate and sulphate; two lines of it are still not a pair.
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g293", "g293"], "Drip", [NeverFixture]).State);
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g294", "g294"], "Drip", [NeverFixture]).State);
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g280", "g280"], "Drip", [NeverFixture]).State);
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g293", "g282"], "Soil", [NeverFixture]).State);
    }

    [Fact]
    public void Verdict_WithUnknownMember_IsGrey()
    {
        var result = MixVerdict.Judge(Tank(("Contof Plus", null), ("प्रेम गोल्ड", null)), [NeverFixture]);

        Assert.Equal(MixState.Grey, result.State);
        Assert.Null(result.RuleId);
        Assert.Empty(result.PairProductIds);
        // An ambiguous member is not known either.
        Assert.Equal(MixState.Grey, MixVerdict.Judge(Tank(("Contof Plus", null), ("ga3", null)), [NeverFixture]).State);
    }

    [Fact]
    public void Verdict_UnknownThirdMember_KeepsTheRedPair()
    {
        var result = MixVerdict.Judge(
            Tank(("calcium nitrate", null), ("प्रेम गोल्ड", null), ("19:19:19", "19:19:19")), [NeverFixture]);

        Assert.Equal(MixState.Red, result.State);
        Assert.Equal("T-NEVER", result.RuleId);
        Assert.Equal(new[] { "g280", "g273" }, result.PairProductIds.ToArray());
    }

    [Fact]
    public void Verdict_AnyNeverPair_IsRed_EvenIfOtherPairsOk()
    {
        var okRule = NeverFixture with
        {
            Id = "T-OK",
            Verdict = "ok",
            A = new RuleSelector(null, "g172"),
            B = new RuleSelector("calcium-source", null),
        };
        MixRule[] rules = [okRule, NeverFixture];

        var red = MixVerdict.JudgeProducts(["g172", "g280", "g273"], "Drip", rules);
        Assert.Equal(MixState.Red, red.State);
        Assert.Equal("T-NEVER", red.RuleId);
        Assert.Equal(new[] { "g280", "g273" }, red.PairProductIds.ToArray());
        // Green only when EVERY pair has an ok rule.
        var green = MixVerdict.JudgeProducts(["g172", "g280"], "Drip", rules);
        Assert.Equal(MixState.Green, green.State);
        Assert.Empty(green.PairProductIds);
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g172", "g280", "g249"], "Drip", rules).State);
        // An unknown member never lets a combination be green.
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g172", "g280", null], "Drip", rules).State);
    }

    [Fact]
    public void Verdict_UnreviewedRule_IsGrey()
    {
        var tank = Tank(("calcium nitrate", null), ("19:19:19", "19:19:19"));

        Assert.Equal(MixState.Grey, MixVerdict.Judge(tank, [NeverFixture with { ReviewedBy = null }]).State);
        Assert.Equal(MixState.Grey, MixVerdict.Judge(tank, [NeverFixture with { ReviewedOn = null }]).State);
        Assert.Equal(MixState.Grey, MixVerdict.Judge(tank, [NeverFixture with { Sources = [] }]).State);
        var red = MixVerdict.Judge(tank, [NeverFixture]);
        Assert.Equal(MixState.Red, red.State);
        Assert.Equal("T-NEVER", red.RuleId);
    }

    [SkippableFact]
    public void LiveRules_Unreviewed_GiveGreyThroughTheDefaultJudge()
    {
        Skip.If(
            MixRules.Shippable.Count > 0,
            "A rule in mix-rules.json has been reviewed, so calcium nitrate + 19:19:19 may now be red; this pin of the unreviewed state no longer applies.");

        Assert.Equal(MixState.Grey, MixVerdict.Judge(Tank(("calcium nitrate", null), ("19:19:19", "19:19:19"))).State);
        Assert.Equal(MixState.Grey, MixVerdict.JudgeProducts(["g280", "g281"], "Drip").State);
    }

    [Fact]
    public void Judge_ThroughHisWords_CalciumNitratePlusMagnesiumSulphate_IsR2()
    {
        var result = MixVerdict.Judge(Tank(("कॅल्शियम नायट्रेट", null), ("Magnesium Sulphate", null)), CaseRules);

        Assert.Equal("R2", result.RuleId);
    }

    [Fact]
    public void Judge_IsPure_DoesNotMutateInput()
    {
        const string json = """
            [{ "id": "e1", "mixId": "m1", "mix": [
                { "id": "a", "productName": "calcium nitrate" },
                { "id": "b", "productName": "19:19:19", "npkGrade": "19:19:19" } ] }]
            """;
        var inputs = Inputs(json);
        var before = inputs.GetRawText();

        var combos = MixVerdict.CombinationsOf(inputs);
        var first = MixVerdict.Judge(combos[0], [NeverFixture]);
        var second = MixVerdict.Judge(combos[0], [NeverFixture]);

        Assert.Equal(before, inputs.GetRawText());
        Assert.Equal(first.State, second.State);
        Assert.Equal(first.RuleId, second.RuleId);
        Assert.Equal(first.Sources, second.Sources);
        Assert.Equal(first.PairProductIds, second.PairProductIds);
    }

    [Fact]
    public void IsShippable_NeedsBothReviewFieldsAndASourcedTitleAndUrl()
    {
        Assert.True(MixVerdict.IsShippable(NeverFixture));
        Assert.False(MixVerdict.IsShippable(NeverFixture with { ReviewedBy = null }));
        Assert.False(MixVerdict.IsShippable(NeverFixture with { ReviewedOn = null }));
        Assert.False(MixVerdict.IsShippable(NeverFixture with { ReviewedBy = " " }));
        Assert.False(MixVerdict.IsShippable(NeverFixture with { Sources = [] }));
        Assert.False(MixVerdict.IsShippable(NeverFixture with { Sources = [Source with { Title = " " }] }));
        Assert.False(MixVerdict.IsShippable(NeverFixture with { Sources = [Source with { Url = "" }] }));
        Assert.True(MixVerdict.IsShippable(NeverFixture with { Sources = [Source with { Url = "" }, Source] }));
    }

    [Fact]
    public void EveryShippedRule_PassesIsShippable()
    {
        Assert.All(MixRules.Shippable, r => Assert.True(MixVerdict.IsShippable(r), r.Id));
    }

    [Fact]
    public void EmbeddedRules_AreTheReferenceFileByteForByte()
    {
        Assert.Equal(File.ReadAllBytes(InputReferenceFiles.Path("mix-rules.json")), MixRules.RawJson());
        Assert.Equal("mix-rules-1", MixRules.Version);
    }
}
