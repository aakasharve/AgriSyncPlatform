using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;

namespace ShramSafal.Application.UseCases.Admin.GetFarmsList;

public sealed record GetFarmsListQuery(int Page, int PageSize, string? Search, string? Tier, Guid ActorId);

public sealed class GetFarmsListHandler(IAdminMisRepository misRepo)
{
    /// <summary>
    /// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, C32). The tier filter counts every farm's checked days
    /// before paging; above the live-count ceiling it is refused (409) rather than applied to part of the farms.
    /// </summary>
    public const string TierFilterTooManyFarmsCode = "tier_filter_too_many_farms";

    public async Task<Result<AdminResponseDto<FarmsListDto>>> HandleAsync(
        GetFarmsListQuery q, CancellationToken ct = default)
    {
        var farms = await misRepo.GetFarmsListAsync(q.ActorId, q.Page, q.PageSize, q.Search, q.Tier, ct);

        switch (farms.RefusalCode)
        {
            case null:
                break;
            case TierFilterTooManyFarmsCode:
                return Result.Failure<AdminResponseDto<FarmsListDto>>(Error.Conflict(TierFilterTooManyFarmsCode,
                    "The tier filter needs every farm's checked days, and there are more than "
                    + $"{GetCompanyMisHandler.MaxFarmsForLiveCount} farms to count live. Clear the tier filter."));
            default:
                // An unknown refusal must never be sent as the (empty) list it came with: the route answers 500.
                return Result.Failure<AdminResponseDto<FarmsListDto>>(Error.Internal(farms.RefusalCode,
                    $"The farm list was refused with an unknown code: {farms.RefusalCode}."));
        }

        return Result.Success(new AdminResponseDto<FarmsListDto>(farms,
            new AdminMetaDto("live-aggregated", "current", DateTime.UtcNow, 60)));
    }
}
