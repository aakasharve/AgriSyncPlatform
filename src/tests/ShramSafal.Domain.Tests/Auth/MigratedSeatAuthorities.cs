// lane 2b (P11) — what the 20261031021129_SplitFarmAuthorities migration writes for a let-in seat
// that had NO stored bits and NO labour grant before the upgrade: each label's then-server-enforced
// powers, as explicit authorities. Test doubles that stand for "an existing seat after the
// upgrade" answer through this, so the handler suites keep proving yesterday's behaviour for
// yesterday's people. The real-Postgres migration test proves the SQL writes exactly these bits.
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Domain.Tests.Auth;

internal static class MigratedSeatAuthorities
{
    /// <summary>
    /// The bits Up() adds by label for a seat with nothing stored (a stored labour grant also adds
    /// ConfirmRecords; a सहमालक with a stored AddCost also gets review money). Fix 1: the upgrade
    /// never widens — no review money, plan or assign for any label by itself.
    /// </summary>
    public static FarmPermission BitsFor(AppRole role) => role switch
    {
        AppRole.SecondaryOwner => FarmPermission.SeeMoney | FarmPermission.SeeWages | FarmPermission.EditFarmSetup,
        _ => FarmPermission.None,
    };

    /// <summary>Up() stores take हजेरी (permanent) for every सहमालक seat — its labour edits came with the label.</summary>
    public static bool LabourFor(AppRole role) => role == AppRole.SecondaryOwner;

    /// <summary>The standing of an upgraded, Active seat with this label (the primary owner's label holds all anyway).</summary>
    public static FarmAccess AccessFor(AppRole role, bool storedLabourGrant = false) =>
        new(
            role,
            MembershipStatus.Active,
            IsRegistrant: false,
            BitsFor(role) | (storedLabourGrant ? FarmPermission.ConfirmRecords : FarmPermission.None),
            LabourGrant: LabourFor(role) || storedLabourGrant);
}
