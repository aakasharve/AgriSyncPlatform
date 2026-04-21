using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Transport shape for a single <see cref="TestRecommendation"/>. See CEI §4.5.
/// Used by the test-result endpoint and by the sync-pull envelope.
/// </summary>
public sealed record TestRecommendationDto(
    Guid RecommendationId,
    Guid TestInstanceId,
    string RuleCode,
    string TitleEn,
    string TitleMr,
    string SuggestedActivityName,
    int SuggestedOffsetDays,
    DateTime CreatedAtUtc)
{
    public static TestRecommendationDto FromDomain(TestRecommendation rec) =>
        new(
            RecommendationId: rec.Id,
            TestInstanceId: rec.TestInstanceId,
            RuleCode: rec.RuleCode,
            TitleEn: rec.TitleEn,
            TitleMr: rec.TitleMr,
            SuggestedActivityName: rec.SuggestedActivityName,
            SuggestedOffsetDays: rec.SuggestedOffsetDays,
            CreatedAtUtc: rec.CreatedAtUtc);
}
