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
    /// <summary>The bits Up() adds by label (a stored labour grant also adds ConfirmRecords).</summary>
    public static FarmPermission BitsFor(AppRole role) => role switch
    {
        AppRole.SecondaryOwner => FarmPermission.SeeMoney | FarmPermission.SeeWages | FarmPermission.AddCost
            | FarmPermission.PlanWork | FarmPermission.AssignWork | FarmPermission.EditFarmSetup,
        AppRole.Mukadam => FarmPermission.PlanWork | FarmPermission.AssignWork,
        AppRole.Agronomist or AppRole.FpcTechnicalManager =>
            FarmPermission.SeeMoney | FarmPermission.AddCost | FarmPermission.PlanWork,
        AppRole.Consultant or AppRole.FieldScout or AppRole.LabOperator => FarmPermission.PlanWork,
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
