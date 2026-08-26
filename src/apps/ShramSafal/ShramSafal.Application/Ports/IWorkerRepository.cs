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
/// <para>
/// <b>Deliberately no "find by normalized name" method (2026-07-19).</b>
/// A <c>FindByNormalizedNameAsync(farmId, normalized)</c> method used to
/// live here so <c>WorkerNameProjector</c> could find-or-create across
/// every log a farm has ever produced — which is exactly what let two
/// different real people sharing a common name collapse into one
/// <see cref="Worker"/> row (founder Decision 5 sub-question 2, spec
/// 2026-07-13-labour-attendance-approval-design). It was removed, not
/// just unused, so a future caller cannot casually wire cross-log name
/// merging back in without going through ADR 0026 (Worker Identity
/// Ladder) sign-off first. If a real identity-matching need arises,
/// add it back deliberately, backed by a verified signal (e.g. a
/// phone number), not name text alone.
/// </para>
/// </remarks>
public interface IWorkerRepository
{
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
