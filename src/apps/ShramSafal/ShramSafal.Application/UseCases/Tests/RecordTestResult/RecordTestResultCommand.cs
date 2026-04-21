using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.RecordTestResult;

/// <summary>
/// Transition a <see cref="TestInstance"/> from <c>Collected</c> to
/// <c>Reported</c>. Allowed role: LabOperator. Requires >=1 attachment
/// (CEI-I5). See CEI §4.5.
/// </summary>
public sealed record RecordTestResultCommand(
    Guid TestInstanceId,
    IReadOnlyCollection<TestResult> Results,
    IReadOnlyCollection<Guid> AttachmentIds,
    UserId CallerUserId,
    AppRole CallerRole,
    string? ClientCommandId);

public sealed record RecordTestResultResponse(
    Guid TestInstanceId,
    string Status,
    IReadOnlyList<TestRecommendationDto> Recommendations);

/// <summary>Transport shape for a single <see cref="TestRecommendation"/>.</summary>
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
