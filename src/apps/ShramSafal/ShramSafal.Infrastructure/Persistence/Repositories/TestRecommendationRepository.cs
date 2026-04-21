using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 3 §4.5 — EF Core implementation of <see cref="ITestRecommendationRepository"/>.
/// </summary>
internal sealed class TestRecommendationRepository(ShramSafalDbContext context) : ITestRecommendationRepository
{
    public async Task AddRangeAsync(IEnumerable<TestRecommendation> recommendations, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(recommendations);
        var materialised = recommendations as IReadOnlyCollection<TestRecommendation> ?? recommendations.ToList();
        if (materialised.Count == 0)
        {
            return;
        }

        await context.TestRecommendations.AddRangeAsync(materialised, ct);
        await context.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdAsync(
        Guid testInstanceId,
        CancellationToken ct = default)
    {
        return await context.TestRecommendations
            .Where(r => r.TestInstanceId == testInstanceId)
            .OrderBy(r => r.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdsAsync(
        IReadOnlyCollection<Guid> testInstanceIds,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(testInstanceIds);
        if (testInstanceIds.Count == 0)
        {
            return Array.Empty<TestRecommendation>();
        }

        var idList = testInstanceIds.ToArray();
        return await context.TestRecommendations
            .Where(r => idList.Contains(r.TestInstanceId))
            .OrderBy(r => r.CreatedAtUtc)
            .ToListAsync(ct);
    }
}
