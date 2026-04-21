using System.Collections.Concurrent;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 2 §4.5 — placeholder in-memory repository so the DI container can
/// resolve <see cref="ITestRecommendationRepository"/>. Full EF-backed wiring
/// lands in CEI Phase 3.
/// </summary>
internal sealed class InMemoryTestRecommendationRepository : ITestRecommendationRepository
{
    private static readonly ConcurrentBag<TestRecommendation> _store = new();

    public Task AddRangeAsync(IEnumerable<TestRecommendation> recommendations, CancellationToken ct = default)
    {
        foreach (var rec in recommendations)
        {
            _store.Add(rec);
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdAsync(Guid testInstanceId, CancellationToken ct = default)
    {
        IReadOnlyList<TestRecommendation> result = _store
            .Where(r => r.TestInstanceId == testInstanceId)
            .OrderBy(r => r.CreatedAtUtc)
            .ToList();
        return Task.FromResult(result);
    }
}
