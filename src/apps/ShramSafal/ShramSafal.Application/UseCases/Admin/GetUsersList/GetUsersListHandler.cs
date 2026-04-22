using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetUsersList;

public sealed record GetUsersListQuery(int Page, int PageSize, string? Search, Guid ActorId);

public sealed class GetUsersListHandler(IAdminMisRepository misRepo)
{
    public async Task<Result<AdminResponseDto<UsersListDto>>> HandleAsync(
        GetUsersListQuery q, CancellationToken ct = default)
    {
        var users = await misRepo.GetUsersListAsync(q.Page, q.PageSize, q.Search, ct);
        return Result.Success(new AdminResponseDto<UsersListDto>(users,
            new AdminMetaDto("live", "current", DateTime.UtcNow, 60)));
    }
}
