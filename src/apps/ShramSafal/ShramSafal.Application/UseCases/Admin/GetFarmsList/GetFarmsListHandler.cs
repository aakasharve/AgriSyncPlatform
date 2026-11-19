using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;

namespace ShramSafal.Application.UseCases.Admin.GetFarmsList;

public sealed record GetFarmsListQuery(int Page, int PageSize, string? Search, string? Tier, Guid ActorId);

public sealed class GetFarmsListHandler(IAdminMisRepository misRepo)
{
    /// <summary>
    /// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, C32). The tier filter counts every farm's checked days
    /// before paging; above the live-count ceiling it is refused (409) rather than applied to part of the farms.
    /// </summary>
    public const string TierFilterTooManyFarmsCode = "tier_filter_too_many_farms";

    /// <summary>
    /// C33: with the tier filter on, a farm whose rows could not be read would be silently left out of every tier, so
    /// the filter is refused (409) rather than answered incomplete.
    /// </summary>
    public const string TierFilterNotMeasuredCode = "tier_filter_not_measured";

    /// <summary>C33: a tier other than A, B, C or D is refused (400) before anything is read.</summary>
    public const string TierInvalidCode = "tier_invalid";

    /// <summary>
    /// C33: <see cref="FarmSummaryDto.ConfirmedDaysNotMeasuredReason"/> of a farm whose rows could not be read (no
    /// owner account, or its row did not come back under its own row-level security).
    /// </summary>
    public const string FarmUnreadable = "farm_unreadable";

    /// <summary>
    /// C35 (1): <see cref="FarmSummaryDto.ConfirmedDaysNotMeasuredReason"/> of a farm owned by a test account
    /// (<c>CompanyMis:ExcludedUserIds</c>): never counted, so its three counts are null and it never reads as "no
    /// entry".
    /// </summary>
    public const string TestAccount = "test_account";

    public async Task<Result<AdminResponseDto<FarmsListDto>>> HandleAsync(
        GetFarmsListQuery q, CancellationToken ct = default)
    {
        // Blank means no filter, as before; anything else must be one of the four tiers, checked before any read.
        if (!string.IsNullOrWhiteSpace(q.Tier) && q.Tier.Trim() is not (
                ConfirmedFarmDays.TierA or ConfirmedFarmDays.TierB or ConfirmedFarmDays.TierC or ConfirmedFarmDays.TierD))
        {
            return Result.Failure<AdminResponseDto<FarmsListDto>>(Error.Validation(TierInvalidCode,
                "The tier filter is one of A, B, C or D."));
        }

        var farms = await misRepo.GetFarmsListAsync(q.ActorId, q.Page, q.PageSize, q.Search, q.Tier, ct);

        switch (farms.RefusalCode)
        {
            case null:
                break;
            case TierFilterTooManyFarmsCode:
                return Result.Failure<AdminResponseDto<FarmsListDto>>(Error.Conflict(TierFilterTooManyFarmsCode,
                    "The tier filter needs every farm's checked days, and there are more than "
                    + $"{GetCompanyMisHandler.MaxFarmsForLiveCount} farms to count live. Clear the tier filter."));
            case TierFilterNotMeasuredCode:
                return Result.Failure<AdminResponseDto<FarmsListDto>>(Error.Conflict(TierFilterNotMeasuredCode,
                    "The tier filter needs every farm's checked days, and at least one farm could not be read, "
                    + "so the filtered list would be incomplete. Clear the tier filter."));
            default:
                // An unknown refusal must never be sent as the (empty) list it came with: the route answers 500.
                return Result.Failure<AdminResponseDto<FarmsListDto>>(Error.Internal(farms.RefusalCode,
                    $"The farm list was refused with an unknown code: {farms.RefusalCode}."));
        }

        return Result.Success(new AdminResponseDto<FarmsListDto>(farms,
            new AdminMetaDto("live-aggregated", "current", DateTime.UtcNow, 60)));
    }
}
