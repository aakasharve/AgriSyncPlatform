// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 3)
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Compliance;

/// <summary>
/// The compliance rule "wrong mix in one tank" (<see cref="ComplianceRuleCode.InputMixNeverTogether"/>).
///
/// <para>Founder D-96: the two red rules (R1 calcium x phosphate, R2 calcium x sulphate) wait for the founder's agronomist
/// to tick them. Until then <c>MixRules.Shippable</c> is empty and the rule emits NOTHING. The rule is built whole and proved
/// here with a TEST-ONLY reviewed rule; the real rule file is never marked reviewed by a test, so these tests keep
/// passing after the founder ticks it (the book-level facts below are written against the live shippable set).</para>
///
/// <para>Doctrine P4: red only from a sourced, reviewed rule, and only when the record says the products shared a tank
/// (the same <c>mix[]</c>, or one non-empty <c>mixId</c>).</para>
/// </summary>
public sealed class InputMixRuleTests
{
    private static readonly FarmId Farm = new(Guid.Parse("b2000000-0000-4000-8000-000000000001"));
    private static readonly UserId Speaker = new(Guid.Parse("b2000000-0000-4000-8000-000000000002"));
    private static readonly Guid Plot = Guid.Parse("b2000000-0000-4000-8000-0000000000a1");
    private static readonly Guid Cycle = Guid.Parse("b2000000-0000-4000-8000-0000000000c1");
    private static readonly DateTime Now = new(2026, 11, 8, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = DateOnly.FromDateTime(Now.AddHours(5.5));

    private static readonly LocalizedText Text = new("मिश्रण चुकीचं आहे", "these must not be mixed");
    private static readonly LocalizedText NextTime = new("पुढच्या वेळी वेगळं द्या", "give them separately next time");
    private static readonly RuleSource Source = new("UF/IFAS EDIS HS1202 (test)", "UF/IFAS", "https://example.org/edis", "2026-11-06");

    /// <summary>A calcium x phosphate rule marked reviewed HERE (a test fixture), exactly as the verdict tests do.</summary>
    private static readonly MixRule Reviewed = new(
        "T-R1", "never", new RuleSelector("calcium-source", null), new RuleSelector("phosphate-source", null),
        Text, Text, NextTime, [Source], "test-fixture", "2026-11-06", [MixVerdict.Fertigation, MixVerdict.Spray]);

    private static readonly MixRule Unreviewed = Reviewed with { Id = "T-R1-unreviewed", ReviewedBy = null, ReviewedOn = null };

    private const string CalciumNitratePlus191919Drip = """
        {"schema":1,"inputs":[{"id":"e1","method":"Drip","mix":[
          {"id":"m0","productName":"calcium nitrate"},
          {"id":"m1","productName":"19:19:19","npkGrade":"19:19:19"}]}]}
        """;

    private const string SameDaySeparateEvents = """
        {"schema":1,"inputs":[
          {"id":"e1","method":"Drip","mix":[{"id":"m0","productName":"calcium nitrate"}]},
          {"id":"e2","method":"Drip","mix":[{"id":"m1","productName":"19:19:19","npkGrade":"19:19:19"}]}]}
        """;

    private static (DailyLog Log, DailyLogContent Content) Record(string document, DateOnly? day = null, bool withPlot = true)
    {
        var id = Guid.NewGuid();
        var date = day ?? Today;
        var log = withPlot
            ? DailyLog.Create(id, Farm, Plot, Cycle, Speaker, date, null, null, Now.AddHours(-2))
            : DailyLog.CreateForFarm(id, Farm, Speaker, date, null, null, Now.AddHours(-2));
        var content = DailyLogContent.Create(
            Guid.NewGuid(), log, 1, document, DailyLogContent.OriginCreate, null, Speaker, Now.AddHours(-2), null, null);
        return (log, content);
    }

    private static ComplianceEvaluationInput Input(
        IEnumerable<(DailyLog Log, DailyLogContent Content)> records,
        IEnumerable<string>? acknowledged = null)
    {
        var list = records.ToList();
        return new ComplianceEvaluationInput(
            Farm, Now, [], [], list.Select(r => r.Log).ToList(), [], [],
            LatestContents: list.Select(r => r.Content).ToList(),
            AcknowledgedMixFingerprints: acknowledged?.ToHashSet(StringComparer.Ordinal) ?? new HashSet<string>(StringComparer.Ordinal));
    }

    [Fact]
    public void CalciumNitratePlus191919_SameMix_EmitsCriticalEvidence_WithSourceTitle()
    {
        var record = Record(CalciumNitratePlus191919Drip);

        var evidence = Assert.Single(InputMixRule.Evaluate(Input([record]), [Reviewed]));

        Assert.Equal(Farm, evidence.FarmId);
        Assert.Equal(Plot, evidence.PlotId);
        Assert.Equal(Cycle, evidence.CropCycleId);
        Assert.Contains("UF/IFAS EDIS HS1202 (test)", evidence.DescriptionEn);
        Assert.Contains("UF/IFAS EDIS HS1202 (test)", evidence.DescriptionMr);
        Assert.Contains(Text.En, evidence.DescriptionEn);
        Assert.Contains(NextTime.En, evidence.DescriptionEn);
        Assert.Contains(Text.Mr, evidence.DescriptionMr);
        Assert.Contains(NextTime.Mr, evidence.DescriptionMr);

        using var payload = JsonDocument.Parse(evidence.PayloadJson);
        var root = payload.RootElement;
        Assert.Equal(record.Log.Id, root.GetProperty("logId").GetGuid());
        Assert.Equal(record.Log.ContentVersion, root.GetProperty("contentVersion").GetInt32());
        Assert.Equal("T-R1", root.GetProperty("ruleId").GetString());
        var ids = root.GetProperty("productIds").EnumerateArray().Select(x => x.GetString()!).ToArray();
        Assert.Equal(2, ids.Length);
        Assert.Equal(ids.OrderBy(x => x, StringComparer.Ordinal), ids);
        Assert.All(ids, id => Assert.NotNull(InputCatalog.Get(id)));
        Assert.Equal(["e1"], root.GetProperty("inputEventIds").EnumerateArray().Select(x => x.GetString()!).ToArray());
    }

    [Fact]
    public void TheRuleBookEntry_IsCritical_AcknowledgeOnly_AndNamedInTheFarmersWords()
    {
        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.InputMixNeverTogether);

        Assert.Equal("compliance.input-mix.never-together", ComplianceRuleCode.InputMixNeverTogether);
        Assert.Equal(ComplianceSeverity.Critical, rule.Severity);
        Assert.Equal(ComplianceSuggestedAction.AcknowledgeOnly, rule.SuggestedAction);
        Assert.Equal("Products that must not be mixed were given together", rule.TitleEn);
        Assert.Equal("हे मिश्रण चुकीचं आहे", rule.TitleMr);
    }

