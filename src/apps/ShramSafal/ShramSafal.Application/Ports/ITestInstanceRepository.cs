using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Read/write port for <see cref="TestInstance"/> aggregates. See CEI §4.5.
/// Infrastructure wiring lands in CEI Phase 3.
/// </summary>
public interface ITestInstanceRepository
{
    Task AddAsync(TestInstance instance, CancellationToken ct = default);
    Task AddRangeAsync(IEnumerable<TestInstance> instances, CancellationToken ct = default);
    Task<TestInstance?> GetByIdAsync(Guid testInstanceId, CancellationToken ct = default);

    /// <summary>
    /// Returns all test instances for the given crop cycle ordered by
    /// <see cref="TestInstance.PlannedDueDate"/> ascending.
    /// </summary>
    Task<IReadOnlyList<TestInstance>> GetByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);

    /// <summary>
    /// Returns all test instances on the given farm whose
    /// <see cref="TestInstance.Status"/> is in <paramref name="statuses"/>.
    /// </summary>
    Task<IReadOnlyList<TestInstance>> GetByFarmIdAndStatusAsync(
        FarmId farmId,
        IReadOnlyCollection<TestInstanceStatus> statuses,
        CancellationToken ct = default);

    /// <summary>
    /// Returns all <see cref="TestInstance"/> rows with
    /// <see cref="TestInstanceStatus.Due"/> and <c>PlannedDueDate &lt; today</c>
    /// (i.e. eligible for the overdue sweeper).
    /// </summary>
    Task<IReadOnlyList<TestInstance>> GetOverdueAsync(DateOnly today, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
