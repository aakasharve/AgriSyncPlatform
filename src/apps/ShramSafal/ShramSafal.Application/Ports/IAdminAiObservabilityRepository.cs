using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Tasks 3.1 + 3.2 — admin
/// AI observability read port. Surfaces the two Phase 3 Slice E
/// admin panels (provider health 24h + monthly spend rollup) from
/// the corresponding SQL views (<c>ssf.v_ai_provider_health_24h</c>
/// + <c>ssf.v_ai_spend_monthly</c>) without leaking persistence
/// types into the Application layer.
/// </summary>
/// <remarks>
/// Implementation lives in Infrastructure via raw SQL against
/// <see cref="Persistence.ShramSafalDbContext"/>. The views inherit
/// the underlying tables' RLS posture (admin-only consumers) and
/// the calling endpoint pre-gates on
/// <c>ModuleKey.OpsVoice</c> read scope.
/// </remarks>
public interface IAdminAiObservabilityRepository
{
    Task<IReadOnlyList<AiProviderHealth24hDto>> GetProviderHealth24hAsync(
        CancellationToken ct = default);

    Task<IReadOnlyList<AiSpendMonthlyDto>> GetSpendMonthlyAsync(
        CancellationToken ct = default);

    /// <summary>
    /// Map of <c>tenant_id → monthly_budget_inr</c> read from
    /// <c>ssf.ai_provider_configs</c>. NULL values mean "no cap".
    /// The admin spend panel renders this alongside the rollup.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, decimal?>> GetMonthlyBudgetByTenantAsync(
        CancellationToken ct = default);
}
