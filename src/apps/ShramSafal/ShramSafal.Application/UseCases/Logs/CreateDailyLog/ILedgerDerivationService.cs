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
    /// <param name="deriveLabour">
    /// Labour V2 R1 Task 2 — the SAME single-producer guard <see cref="DeriveAsync"/>
    /// carries, for the same reason and against a live duplication. The manual client
    /// builds both labour arrays from ONE list: <c>buildManualDraft</c> sets
    /// <c>draft.labour = log.labour</c> and <c>buildLabourPayloads</c> maps that same
    /// <c>log.labour</c> onto the structured <c>labour[]</c>. So a manual save puts one
    /// engagement on the wire twice, the handler stages the canonical Phase-1 rows from
    /// <c>command.Labour</c>, and deriving the draft's copy as well recorded one
    /// morning's work as two — with a fabricated eight-hour default over a duration the
    /// farmer had actually stated. Passing <c>false</c> suppresses the labour branch
    /// ONLY: farm operations, inputs, irrigation, machinery, observations and
    /// disturbance still derive. A labour-shaped scalpel, never an off-switch for the
    /// side-car.
    ///
    /// <para>Required (no default), mirroring <c>DeriveCoreAsync</c>: neither caller may
    /// acquire this behaviour by omission.</para>
    /// </param>
    Task<DerivationOutcome> DeriveFromManualDraftAsync(
        DailyLog log, string manualWireJson, string? appVersion,
        IIdGenerator ids, IClock clock, bool deriveLabour, CancellationToken ct = default);
}

/// <summary>Small tally of what a derivation staged, for the audit / log line.</summary>
/// <param name="OperationsWritten">Count of <see cref="Domain.Farms.FarmOperation"/> parents staged.</param>
/// <param name="ChildrenWritten">Count of daily_logs-children + input items staged.</param>
public readonly record struct DerivationOutcome(int OperationsWritten, int ChildrenWritten);
