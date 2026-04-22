using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetWvfdHistory;

public sealed record GetWvfdHistoryQuery(int Weeks, Guid ActorId);

public sealed class GetWvfdHistoryHandler(IAdminMisRepository misRepo)
{
    public async Task<Result<AdminResponseDto<WvfdHistoryDto>>> HandleAsync(
        GetWvfdHistoryQuery query, CancellationToken ct = default)
    {
        var history = await misRepo.GetWvfdHistoryAsync(query.Weeks, ct);
        return Result.Success(new AdminResponseDto<WvfdHistoryDto>(history,
            new AdminMetaDto(
                Source: "materialized",
                Window: $"last {query.Weeks} weeks",
                LastRefreshedUtc: DateTime.UtcNow,
                TtlSeconds: 300)));
    }
}