    [Fact]
    public void TheRuleBookEntry_FollowsTheLiveShippableRules_NothingWhileUnreviewed()
    {
        // D-96: with the real rules unreviewed (MixRules.Shippable empty) the book emits NOTHING for the founder's own example.
        // Written against the live set so it still holds the day the agronomist ticks R1: then exactly one alert.
        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.InputMixNeverTogether);
        var evidence = rule.Evaluate(Input([Record(CalciumNitratePlus191919Drip)]));

        var calciumPhosphateIsShippable = MixRules.Shippable.Any(r =>
            r.Verdict == "never"
            && r.AppliesTo is not null && r.AppliesTo.Contains(MixVerdict.Fertigation)
            && ((r.A.Tag == "calcium-source" && r.B.Tag == "phosphate-source") || (r.A.Tag == "phosphate-source" && r.B.Tag == "calcium-source")));
        Assert.Equal(calciumPhosphateIsShippable ? 1 : 0, evidence.Count);
    }

    [Fact]
    public void UnreviewedRule_EmitsNothing()
    {
        Assert.Empty(InputMixRule.Evaluate(Input([Record(CalciumNitratePlus191919Drip)]), [Unreviewed]));
        Assert.Empty(InputMixRule.Evaluate(Input([Record(CalciumNitratePlus191919Drip)]), []));
        Assert.Empty(InputMixRule.Evaluate(
            Input([Record(CalciumNitratePlus191919Drip)]), [Reviewed with { Sources = [] }]));
    }

    [Fact]
    public void SameDaySeparateEvents_EmitsNothing()
    {
        Assert.Empty(InputMixRule.Evaluate(Input([Record(SameDaySeparateEvents)]), [Reviewed]));
    }

    [Theory]
    [InlineData("Soil")]
    [InlineData("Drenching")]
    public void ADryOrDrenchDose_IsNotATankSolution_EmitsNothing(string method)
    {
        var document = CalciumNitratePlus191919Drip.Replace("Drip", method);

        Assert.Empty(InputMixRule.Evaluate(Input([Record(document)]), [Reviewed]));
    }

    [Fact]
    public void LogOlderThan7Days_EmitsNothing()
    {
        var old = Record(CalciumNitratePlus191919Drip, day: Today.AddDays(-8));
        var edge = Record(CalciumNitratePlus191919Drip, day: Today.AddDays(-7));

        Assert.Empty(InputMixRule.Evaluate(Input([old]), [Reviewed]));
        Assert.Single(InputMixRule.Evaluate(Input([edge]), [Reviewed]));
    }

    [Fact]
    public void AcknowledgedFingerprint_EmitsNothing()
    {
        var record = Record(CalciumNitratePlus191919Drip);
        var evidence = Assert.Single(InputMixRule.Evaluate(Input([record]), [Reviewed]));
        var fingerprint = InputMixRule.FingerprintOfPayload(evidence.PayloadJson);

        Assert.NotNull(fingerprint);
        Assert.StartsWith($"{record.Log.Id}:{record.Log.ContentVersion}:T-R1:", fingerprint);
        Assert.Empty(InputMixRule.Evaluate(Input([record], [fingerprint!]), [Reviewed]));
    }

    [Fact]
    public void NewMixAfterAck_Opens()
    {
        var first = Record(CalciumNitratePlus191919Drip, day: Today.AddDays(-1));
        var second = Record(CalciumNitratePlus191919Drip);
        var acknowledged = InputMixRule.FingerprintOfPayload(
            Assert.Single(InputMixRule.Evaluate(Input([first]), [Reviewed])).PayloadJson)!;

        var evidence = Assert.Single(InputMixRule.Evaluate(Input([first, second], [acknowledged]), [Reviewed]));

        using var payload = JsonDocument.Parse(evidence.PayloadJson);
        Assert.Equal(second.Log.Id, payload.RootElement.GetProperty("logId").GetGuid());
    }

    [Fact]
    public void TheFingerprint_IsLogVersionRuleAndSortedProducts()
    {
        Assert.Equal("L:3:R1:p-a,p-b", InputMixRule.Fingerprint("L", 3, "R1", ["p-b", "p-a"]));
        Assert.Null(InputMixRule.FingerprintOfPayload("not json"));
        Assert.Null(InputMixRule.FingerprintOfPayload("""{"logId":"x"}"""));
        Assert.Equal(
            "b2000000-0000-4000-8000-000000000009:2:R1:p-a,p-b",
            InputMixRule.FingerprintOfPayload("""{"logId":"b2000000-0000-4000-8000-000000000009","contentVersion":2,"ruleId":"R1","productIds":["p-b","p-a"],"inputEventIds":["e1"]}"""));
    }

    [Fact]
    public void ARecordWithNoPlot_CannotBeASignal_AndIsNamedNotSilentlyDropped()
    {
        var farmWide = Record(CalciumNitratePlus191919Drip, withPlot: false);
        var input = Input([farmWide]);

        Assert.Empty(InputMixRule.Evaluate(input, [Reviewed]));
        Assert.Equal([farmWide.Log.Id], InputMixRule.RedMixesWithNoPlot(input, [Reviewed]));
    }

    [Fact]
    public void NoContentsLoaded_EmitsNothing_AndAnOldInputShapeStillBuilds()
    {
        var legacy = new ComplianceEvaluationInput(Farm, Now, [], [], [], [], []);

        Assert.Empty(InputMixRule.Evaluate(legacy, [Reviewed]));
        Assert.Null(legacy.LatestContents);
        Assert.Null(legacy.AcknowledgedMixFingerprints);
    }

    [Fact]
    public void TheRuleBook_JudgesAgainstTheRulesTheInputPutsInForce_ButOnlyTheReviewedOnesCount()
    {
        var book = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.InputMixNeverTogether);
        var record = Record(CalciumNitratePlus191919Drip);

        var withReviewed = Input([record]) with { MixRulesInForce = [Reviewed] };
        var withUnreviewed = Input([record]) with { MixRulesInForce = [Unreviewed] };

        Assert.Single(book.Evaluate(withReviewed));
        Assert.Empty(book.Evaluate(withUnreviewed));
    }

    [Fact]
    public void AContentWhoseLogIsNotInTheInput_IsIgnored()
    {
        var record = Record(CalciumNitratePlus191919Drip);
        var input = new ComplianceEvaluationInput(
            Farm, Now, [], [], [], [], [], LatestContents: [record.Content], AcknowledgedMixFingerprints: new HashSet<string>());

        Assert.Empty(InputMixRule.Evaluate(input, [Reviewed]));
    }
}
