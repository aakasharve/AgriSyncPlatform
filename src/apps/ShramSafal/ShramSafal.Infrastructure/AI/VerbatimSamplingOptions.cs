namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11 — configuration for
/// the <see cref="VerbatimSamplingWorker"/>. The worker periodically scans
/// recently-completed Sarvam <c>VoiceToStructuredLog</c> ai_jobs and, for
/// the deterministic 10% hash-bucket subset whose owners have granted
/// <see cref="ShramSafal.Application.Privacy.Ports.ConsentPurpose.VerbatimTrainingCorpus"/>,
/// emits a verbatim STT call into the labelled training corpus.
///
/// <para>
/// <b>Disabled by default.</b> The verbatim D-MOAT sampler is an opt-in
/// data-collection pipeline. Production sets <c>Ai__VerbatimSampling__Enabled=true</c>
/// only AFTER:
/// <list type="number">
///   <item>The Phase 1.4 <c>ssf.feature_flags</c> row
///   <c>verbatim_corpus_sampling_enabled</c> is enabled for the target
///   cohort (Safeguard S7).</item>
///   <item>The Phase 1.5 <c>ssf.mode_policy</c> row
///   <c>trigger_type='verbatim_sample'</c> has a sane
///   <c>max_daily_cost_inr</c> cap (₹100/day default).</item>
/// </list>
/// Until then the worker still spawns as a hosted service but
/// <see cref="VerbatimSamplingWorker.ExecuteAsync"/> exits on the first
/// tick when <see cref="Enabled"/> is false.
/// </para>
///
/// <para>
/// <b>Deterministic sampling rate.</b> The worker keeps audio whose
/// <c>InputContentHash</c>'s leading 32 bits modulo 10 fall under the
/// configured <see cref="SamplingRatePercent"/> bucket. Default 10% so
/// roughly 1-in-10 retained clips enter the corpus over the long run.
/// Raise to 100 to flush the entire candidate set during cold-start
/// catch-up; drop to 0 to halt sampling without disabling the worker
/// (useful during budget recovery).
/// </para>
/// </summary>
public sealed class VerbatimSamplingOptions
{
    public const string SectionName = "Ai:VerbatimSampling";

    /// <summary>
    /// Master kill-switch. Default <c>false</c> so the worker no-ops
    /// in every environment that does not explicitly opt in.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Maximum rows scanned per tick. Defaults to 100. The worker
    /// applies the consent + hash-bucket filters in memory after the
    /// candidate batch is fetched, so the actual Sarvam-call volume
    /// per tick is roughly <c>BatchSize × SamplingRatePercent/100 ×
    /// opt-in-rate</c>.
    /// </summary>
    public int BatchSize { get; set; } = 100;

    /// <summary>
    /// Tick cadence in minutes. Default <c>60</c>. Clamped to a minimum
    /// of 1 minute at runtime.
    /// </summary>
    public int TickIntervalMinutes { get; set; } = 60;

    /// <summary>
    /// Deterministic hash-bucket percentage. The worker keeps any row
    /// whose <c>audio_content_hash</c>'s first 8 hex characters parsed
    /// as <c>Int32</c> mod 10 falls under the configured percentage
    /// (default 10%). Range [0, 100]; values outside are clamped at
    /// runtime.
    /// </summary>
    public int SamplingRatePercent { get; set; } = 10;
}
