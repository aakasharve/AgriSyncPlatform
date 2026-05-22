namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.1 — one row of the
/// <c>ssf.v_ai_provider_health_24h</c> view (rolling 24h rollup of
/// <c>ai_job_attempts</c> per <c>(provider, operation)</c>). Served
/// from <c>GET /shramsafal/admin/ai-health</c> and rendered as the
/// colored health-grid in <c>Ai24hHealthPanel.tsx</c>.
/// </summary>
/// <param name="Provider">String-enum (e.g. <c>"Sarvam"</c>, <c>"Gemini"</c>).</param>
/// <param name="Operation">String-enum (e.g. <c>"VoiceToStructuredLog"</c>).</param>
/// <param name="Attempts">Total attempt rows in the 24h window.</param>
/// <param name="Successes">Subset of <paramref name="Attempts"/> with <c>is_success = true</c>.</param>
/// <param name="Failures">Subset with <c>is_success = false</c>.</param>
/// <param name="SuccessRatePct">Rounded percentage (0.00–100.00).</param>
/// <param name="P50LatencyMs">Median latency.</param>
/// <param name="P95LatencyMs">p95 latency.</param>
/// <param name="WindowEndUtc">Most recent attempt in the window.</param>
/// <param name="WindowStartUtc">Oldest attempt in the window.</param>
public sealed record AiProviderHealth24hDto(
    string Provider,
    string Operation,
    int Attempts,
    int Successes,
    int Failures,
    decimal SuccessRatePct,
    int? P50LatencyMs,
    int? P95LatencyMs,
    DateTime? WindowEndUtc,
    DateTime? WindowStartUtc);

/// <summary>
/// Envelope for <c>GET /shramsafal/admin/ai-health</c>.
/// </summary>
public sealed record AiProviderHealth24hResponse(
    IReadOnlyList<AiProviderHealth24hDto> Rows,
    DateTime ComputedAtUtc);
