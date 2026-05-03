using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Read/write port for Work Trust Ledger v0 <see cref="Worker"/>
/// aggregates and their <see cref="WorkerAssignment"/> link rows.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>. The
/// projector is the only writer; admin Mode A drilldown is the primary
/// reader. There is no farmer-facing API.
/// </para>
/// </remarks>
public interface IWorkerRepository
{
    /// <summary>
    /// Returns the existing <see cref="Worker"/> for the given farm whose
    /// <see cref="WorkerName.Normalized"/> matches the supplied name, or
    /// <c>null</c> if no such worker has been recorded yet.
    /// </summary>
    Task<Worker?> FindByNormalizedNameAsync(FarmId farmId, string normalized, CancellationToken ct = default);

    /// <summary>
    /// Tracks a brand-new <see cref="Worker"/> with the change tracker.
    /// Persisted via <see cref="SaveChangesAsync"/>.
    /// </summary>
    void Add(Worker worker);

    /// <summary>
    /// Tracks a brand-new <see cref="WorkerAssignment"/> row with the
    /// change tracker. Persisted via <see cref="SaveChangesAsync"/>.
    /// </summary>
    void AddAssignment(WorkerAssignment assignment);

    /// <summary>
    /// Returns the top <paramref name="limit"/> workers for a farm
    /// ordered by descending <see cref="Worker.AssignmentCount"/> —
    /// drives the Mode A drilldown panel.
    /// </summary>
    Task<IReadOnlyList<Worker>> GetTopByAssignmentCountAsync(FarmId farmId, int limit, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
