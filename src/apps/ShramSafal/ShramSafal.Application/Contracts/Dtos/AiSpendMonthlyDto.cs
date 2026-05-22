namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.2 — one row of the
/// <c>ssf.v_ai_spend_monthly</c> view (rollup of
/// <c>ai_provider_spend_daily</c> per
/// <c>(tenant_id, provider, operation, month_utc)</c>). Served from
/// <c>GET /shramsafal/admin/ai-spend</c> and rendered as the
/// monthly-total panel in <c>AiSpendPanel.tsx</c>.
/// </summary>
/// <param name="TenantId">Per Phase 2.7 schema, the rollup's tenant is the
///   farm_id stamped on each <c>AiJob</c>. A future per-tenant budget
///   keyed at the organization layer is parking-lot.</param>
/// <param name="Provider">String-enum (e.g. <c>"Sarvam"</c>, <c>"Gemini"</c>).</param>
/// <param name="Operation">String-enum (e.g. <c>"VoiceToStructuredLog"</c>).</param>
/// <param name="MonthUtc">First-day-of-month UTC date (<c>DATE_TRUNC('month', day_utc)</c>).</param>
/// <param name="TotalInr">Sum of <c>total_inr</c> for the month.</param>
/// <param name="DaysWithSpend">Count of distinct days with at least one rollup row.</param>
/// <param name="FirstDay">Earliest day in the month with a rollup row.</param>
/// <param name="LastDay">Latest day in the month with a rollup row.</param>
/// <param name="LastUpdatedUtc">Most recent <c>modified_at_utc</c> for the month.</param>
public sealed record AiSpendMonthlyDto(
    Guid TenantId,
    string Provider,
    string Operation,
    DateOnly MonthUtc,
    decimal TotalInr,
    int DaysWithSpend,
    DateOnly FirstDay,
    DateOnly LastDay,
    DateTime LastUpdatedUtc);

/// <summary>
/// Envelope for <c>GET /shramsafal/admin/ai-spend</c>. The panel
/// uses <see cref="MonthlyBudgetByTenant"/> to render the 80%/100%
/// budget approach indicator alongside each row's
/// <see cref="AiSpendMonthlyDto.TotalInr"/>. NULL in the budget map
/// means "no cap" (renders as the gray "uncapped" pill).
/// </summary>
public sealed record AiSpendMonthlyResponse(
    IReadOnlyList<AiSpendMonthlyDto> Rows,
    IReadOnlyDictionary<Guid, decimal?> MonthlyBudgetByTenant,
    DateTime ComputedAtUtc);
