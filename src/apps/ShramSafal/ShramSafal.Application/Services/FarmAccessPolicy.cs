using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, plan §2 #1) — one person's standing on one farm,
/// as the access rule needs it: the role, the seat status, whether they are the farm's registrant
/// (<c>farms.owner_user_id</c>, who always holds every power), and the owner's stored permission
/// choice (<c>null</c> = the role's defaults). Loaded by
/// <see cref="IShramSafalRepository.GetFarmAccessForUserAsync"/>.
/// </summary>
public sealed record FarmAccess(
    AppRole Role,
    MembershipStatus Status,
    bool IsRegistrant,
    FarmPermission? StoredPermissions);

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — THE rule for "may this person do X on this
/// farm", for the permissions the owner controls (<see cref="FarmPermission"/>). Pure: the async
/// load lives in <see cref="FarmPermissionGate"/>, so the rule is enumerated without a database.
/// <list type="bullet">
/// <item>No standing (not a member) → nothing.</item>
/// <item>The registrant → everything, whatever any row says (the registrant can never be paused or
/// narrowed in M1, plan §4).</item>
/// <item>A seat that is not Active (waiting, paused) → nothing (BN-1).</item>
/// <item>Otherwise <see cref="FarmPermissionDefaults.Effective"/> over role + stored choice.</item>
/// </list>
/// The labour grant ("हजेरी व पक्कं करणे") is NOT here — it is
/// <see cref="LabourManagementPermission"/>, one switch, unchanged.
/// </summary>
public static class FarmAccessPolicy
{
    public static FarmPermission Effective(FarmAccess? access)
    {
        if (access is null)
        {
            return FarmPermission.None;
        }

        if (access.IsRegistrant)
        {
            return FarmPermissionDefaults.All;
        }

        return access.Status == MembershipStatus.Active
            ? FarmPermissionDefaults.Effective(access.Role, access.StoredPermissions)
            : FarmPermission.None;
    }

    public static bool Has(FarmAccess? access, FarmPermission permission) =>
        permission != FarmPermission.None && (Effective(access) & permission) == permission;
}

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the async half of <see cref="FarmAccessPolicy"/>:
/// load the caller's standing and answer. Callers map <c>false</c> to
/// <c>ShramSafalErrors.Forbidden</c> (never NotFound), the posture every gate here takes.
/// </summary>
public static class FarmPermissionGate
{
    public static async Task<bool> HasAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        FarmPermission permission,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        var access = await repository.GetFarmAccessForUserAsync(farmId, userId, ct);
        return FarmAccessPolicy.Has(access, permission);
    }
}
