using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Dfes.GetFarmerEngagement;

public sealed class GetFarmerEngagementHandler(IShramSafalRepository repository)
{
    public async Task<Result<FarmerEngagementDto>> HandleAsync(
        GetFarmerEngagementQuery query,
        CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty || query.CallerUserId == Guid.Empty)
        {
            return Result.Failure<FarmerEngagementDto>(ShramSafalErrors.InvalidCommand);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(query.FarmId, query.CallerUserId, ct);
        if (!isMember)
        {
            return Result.Failure<FarmerEngagementDto>(ShramSafalErrors.Forbidden);
        }

        var aggregates = await repository.GetDailyRichnessAggregatesForFarmAsync(query.FarmId, ct);
        var projection = FarmerEngagementProjection.Fold(aggregates);

        var dto = new FarmerEngagementDto(
            projection.CurrentStreak,
            projection.LongestStreak,
            projection.TotalShramPoints,
            projection.LastAccountedDate?.ToString("yyyy-MM-dd"),
            projection.TotalRichDays,
            projection.UnlockStatus);

        return Result.Success(dto);
    }
}
