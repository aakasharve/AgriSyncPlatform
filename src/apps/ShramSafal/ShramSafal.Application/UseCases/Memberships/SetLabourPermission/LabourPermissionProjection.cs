using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.SetLabourPermission;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — the ONE place a <see cref="FarmMembership"/> becomes
/// a <see cref="LabourPermissionDto"/>.
///
/// <para><b>Shared by the read and the write on purpose.</b> The roster read and
/// the grant response describe the same thing; two projections would drift, and
/// the drift a farmer would actually see is "the switch says on, the list says
/// off". The effective answer is computed by
/// <see cref="LabourManagementPermission.IsAllowed"/> — the same predicate that
/// gates the five governed actions — so this projection can never disagree with
/// what the server will actually permit.</para>
/// </summary>
internal static class LabourPermissionProjection
{
    public static LabourPermissionDto From(FarmMembership membership, DateTime nowUtc)
    {
        var carriedByRole = LabourManagementPermission.IsCarriedByRole(membership.Role);

        // For a role-carried capability the stored flag is not consulted at all;
        // for everyone else the flag counts ONLY while unexpired — the SAME rule
        // the gate's SQL predicate applies, via the same domain method.
        var hasEffectiveGrant = !carriedByRole && membership.HasEffectiveLabourGrant(nowUtc);

        var source = membership.Role switch
        {
            AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner
                or AgriSync.SharedKernel.Contracts.Roles.AppRole.SecondaryOwner => "OwnerTier",
            _ => hasEffectiveGrant ? "ExplicitGrant" : "NotGranted",
        };

        return new LabourPermissionDto(
            UserId: membership.UserId.Value,
            Role: membership.Role.ToString(),
            Status: membership.Status.ToString(),
            CanManageLabourRecords: LabourManagementPermission.IsAllowed(
                membership.Role, hasEffectiveGrant),
            HasExplicitGrant: hasEffectiveGrant,
            Source: source,
            IsGrantEditable: !carriedByRole,
            LabourGrantExpiresAtUtc: hasEffectiveGrant ? membership.LabourGrantExpiresAtUtc : null);
    }
}
