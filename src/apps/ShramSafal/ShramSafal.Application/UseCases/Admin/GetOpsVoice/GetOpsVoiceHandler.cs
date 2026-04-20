using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetOpsVoice;

public sealed record GetOpsVoiceQuery(int Days, Guid ActorId);

public sealed class GetOpsVoiceHandler(IAdminOpsRepository opsRepo)
{
    public async Task<Result<AdminResponseDto<OpsVoiceTrendDto>>> HandleAsync(
        GetOpsVoiceQuery query, CancellationToken ct = default)
    {
        var trend = await opsRepo.GetVoiceTrendAsync(query.Days, ct);

        return Result.Success(new AdminResponseDto<OpsVoiceTrendDto>(trend,
            new AdminMetaDto(
                Source: "live-aggregated",
                Window: $"last {query.Days} days",
                LastRefreshedUtc: DateTime.UtcNow,
                TtlSeconds: 300)));
    }
}
