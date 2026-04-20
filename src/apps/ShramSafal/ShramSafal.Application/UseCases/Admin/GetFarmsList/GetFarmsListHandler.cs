using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetFarmsList;

public sealed record GetFarmsListQuery(int Page, int PageSize, string? Search, string? Tier, Guid ActorId);

public sealed class GetFarmsListHandler(IAdminMisRepository misRepo)
{
    public async Task<Result<AdminResponseDto<FarmsListDto>>> HandleAsync(
        GetFarmsListQuery q, CancellationToken ct = default)
    {
        var farms = await misRepo.GetFarmsListAsync(q.Page, q.PageSize, q.Search, q.Tier, ct);
        return Result.Success(new AdminResponseDto<FarmsListDto>(farms,
            new AdminMetaDto("live-aggregated", "current", DateTime.UtcNow, 60)));
    }
}
