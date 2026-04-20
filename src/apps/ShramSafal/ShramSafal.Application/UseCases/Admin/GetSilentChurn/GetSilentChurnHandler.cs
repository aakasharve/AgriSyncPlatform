using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetSilentChurn;

public sealed record GetSilentChurnQuery(Guid ActorId);

public sealed class GetSilentChurnHandler(IAdminMisRepository misRepo)
{
    public async Task<Result<AdminResponseDto<IReadOnlyList<SilentChurnItemDto>>>> HandleAsync(
        GetSilentChurnQuery q, CancellationToken ct = default)
    {
        var items = await misRepo.GetSilentChurnAsync(ct);
        return Result.Success(new AdminResponseDto<IReadOnlyList<SilentChurnItemDto>>(items,
            new AdminMetaDto("materialized", "current", DateTime.UtcNow, 300)));
    }
}
