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
    /// <param name="isRegistrant">spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — this member
    /// registered the farm; only the caller knows (it reads the farm row).</param>
    /// <param name="phoneLast4">spec: plr-d7-m1-multiuser-2026-10-26 (step 2, M-7) — the last four
    /// digits of the member's phone, passed only by the owner-tier roster and the owner's decision
    /// answer (never the grant-write response).</param>
    public static LabourPermissionDto From(
        FarmMembership membership, DateTime nowUtc, string? displayName = null, bool isRegistrant = false,
        string? phoneLast4 = null)
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
            LabourGrantExpiresAtUtc: hasEffectiveGrant ? membership.LabourGrantExpiresAtUtc : null,
            DisplayName: displayName,
            // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the SAME effective rule the gates
            // use (FarmMembership.EffectivePermissions → FarmPermissionDefaults.Effective), so the
            // card cannot claim a power the server refuses. The registrant holds every power.
            Permissions: FarmPermissionDefaults.Names(
                isRegistrant && membership.Status == MembershipStatus.Active
                    ? FarmPermissionDefaults.All
                    : membership.EffectivePermissions),
            StatusReason: membership.StatusReason,
            IsRegistrant: isRegistrant,
            JoinedVia: membership.JoinedVia.ToString(),
            RequestedAtUtc: membership.GrantedAtUtc,
            PhoneLast4: string.IsNullOrWhiteSpace(phoneLast4) ? null : phoneLast4,
            ApprovedByOwner: membership.ApprovedByUserId is not null);
    }
}
