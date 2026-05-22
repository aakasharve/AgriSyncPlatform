using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetAiSpendMonthly;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.2 — admin
/// observability read for the monthly AI provider spend rollup.
/// Pairs each <c>ssf.v_ai_spend_monthly</c> view row with the
/// per-tenant monthly budget from <c>ssf.ai_provider_configs</c>
/// so the panel can render the 80%/100% approach indicator.
/// Authorization happens at the endpoint layer
/// (<c>ModuleKey.OpsVoice</c> read gate).
/// </summary>
public sealed record GetAiSpendMonthlyQuery(Guid ActorUserId);

public sealed class GetAiSpendMonthlyHandler(IAdminAiObservabilityRepository repo)
{
    public async Task<Result<AiSpendMonthlyResponse>> HandleAsync(
        GetAiSpendMonthlyQuery query,
        CancellationToken ct = default)
    {
        var rowsTask = repo.GetSpendMonthlyAsync(ct);
        var budgetsTask = repo.GetMonthlyBudgetByTenantAsync(ct);
        await Task.WhenAll(rowsTask, budgetsTask).ConfigureAwait(false);

        return Result.Success(new AiSpendMonthlyResponse(
            Rows: await rowsTask.ConfigureAwait(false),
            MonthlyBudgetByTenant: await budgetsTask.ConfigureAwait(false),
            ComputedAtUtc: DateTime.UtcNow));
    }
}
