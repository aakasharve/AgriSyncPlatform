using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Tests;

/// <summary>
/// A domain-level suggestion raised against a <see cref="TestInstance"/> when
/// a rule in <see cref="TestRecommendationRuleBook"/> matches one of the
/// reported <see cref="TestResult"/>s. See CEI §4.5.
/// </summary>
public sealed class TestRecommendation : Entity<Guid>
{
    private TestRecommendation() : base(Guid.Empty) { } // EF Core

    private TestRecommendation(
        Guid id,
        Guid testInstanceId,
        string ruleCode,
        string titleEn,
        string titleMr,
        string suggestedActivityName,
        int suggestedOffsetDays,
        DateTime createdAtUtc)
        : base(id)
    {
        TestInstanceId = testInstanceId;
        RuleCode = ruleCode;
        TitleEn = titleEn;
        TitleMr = titleMr;
        SuggestedActivityName = suggestedActivityName;
        SuggestedOffsetDays = suggestedOffsetDays;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid TestInstanceId { get; private set; }
    public string RuleCode { get; private set; } = string.Empty;
    public string TitleEn { get; private set; } = string.Empty;
    public string TitleMr { get; private set; } = string.Empty;
    public string SuggestedActivityName { get; private set; } = string.Empty;
    public int SuggestedOffsetDays { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static TestRecommendation FromRule(
        Guid id,
        Guid testInstanceId,
        TestRecommendationRule rule,
        DateTime createdAtUtc)
    {
        ArgumentNullException.ThrowIfNull(rule);

        var rec = new TestRecommendation(
            id,
            testInstanceId,
            rule.RuleCode,
            rule.TitleEn,
            rule.TitleMr,
            rule.SuggestedActivityName,
            rule.SuggestedOffsetDays,
            createdAtUtc);

        rec.Raise(new TestRecommendationRaisedEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            testInstanceId,
            rule.RuleCode));

        return rec;
    }
}
