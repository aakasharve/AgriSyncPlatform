using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// AI Intelligence Plan WP-2c (Track B) — confirm-time server-side derivation of
/// the typed <c>ssf</c> ledger. Parses a source <see cref="AiJob"/>'s
/// <c>NormalizedResultJson</c> into typed rows and STAGES them on the
/// repository inside <see cref="CreateDailyLogHandler"/>'s existing unit of work
/// (no SaveChanges — the handler owns the commit). Non-blocking by contract: the
/// caller wraps <see cref="DeriveAsync"/> in try/catch so a missing or
/// unparseable blob NEVER blocks the log commit (mirrors the B2.8 weather stamp).
///
/// <para>Only <c>inputs</c> produces a <see cref="Domain.Farms.FarmOperation"/>
/// parent (operationType "application") plus one
/// <see cref="Domain.Farms.ApplicationInputItem"/> child per mix item; the other
/// five event kinds (irrigation / labour / machinery / observation /
/// disturbance) are <c>daily_logs</c>-children staged directly (D3). Each
/// derived operation carries a parse-invariant
/// <see cref="Domain.Farms.DerivedEventKey"/> (D2); re-derivation supersedes the
/// current row (append-only, never duplicates).</para>
/// </summary>
public interface ILedgerDerivationService
{
    /// <summary>
    /// Parse <paramref name="sourceJob"/>'s <c>NormalizedResultJson</c> and stage
    /// the derived typed rows against the confirmed <paramref name="log"/>.
    /// Returns a small tally for the audit / log line. A blank / unparseable blob
    /// stages nothing and returns a zeroed outcome.
    /// </summary>
    Task<DerivationOutcome> DeriveAsync(
        DailyLog log, AiJob sourceJob, IIdGenerator ids, IClock clock, CancellationToken ct = default);

    /// <summary>
    /// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — the MANUAL
    /// counterpart. Stages the same typed rows from
    /// <paramref name="manualWireJson"/> (produced by <c>ManualDraftNormalizer</c> from
    /// the farmer's typed draft) through the SAME persistence body, so a hand-typed day
    /// records exactly what a spoken one does. Before this, a manual day persisted no
    /// typed children at all and was scored 0/10.
    ///
    /// <para>Two things differ from the voice path, and only two. Provenance is
    /// <c>Provenance.Manual(<paramref name="appVersion"/>)</c> — no model version, no
    /// prompt version, no extractor SHA, because no AI touched these rows (P8). And the
    /// <see cref="Domain.Farms.DerivedEventKey"/> is anchored to the LOG id rather than
    /// a parse job id: deterministic and stable across re-saves, so re-derivation
    /// supersedes the current row instead of duplicating it.</para>
    /// </summary>
    Task<DerivationOutcome> DeriveFromManualDraftAsync(
        DailyLog log, string manualWireJson, string? appVersion,
        IIdGenerator ids, IClock clock, CancellationToken ct = default);
}

/// <summary>Small tally of what a derivation staged, for the audit / log line.</summary>
/// <param name="OperationsWritten">Count of <see cref="Domain.Farms.FarmOperation"/> parents staged.</param>
/// <param name="ChildrenWritten">Count of daily_logs-children + input items staged.</param>
public readonly record struct DerivationOutcome(int OperationsWritten, int ChildrenWritten);
