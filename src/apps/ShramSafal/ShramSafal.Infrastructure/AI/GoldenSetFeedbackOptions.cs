namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.3 (data-eng brief
/// Theme B-2, Safeguard B2) — configuration for the
/// <see cref="GoldenSetFeedbackWorker"/>. The worker scans
/// <c>ssf.correction_events</c> on a fixed cadence and projects each
/// non-PII correction into a
/// <see cref="Domain.AI.GoldenSetCandidate"/> row, ready for the
/// future weekly batch promote-job to admit into the active golden
/// set (parking lot — golden-set repo authoring infra deferred).
///
/// <para>
/// <b>Disabled by default.</b> The capture worker is opt-in. Until
/// the promote infra ships, dormant capture is the right shape —
/// production sets <c>Ai__GoldenSetFeedback__Enabled=true</c> only
/// after founder confirms the worker should start collecting.
/// The hosted service still spawns but
/// <see cref="GoldenSetFeedbackWorker.ExecuteAsync"/> exits on the
/// first tick when <see cref="Enabled"/> is false — zero load.
/// </para>
///
/// <para>
/// <b>Batch sizing.</b> Each tick processes at most
/// <see cref="BatchSize"/> correction_events ordered by
/// <c>captured_at_utc DESC</c>, so the most recent corrections
/// always make it into the candidate set on the next tick even if
/// the backlog is large. The default <c>100</c> keeps each tick's
/// memory footprint bounded; raise during cold-start catch-up.
/// </para>
///
/// <para>
/// <b>Idempotency.</b> The worker upserts via <c>ON CONFLICT DO
/// NOTHING</c> on the
/// <c>(audio_content_hash, correction_type)</c> unique key, so
/// re-running over the same correction is a no-op rather than a
/// duplicate-row failure.
/// </para>
/// </summary>
public sealed class GoldenSetFeedbackOptions
{
    public const string SectionName = "Ai:GoldenSetFeedback";

    /// <summary>
    /// Master kill-switch. Default <c>false</c> so the worker
    /// no-ops in every environment that does not explicitly opt
    /// in.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Maximum rows processed per tick. Defaults to 100.
    /// </summary>
    public int BatchSize { get; set; } = 100;

    /// <summary>
    /// Tick cadence in minutes. Default <c>15</c>. Clamped to a
    /// minimum of 1 minute at runtime.
    /// </summary>
    public int TickIntervalMinutes { get; set; } = 15;
}
