// spec: data-principle-spine-2026-05-05/08.1
//
// Sub-phase 08.1 — append-only ledger row written by RetentionSweep-
// Worker (08.4) after each daily 03:00 IST pass. Mirrors the
// "one row per sweep run" shape so an operator can scan history with
// a single SELECT and the DPDP §8(7) storage-limitation matrix has
// hard evidence the cron is firing.
//
// Per OQ-4 verdict: scope is in-app surfaces only — the worker sweeps
// ssf.export_artifacts > 7 days old and ssf.audit_read_telemetry > 30
// days old. S3 lifecycle handles the cold storage tier (Phase 02).
// voice_clips_retained is deferred to Phase 07.

namespace ShramSafal.Domain.Privacy;

public sealed class RetentionSweepRun
{
    public Guid Id { get; private set; }

    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>
    /// Comma-separated list of tables the sweep touched in this run.
    /// e.g. "export_artifacts,audit_read_telemetry". Free-text rather
    /// than a strongly-typed set because the manifest may grow over
    /// phases without a schema migration.
    /// </summary>
    public string TablesSwept { get; private set; } = string.Empty;

    /// <summary>
    /// Total rows removed across all <see cref="TablesSwept"/>. 0 is a
    /// valid value (the worker still emits a row so the absence-of-
    /// removal is explicitly recorded — a missing row would otherwise
    /// be ambiguous between "sweep ran, nothing to do" and "sweep did
    /// not run").
    /// </summary>
    public int RowsRemovedCount { get; private set; }

    /// <summary>
    /// Count of S3 objects deleted in this run. Tracked separately so
    /// the storage-cost dashboard can correlate cron pressure with S3
    /// list/delete API calls. Zero when no export_artifacts were aged
    /// out (or when the run skipped S3 entirely for a transient reason
    /// — the worker logs the skip).
    /// </summary>
    public int S3ObjectsRemovedCount { get; private set; }

    private RetentionSweepRun()
    {
        // EF Core materialisation; do not call.
    }

    public static RetentionSweepRun Record(
        string tablesSwept,
        int rowsRemovedCount,
        int s3ObjectsRemovedCount,
        DateTime nowUtc)
    {
        if (string.IsNullOrWhiteSpace(tablesSwept))
        {
            throw new ArgumentException("tablesSwept required", nameof(tablesSwept));
        }
        if (rowsRemovedCount < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(rowsRemovedCount), rowsRemovedCount, "rowsRemovedCount must be >= 0");
        }
        if (s3ObjectsRemovedCount < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(s3ObjectsRemovedCount), s3ObjectsRemovedCount,
                "s3ObjectsRemovedCount must be >= 0");
        }

        return new RetentionSweepRun
        {
            Id = Guid.NewGuid(),
            OccurredAtUtc = nowUtc,
            TablesSwept = tablesSwept.Trim(),
            RowsRemovedCount = rowsRemovedCount,
            S3ObjectsRemovedCount = s3ObjectsRemovedCount,
        };
    }
}
