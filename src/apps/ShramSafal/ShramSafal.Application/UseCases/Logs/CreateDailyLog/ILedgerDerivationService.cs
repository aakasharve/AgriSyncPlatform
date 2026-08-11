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
    /// <param name="deriveLabour">
    /// Labour V1 Task 6.3 — the SINGLE-PRODUCER guard. When the confirm carried
    /// structured <c>labour[]</c>, the handler has already staged those rows as
    /// CANONICAL Phase-1 data, so re-deriving labour from the same voice blob here
    /// would produce a SECOND set describing one real engagement. Passing
    /// <c>false</c> suppresses the labour branch ONLY. Farm operations, inputs,
    /// irrigation, machinery, observations and disturbance still derive normally —
    /// this is a labour-shaped scalpel, never an off-switch for the side-car.
    /// </param>
    Task<DerivationOutcome> DeriveAsync(
        DailyLog log, AiJob sourceJob, IIdGenerator ids, IClock clock,
        bool deriveLabour = true, CancellationToken ct = default);
}

/// <summary>Small tally of what a derivation staged, for the audit / log line.</summary>
/// <param name="OperationsWritten">Count of <see cref="Domain.Farms.FarmOperation"/> parents staged.</param>
/// <param name="ChildrenWritten">Count of daily_logs-children + input items staged.</param>
public readonly record struct DerivationOutcome(int OperationsWritten, int ChildrenWritten);
