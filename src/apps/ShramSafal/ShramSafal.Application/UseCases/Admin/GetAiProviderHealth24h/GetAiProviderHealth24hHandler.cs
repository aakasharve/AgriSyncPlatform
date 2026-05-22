using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetAiProviderHealth24h;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.1 — admin
/// observability read for the rolling 24h provider-health rollup.
/// Pure pass-through of the <c>ssf.v_ai_provider_health_24h</c>
/// view rows; authorization happens at the endpoint layer
/// (<c>ModuleKey.OpsVoice</c> read gate).
/// </summary>
public sealed record GetAiProviderHealth24hQuery(Guid ActorUserId);

public sealed class GetAiProviderHealth24hHandler(IAdminAiObservabilityRepository repo)
{
    public async Task<Result<AiProviderHealth24hResponse>> HandleAsync(
        GetAiProviderHealth24hQuery query,
        CancellationToken ct = default)
    {
        var rows = await repo.GetProviderHealth24hAsync(ct).ConfigureAwait(false);
        return Result.Success(new AiProviderHealth24hResponse(rows, DateTime.UtcNow));
    }
}
