// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-26: authority comes from the farm seat, never a label).
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// Turns one person's standing on one farm (<see cref="FarmAccess"/>) into the <see cref="PlannedWorkSeat"/> the pure task
/// rules read: what he holds NOW (an ended grant is not held), whether he reads only what he made, and which plots he covers.
/// ONE builder, asked by every planned-work door, the pull and the REST reads, so they cannot disagree.
/// </summary>
public static class PlannedWorkSeats
{
    public static PlannedWorkSeat From(FarmAccess? access, Guid userId, DateTime atUtc)
    {
        if (!FarmAccessPolicy.MayRead(access))
        {
            return new PlannedWorkSeat(userId, false, false, false, false, false, null, false);
        }

        var primary = FarmAccessPolicy.IsPrimaryAccountHolder(access);
        bool Holds(FarmAuthority authority) => primary || FarmAccessPolicy.Holds(access, authority, atUtc);
        return new PlannedWorkSeat(
            userId,
            Active: true,
            IsPrimaryOwner: primary,
            HoldsPlanWork: Holds(FarmAuthority.PlanWork),
            HoldsAssignWork: Holds(FarmAuthority.AssignWork),
            HoldsSeeAllTasks: Holds(FarmAuthority.SeeAllTasks),
            ChosenPlotIds: primary ? null : access!.CoveredPlotIds,
            OwnWorkScope: !primary && access!.OwnWorkScope);
    }

    /// <summary>The same, read from the repository: the person's seat on <paramref name="farmId"/>.</summary>
    public static async Task<PlannedWorkSeat> OfAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        return farmId == Guid.Empty || userId == Guid.Empty
            ? From(null, userId, atUtc)
            : From(await repository.GetFarmAccessForUserAsync(farmId, userId, ct), userId, atUtc);
    }
}
