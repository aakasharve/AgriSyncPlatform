using System.Collections.Concurrent;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 2 §4.5 — placeholder in-memory repository so the DI container can
/// resolve <see cref="ITestInstanceRepository"/>. Full EF-backed wiring lands in
/// CEI Phase 3 once <c>TestInstance</c> is mapped onto
/// <see cref="ShramSafalDbContext"/>.
/// </summary>
internal sealed class InMemoryTestInstanceRepository : ITestInstanceRepository
{
    private static readonly ConcurrentDictionary<Guid, TestInstance> _store = new();

    public Task AddAsync(TestInstance instance, CancellationToken ct = default)
    {
        _store[instance.Id] = instance;
        return Task.CompletedTask;
    }

    public Task AddRangeAsync(IEnumerable<TestInstance> instances, CancellationToken ct = default)
    {
        foreach (var instance in instances)
        {
            _store[instance.Id] = instance;
        }

        return Task.CompletedTask;
    }

    public Task<TestInstance?> GetByIdAsync(Guid testInstanceId, CancellationToken ct = default)
    {
        _store.TryGetValue(testInstanceId, out var instance);
        return Task.FromResult(instance);
    }

    public Task<IReadOnlyList<TestInstance>> GetByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        IReadOnlyList<TestInstance> result = _store.Values
            .Where(i => i.CropCycleId == cropCycleId)
            .OrderBy(i => i.PlannedDueDate)
            .ToList();
        return Task.FromResult(result);
    }

    public Task<IReadOnlyList<TestInstance>> GetByFarmIdAndStatusAsync(
        FarmId farmId,
        IReadOnlyCollection<TestInstanceStatus> statuses,
        CancellationToken ct = default)
    {
        var statusSet = statuses.ToHashSet();
        IReadOnlyList<TestInstance> result = _store.Values
            .Where(i => i.FarmId == farmId && statusSet.Contains(i.Status))
            .ToList();
        return Task.FromResult(result);
    }

    public Task<IReadOnlyList<TestInstance>> GetOverdueAsync(DateOnly today, CancellationToken ct = default)
    {
        IReadOnlyList<TestInstance> result = _store.Values
            .Where(i => i.Status == TestInstanceStatus.Due && i.PlannedDueDate < today)
            .ToList();
        return Task.FromResult(result);
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
}
