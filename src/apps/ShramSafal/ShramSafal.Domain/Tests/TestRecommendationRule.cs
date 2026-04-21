namespace ShramSafal.Domain.Tests;

/// <summary>
/// A static recommendation rule — if <see cref="Matches"/> returns true for
/// any <see cref="TestResult"/> on a <see cref="TestInstance"/> whose
/// <see cref="TestInstance.ProtocolKind"/> equals <see cref="Kind"/> and
/// whose result's <see cref="TestResult.ParameterCode"/> equals
/// <see cref="ParameterCode"/>, a <see cref="TestRecommendation"/> is raised.
/// See CEI §4.5.
/// </summary>
public sealed record TestRecommendationRule(
    string RuleCode,
    TestProtocolKind Kind,
    string ParameterCode,
    Func<TestResult, bool> Matches,
    string TitleEn,
    string TitleMr,
    string SuggestedActivityName,
    int SuggestedOffsetDays);

/// <summary>
/// Deterministic catalogue of recommendation rules. Evaluated against a
/// reported <see cref="TestInstance"/> to produce zero or more
/// <see cref="TestRecommendation"/>s.
/// </summary>
public static class TestRecommendationRuleBook
{
    public static readonly IReadOnlyList<TestRecommendationRule> Rules = new[]
    {
        new TestRecommendationRule(
            RuleCode: "soil.ph.low.apply-lime",
            Kind: TestProtocolKind.Soil,
            ParameterCode: "pH",
            Matches: r => decimal.TryParse(r.ParameterValue, out var v) && v < 6.0m,
            TitleEn: "Soil pH low — schedule lime application",
            TitleMr: "मातीचा पीएच कमी — चुना टाकायचं नियोजन करा",
            SuggestedActivityName: "Lime application",
            SuggestedOffsetDays: 0),

        new TestRecommendationRule(
            RuleCode: "soil.n.low.apply-urea",
            Kind: TestProtocolKind.Soil,
            ParameterCode: "N",
            Matches: r => decimal.TryParse(r.ParameterValue, out var v) && v < 250m,
            TitleEn: "Nitrogen low — schedule urea",
            TitleMr: "नायट्रोजन कमी — युरिया नियोजन करा",
            SuggestedActivityName: "Urea application",
            SuggestedOffsetDays: 3),

        new TestRecommendationRule(
            RuleCode: "petiole.k.low.apply-mop",
            Kind: TestProtocolKind.Petiole,
            ParameterCode: "K",
            Matches: r => decimal.TryParse(r.ParameterValue, out var v) && v < 1.2m,
            TitleEn: "Potassium low — schedule MOP",
            TitleMr: "पोटॅश कमी — एमओपी नियोजन करा",
            SuggestedActivityName: "MOP application",
            SuggestedOffsetDays: 2),

        new TestRecommendationRule(
            RuleCode: "residue.high.delay-harvest",
            Kind: TestProtocolKind.Residue,
            ParameterCode: "residue.level",
            Matches: r => r.ParameterValue == "high",
            TitleEn: "Residue high — delay harvest or re-test",
            TitleMr: "अवशेष जास्त — काढणी पुढे ढकला किंवा पुन्हा तपासा",
            SuggestedActivityName: "Delay harvest / retest residue",
            SuggestedOffsetDays: 7)
    };

    /// <summary>
    /// Evaluate all rules against <paramref name="instance"/>. Produces one
    /// <see cref="TestRecommendation"/> per matching (rule, result) pair,
    /// using a new <see cref="Guid"/> for each recommendation.
    /// </summary>
    public static IReadOnlyList<TestRecommendation> Evaluate(TestInstance instance, DateTime evaluatedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(instance);

        var recs = new List<TestRecommendation>();

        foreach (var rule in Rules)
        {
            if (rule.Kind != instance.ProtocolKind)
            {
                continue;
            }

            foreach (var result in instance.Results)
            {
                if (!string.Equals(result.ParameterCode, rule.ParameterCode, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (!rule.Matches(result))
                {
                    continue;
                }

                recs.Add(TestRecommendation.FromRule(
                    Guid.NewGuid(),
                    instance.Id,
                    rule,
                    evaluatedAtUtc));
            }
        }

        return recs;
    }
}
