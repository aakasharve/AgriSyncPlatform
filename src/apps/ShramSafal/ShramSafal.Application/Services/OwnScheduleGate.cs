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
    /// <summary>
    /// spec: plr-d10 lane SCH-OWN-c (E4) - the OWNER of <paramref name="farmId"/> (its <c>owner_user_id</c>, the person a new own chain belongs
    /// to) when <paramref name="callerUserId"/> may write that farm's own schedules; <c>null</c> when he may not (or the farm cannot be read).
    /// One farm read; the id comes from the SAME farm row the gate trusted, never from a request body.
    /// </summary>
    public static async Task<Guid?> OwnerIfAllowedAsync(
        IShramSafalRepository repository, Guid farmId, Guid callerUserId, DateTime nowUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (farmId == Guid.Empty || callerUserId == Guid.Empty)
        {
            return null;
        }

        if (await repository.GetFarmByIdAsync(farmId, ct) is not { } farm)
        {
            // An unreadable farm fails closed: no owner can be named and no seat is trusted without it.
            return null;
        }

        var owner = farm.OwnerUserId.Value;
        return owner == callerUserId
            || await FarmAuthorityGate.HoldsAsync(repository, farmId, callerUserId, FarmAuthority.ScheduleTemplates, nowUtc, ct)
                ? owner
                : null;
    }

    /// <summary>May <paramref name="callerUserId"/> write the own schedules of <paramref name="farmId"/>'s owner, naming that farm?</summary>
    public static async Task<bool> AllowsAsync(
        IShramSafalRepository repository, Guid farmId, Guid callerUserId, DateTime nowUtc, CancellationToken ct = default) =>
        await OwnerIfAllowedAsync(repository, farmId, callerUserId, nowUtc, ct) is not null;
}
