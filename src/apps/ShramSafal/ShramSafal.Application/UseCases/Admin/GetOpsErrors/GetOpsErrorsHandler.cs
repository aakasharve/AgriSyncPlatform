using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetOpsErrors;

public sealed record GetOpsErrorsQuery(
    int Page, int PageSize,
    string? Endpoint, DateTime? Since,
    Guid ActorId);

public sealed class GetOpsErrorsHandler(IAdminOpsRepository opsRepo)
{
    public async Task<Result<AdminResponseDto<OpsErrorsPageDto>>> HandleAsync(
        GetOpsErrorsQuery query, CancellationToken ct = default)
    {
        var page = await opsRepo.GetErrorsPagedAsync(
            query.Page, query.PageSize, query.Endpoint, query.Since, ct);

        return Result.Success(new AdminResponseDto<OpsErrorsPageDto>(page,
            new AdminMetaDto(
                Source: "live",
                Window: "last 24h",
                LastRefreshedUtc: DateTime.UtcNow,
                TtlSeconds: 30)));
    }
}
