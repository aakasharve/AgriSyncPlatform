using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Write-only port for persisting <see cref="TestRecommendation"/> rows
/// produced by <c>TestRecommendationRuleBook.Evaluate</c>. See CEI §4.5.
/// </summary>
public interface ITestRecommendationRepository
{
    Task AddRangeAsync(IEnumerable<TestRecommendation> recommendations, CancellationToken ct = default);

    /// <summary>
    /// Returns all recommendations raised against the given test instance,
    /// ordered by <see cref="TestRecommendation.CreatedAtUtc"/> ascending.
    /// </summary>
    Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdAsync(Guid testInstanceId, CancellationToken ct = default);

    /// <summary>
    /// CEI Phase 2 §4.5 — sync-pull cursor query. Returns every
    /// <see cref="TestRecommendation"/> whose parent
    /// <see cref="TestRecommendation.TestInstanceId"/> is in
    /// <paramref name="testInstanceIds"/>.
    /// </summary>
    Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdsAsync(
        IReadOnlyCollection<Guid> testInstanceIds,
        CancellationToken ct = default);
}
