using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// CEI Phase 3 §4.5 — EF Core implementation of <see cref="ITestInstanceRepository"/>.
/// </summary>
internal sealed class TestInstanceRepository(ShramSafalDbContext context) : ITestInstanceRepository
{
    public async Task AddAsync(TestInstance instance, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(instance);
        await context.TestInstances.AddAsync(instance, ct);
        await context.SaveChangesAsync(ct);
    }

    public async Task AddRangeAsync(IEnumerable<TestInstance> instances, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(instances);
        await context.TestInstances.AddRangeAsync(instances, ct);
        await context.SaveChangesAsync(ct);
    }

    public async Task<TestInstance?> GetByIdAsync(Guid testInstanceId, CancellationToken ct = default)
    {
        if (testInstanceId == Guid.Empty)
        {
            return null;
        }

        return await context.TestInstances.FindAsync([testInstanceId], ct);
    }

    public async Task<IReadOnlyList<TestInstance>> GetByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await context.TestInstances
            .Where(i => i.CropCycleId == cropCycleId)
            .OrderBy(i => i.PlannedDueDate)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<TestInstance>> GetByFarmIdAndStatusAsync(
        FarmId farmId,
        IReadOnlyCollection<TestInstanceStatus> statuses,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(statuses);
        if (statuses.Count == 0)
        {
            return Array.Empty<TestInstance>();
        }

        var statusList = statuses.ToArray();
        return await context.TestInstances
            .Where(i => i.FarmId == farmId && statusList.Contains(i.Status))
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<TestInstance>> GetOverdueAsync(DateOnly today, CancellationToken ct = default)
    {
        return await context.TestInstances
            .Where(i => i.Status == TestInstanceStatus.Due && i.PlannedDueDate < today)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<TestInstance>> GetModifiedSinceAsync(
        IReadOnlyCollection<FarmId> farmIds,
        DateTime sinceUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(farmIds);
        if (farmIds.Count == 0)
        {
            return Array.Empty<TestInstance>();
        }

        var farmList = farmIds.ToArray();
        return await context.TestInstances
            .Where(i => farmList.Contains(i.FarmId) && i.ModifiedAtUtc > sinceUtc)
            .OrderBy(i => i.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => context.SaveChangesAsync(ct);
}
