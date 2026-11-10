using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 3 (R31, R32; founder D-74, D-88 = "you, plus the people you give
/// 'पीक वेळापत्रकाचे नमुने'; each version shows who made it"). The ONE answer to "may this person write the OWN schedule of THIS farm?" -
/// make it, copy a checked schedule into it, change it, publish it. Static like <see cref="FarmAuthorityGate"/> (it reads through the
/// repository the caller already holds).
/// <list type="bullet">
/// <item>The farm's primary owner (<see cref="Farm.OwnerUserId"/>) always may.</item>
/// <item>Anyone else needs an <b>Active seat on THIS farm that holds</b> <see cref="FarmAuthority.ScheduleTemplates"/>: the seat decides,
/// never a label and never the account's global role (R31, D-26). A सहमालक whose owner switched the authority off may not; a मुकादम
/// given it may. A paused, waiting or ended seat holds nothing; the same authority on ANOTHER farm counts for nothing here.</item>
/// </list>
/// Deliberately NOT <c>ScopeRoleGate</c>: that gate also asks the account's global role (the expert sign-up roles) for a Team write,
/// which would refuse a मुकादम the owner has trusted with the schedule (R31). The expert-owned Team schedule (no farm) keeps ScopeRoleGate.
/// </summary>
public static class OwnScheduleGate
{
    public static async Task<bool> AllowsAsync(
        IShramSafalRepository repository, Guid farmId, Guid callerUserId, DateTime nowUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (farmId == Guid.Empty || callerUserId == Guid.Empty)
        {
            return false;
        }

        if (await repository.GetFarmByIdAsync(farmId, ct) is not { } farm)
        {
            // An unreadable farm fails closed: no owner can be named and no seat is trusted without it.
            return false;
        }

        return farm.OwnerUserId.Value == callerUserId
            || await FarmAuthorityGate.HoldsAsync(repository, farmId, callerUserId, FarmAuthority.ScheduleTemplates, nowUtc, ct);
    }
}
