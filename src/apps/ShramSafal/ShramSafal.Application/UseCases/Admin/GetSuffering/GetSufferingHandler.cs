using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetSuffering;

public sealed record GetSufferingQuery(Guid ActorId);

public sealed class GetSufferingHandler(IAdminMisRepository misRepo)
{
    public async Task<Result<AdminResponseDto<IReadOnlyList<SufferingItemDto>>>> HandleAsync(
        GetSufferingQuery q, CancellationToken ct = default)
    {
        var items = await misRepo.GetSufferingAsync(ct);
        return Result.Success(new AdminResponseDto<IReadOnlyList<SufferingItemDto>>(items,
            new AdminMetaDto("live-aggregated", "last 24h", DateTime.UtcNow, 60)));
    }
}
