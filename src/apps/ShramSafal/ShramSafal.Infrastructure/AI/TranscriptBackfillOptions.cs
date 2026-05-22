namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.10 — configuration for
/// the <see cref="TranscriptBackfillWorker"/> that copies the legacy
/// <c>normalized_result_json.fullTranscript</c> value into the dedicated
/// <c>transcript_codemix</c> column on <c>ssf.ai_jobs</c>.
///
/// <para>
/// <b>Disabled by default.</b> The worker is a one-time backfill against
/// production data; we do NOT want it spinning in dev / test boxes
/// where the legacy schema is empty. Founder explicitly opts in via
/// <c>Ai__TranscriptBackfill__Enabled=true</c> env var after Phase 1
/// ships and Phase 2 is stable.
/// </para>
///
/// <para>
/// <b>Idempotent.</b> Every batch re-queries on
/// <c>WHERE transcript_codemix IS NULL AND normalized_result_json IS NOT NULL
/// AND status = 'Succeeded'</c> — rows already backfilled are filtered
/// out by the IS NULL predicate. Re-running the worker is safe.
/// </para>
/// </summary>
public sealed class TranscriptBackfillOptions
{
    public const string SectionName = "Ai:TranscriptBackfill";

    /// <summary>
    /// Master kill-switch. Default <c>false</c> so the worker no-ops in
    /// every environment that does not explicitly opt in. Flip via the
    /// <c>Ai__TranscriptBackfill__Enabled</c> env var or appsettings
    /// override. The worker still starts as a hosted service but
    /// <see cref="TranscriptBackfillWorker.ExecuteAsync"/> exits
    /// immediately when this is <c>false</c>.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Max rows updated per database transaction. Defaults to 1000.
    /// Lower this if the production AiJob row size grows large enough
    /// that 1000 rows-per-tx causes statement timeouts; raise it if
    /// the row count is small and the backfill is taking longer than
    /// the worker schedule.
    /// </summary>
    public int BatchSize { get; set; } = 1000;

    /// <summary>
    /// Seconds to wait between successive batches. Defaults to 30. A
    /// batch that returns the full <see cref="BatchSize"/> bypasses
    /// this delay and runs the next batch immediately (chase mode);
    /// only the trailing partial / empty batch sleeps. The integration
    /// test sets this to 0 to drain the queue in one pass.
    /// </summary>
    public int DelayBetweenBatchesSeconds { get; set; } = 30;
}
