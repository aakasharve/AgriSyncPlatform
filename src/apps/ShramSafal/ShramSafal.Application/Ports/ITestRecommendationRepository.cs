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
}
