using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compliance;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Read/write port for <see cref="ComplianceSignal"/> aggregates. CEI Phase 3.
/// </summary>
public interface IComplianceSignalRepository
{
    /// <summary>
    /// Returns the open (not resolved, not acknowledged) signal matching the given key,
    /// or null if none exists.
    /// </summary>
    Task<ComplianceSignal?> FindOpenAsync(FarmId farmId, Guid plotId, string ruleCode, Guid? cropCycleId, CancellationToken ct = default);

    /// <summary>
    /// Returns all open signals for the given farm.
    /// </summary>
    Task<IReadOnlyList<ComplianceSignal>> GetOpenForFarmAsync(FarmId farmId, CancellationToken ct = default);

    /// <summary>
    /// Returns signals for the farm, with optional inclusion of resolved and/or acknowledged signals.
    /// </summary>
    Task<IReadOnlyList<ComplianceSignal>> GetForFarmAsync(FarmId farmId, bool includeResolved, bool includeAcknowledged, CancellationToken ct = default);

    Task<ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2) - the signals of this farm and rule that were ACKNOWLEDGED
    /// (पाहिलं) at or after <paramref name="sinceUtc"/>. The wrong-mix rule reads their evidence to remember what the farm
    /// already saw, so the same wrong mix is never raised twice. The default REFUSES: a store that cannot say what was
    /// acknowledged must never answer "nothing was" - that would re-open every alert the farm has already seen. The real
    /// repository overrides it. (The evaluation reads this only when a mixing rule is shippable, which is not yet the case in
    /// production.)
    /// </summary>
    Task<IReadOnlyList<ComplianceSignal>> GetAcknowledgedSinceAsync(
        FarmId farmId, string ruleCode, DateTime sinceUtc, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot say which compliance signals were acknowledged.");

    /// <summary>
    /// Returns signals for the farm with <c>LastSeenAtUtc</c> strictly greater than <paramref name="cursor"/>.
    /// </summary>
    Task<IReadOnlyList<ComplianceSignal>> GetSinceCursorAsync(FarmId farmId, DateTime cursor, CancellationToken ct = default);

    void Add(ComplianceSignal signal);

    /// <summary>
    /// Returns the most recent <c>LastSeenAtUtc</c> across all signals for the farm, or null if there are none.
    /// This is used to determine if a fresh evaluation is needed.
    /// </summary>
    Task<DateTime?> GetLatestEvaluationTimeAsync(FarmId farmId, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
