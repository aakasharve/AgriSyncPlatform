// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.Privacy.Ports;

/// <summary>
/// The improvement permission's own store (<c>ssf.improvement_permission_events</c>,
/// append-only). Deliberately NOT a member of <c>IShramSafalRepository</c>: a separate
/// permission gets a separate seam, so nothing that reads the old consent toggles can
/// answer this question by accident.
///
/// <para>Every call runs as the person it is about — the table's row-level policy only lets
/// a person see and write his own rows — so each call opens its own transaction-scoped
/// identity. Never call it from inside another person's transaction.</para>
/// </summary>
public interface IImprovementPermissionStore
{
    /// <summary>
    /// The person's newest choice, or <c>null</c> when he has never made one (= OFF).
    /// </summary>
    Task<ImprovementPermissionEvent?> GetLatestAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Appends one choice and commits it.</summary>
    Task AppendAsync(ImprovementPermissionEvent choice, CancellationToken ct = default);

    /// <summary>
    /// True when ANY erasure request exists for this account (requested, in progress,
    /// completed or failed). An account someone asked to erase grants nothing: its permission
    /// rows are kept as consent evidence, but they never license use.
    /// </summary>
    Task<bool> IsAccountErasureRequestedAsync(Guid userId, CancellationToken ct = default);
}
