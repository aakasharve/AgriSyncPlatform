using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - WHICH of the schedules a plot-season follows an abandon or a complete acts on.
/// <list type="bullet">
/// <item>The request names one (<c>subscriptionId</c>): an Active row of THIS plot-season is acted on. A row of this plot-season in
/// another state was changed first (another phone): <see cref="ShramSafalErrors.ScheduleChangedElsewhere"/>. Anything else (unknown,
/// another plot, another farm) answers <see cref="ShramSafalErrors.ScheduleSubscriptionNotFound"/> exactly like a made-up id (E4).</item>
/// <item>It names none (every phone before this lane, P11): exactly one Active row is that one; several are
/// <see cref="ShramSafalErrors.ScheduleChoiceNeeded"/> and nothing is written - never an arbitrary row; none is
/// <see cref="ShramSafalErrors.ScheduleSubscriptionNotFound"/>.</item>
/// </list>
/// </summary>
internal static class FollowedScheduleChoice
{
    public static async Task<Result<ScheduleSubscription>> PickAsync(
        IShramSafalRepository repository,
        IReadOnlyList<ScheduleSubscription> active,
        Guid? subscriptionId,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        CancellationToken ct)
    {
        if (subscriptionId is { } named)
        {
            var chosen = active.FirstOrDefault(s => s.Id == named);
            if (chosen is not null)
            {
                return Result.Success(chosen);
            }

            var other = await repository.GetScheduleSubscriptionByIdAsync(new ScheduleSubscriptionId(named), ct);
            return other is not null && other.FarmId == farmId && other.PlotId == plotId && other.CropCycleId == cropCycleId
                ? Result.Failure<ScheduleSubscription>(ShramSafalErrors.ScheduleChangedElsewhere)
                : Result.Failure<ScheduleSubscription>(ShramSafalErrors.ScheduleSubscriptionNotFound);
        }

        return active.Count switch
        {
            0 => Result.Failure<ScheduleSubscription>(ShramSafalErrors.ScheduleSubscriptionNotFound),
            1 => Result.Success(active[0]),
            _ => Result.Failure<ScheduleSubscription>(ShramSafalErrors.ScheduleChoiceNeeded),
        };
    }
}
