namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11a — configuration
/// for the <see cref="SelectiveDiarizationWorker"/>. The worker scans
/// for daily-log rows whose verification state is
/// <see cref="ShramSafal.Domain.Logs.VerificationStatus.Disputed"/> or
/// <see cref="ShramSafal.Domain.Logs.VerificationStatus.CorrectionPending"/>
/// (the two Trust Ladder dispute states) and adds a diarized transcript
/// onto the linked <c>ssf.ai_jobs</c> row.
///
/// <para>
/// <b>Disabled by default.</b> Diarization is a paid Sarvam add-on
/// (≈₹15/hr per ADR-DS-014 pricing snapshot). Production opts in via
/// <c>Ai__SelectiveDiarization__Enabled=true</c> after the Phase 1.5a
/// <c>ssf.diarization_policy</c> row for <c>trigger_type='dispute_flagged'</c>
/// has its cost cap configured.
/// </para>
///
/// <para>
/// <b>Why a faster cadence than verbatim.</b> Disputes are time-sensitive
/// (a farmer or manager is actively reviewing the log) so the default
/// tick is 5 minutes vs verbatim's 60 minutes. The worker still bounds
/// load via <see cref="BatchSize"/> per tick.
/// </para>
/// </summary>
public sealed class SelectiveDiarizationOptions
{
    public const string SectionName = "Ai:SelectiveDiarization";

    /// <summary>
    /// Master kill-switch. Default <c>false</c> so the worker no-ops in
    /// every environment that does not explicitly opt in.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Maximum candidates processed per tick. Defaults to 25 because
    /// each diarized call is expensive — the worker prefers to drip
    /// rather than blast through a large backlog in one cycle.
    /// </summary>
    public int BatchSize { get; set; } = 25;

    /// <summary>
    /// Tick cadence in minutes. Default <c>5</c>. Clamped to a minimum
    /// of 1 minute at runtime.
    /// </summary>
    public int TickIntervalMinutes { get; set; } = 5;
}
