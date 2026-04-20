namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Phase 6 Owner MIS — per-farm weekly snapshot sourced from mis.* views.
/// Returned by GetFarmWeekMisHandler. All pct values are 0–100.
/// </summary>
public sealed record FarmWeekMisDto(
    Guid FarmId,
    /// <summary>Rolling 7-day verified farm-days (0–7). North Star target ≥ 4.5.</summary>
    decimal Wvfd,
    /// <summary>Engagement tier: A (≥5), B (3-5), C (1-3), D (<1)</summary>
    string EngagementTier,
    /// <summary>Median hours between log creation and first verification. Target ≤ 36h.</summary>
    decimal? MedianVerifyLagHours,
    /// <summary>% of logs owner-edited after submit. Target ≤ 15%.</summary>
    decimal? CorrectionRatePct,
    /// <summary>% of logs with source=voice. Target ≥ 40%.</summary>
    decimal? VoiceSharePct,
    /// <summary>% of prescribed tasks done within ±2 day window. Target ≥ 50%.</summary>
    decimal? ScheduleCompliancePct,
    /// <summary>% of logs with no active schedule. Lower = more schedule depth.</summary>
    decimal? UnscheduledLogPct,
    /// <summary>Total Gemini cost in USD over last 7 days.</summary>
    decimal? AiCostUsd7d);
