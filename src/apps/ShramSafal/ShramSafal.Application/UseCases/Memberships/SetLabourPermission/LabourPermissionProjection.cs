using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Memberships.SetLabourPermission;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — the ONE place a <see cref="FarmMembership"/> becomes
/// a <see cref="LabourPermissionDto"/>.
///
/// <para><b>Shared by the read and the write on purpose.</b> The roster read and
/// the grant response describe the same thing; two projections would drift, and
/// the drift a farmer would actually see is "the switch says on, the list says
/// off". Every answer here is computed by the same domain rule the gates use
/// (<see cref="FarmAuthorities.IsHeld"/> through <see cref="FarmMembership"/>), so this
/// projection can never disagree with what the server will actually permit.</para>
///
/// <para><b>lane 2b (founder D-22 / D-26).</b> Only the PRIMARY owner carries anything by
/// label. A सहमालक / कुटुंब row now reads like any other: its हजेरी switch is real
/// (<c>IsGrantEditable</c> true) and its authorities are listed one by one with their ends.</para>
/// </summary>
internal static class LabourPermissionProjection
{
    /// <param name="isRegistrant">spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — this member
    /// registered the farm; only the caller knows (it reads the farm row).</param>
    /// <param name="phoneLast4">spec: plr-d7-m1-multiuser-2026-10-26 (step 2, M-7) — the last four
    /// digits of the member's phone, passed only by the owner's roster and the owner's decision
    /// answer (never the grant-write response).</param>
    /// <param name="callerMayGrant">spec: plr-d10 (I27), lane 2b — the caller is the primary
    /// account holder, the only person who may move a switch (founder D-26, D-44 §2).</param>
    public static LabourPermissionDto From(
        FarmMembership membership, DateTime nowUtc, string? displayName = null, bool isRegistrant = false,
        string? phoneLast4 = null, bool callerMayGrant = false)
    {
        var isPrimary = isRegistrant || membership.Role == AppRole.PrimaryOwner;
        var carriedByRole = LabourManagementPermission.IsCarriedByRole(membership.Role);

        // The stored, unexpired grant — the SAME rule the gate's SQL predicate applies, via the
        // same domain method. Read for everyone but the primary owner (whose label carries it).
        var hasEffectiveGrant = !LabourManagementPermission.IsRedundantGrantTarget(membership.Role)
            && membership.HasEffectiveLabourGrant(nowUtc);

        // lane 2b — what this person holds, whatever the seat's status (a paused card still shows
        // what returns on restore; the status is shown beside it). The primary owner holds all.
        var held = FarmAuthorities.All
            .Where(a => isPrimary || membership.HoldsIgnoringStatus(a, nowUtc))
            .Select(a => new AuthorityGrantDto(
                FarmAuthorities.NameOf(a),
                isPrimary ? null : membership.ExpiryOf(a)))
            .ToList();
        var heldBits = FarmPermission.None;
        foreach (var authority in FarmAuthorities.All)
        {
            if (isPrimary || membership.HoldsIgnoringStatus(authority, nowUtc))
            {
                heldBits |= FarmAuthorities.BitOf(authority);
            }
        }

        var confirms = isPrimary || membership.HoldsIgnoringStatus(FarmAuthority.ConfirmRecords, nowUtc);
        var letIn = membership.Status is MembershipStatus.Active or MembershipStatus.Suspended;

        return new LabourPermissionDto(
            UserId: membership.UserId.Value,
            Role: membership.Role.ToString(),
            Status: membership.Status.ToString(),
            CanManageLabourRecords: LabourManagementPermission.IsAllowed(
                membership.Role, hasEffectiveGrant),
            HasExplicitGrant: hasEffectiveGrant,
            Source: carriedByRole ? "OwnerTier" : hasEffectiveGrant ? "ExplicitGrant" : "NotGranted",
            // lane 2b: true for every row but the primary owner's — a सहमालक's हजेरी is a real switch
            // now. An installed phone (1.0.15–1.0.17) draws its one "हजेरी व पक्कं" switch from this,
            // and the legacy PUT it sends keeps meaning both (FarmMembership.SetLegacyLabourSwitch).
            IsGrantEditable: !carriedByRole,
            LabourGrantExpiresAtUtc: hasEffectiveGrant ? membership.LabourGrantExpiresAtUtc : null,
            DisplayName: displayName,
            // spec: plr-d7-m1-multiuser-2026-10-26 (step 2), lane 2b — the stored bits held now
            // (ends and "needs see money" applied), names only; the registrant holds every one.
            Permissions: FarmPermissionDefaults.Names(
                membership.Status == MembershipStatus.Active || isPrimary ? heldBits : FarmPermission.None),
            StatusReason: membership.StatusReason,
            IsRegistrant: isRegistrant,
            JoinedVia: membership.JoinedVia.ToString(),
            RequestedAtUtc: membership.GrantedAtUtc,
            PhoneLast4: string.IsNullOrWhiteSpace(phoneLast4) ? null : phoneLast4,
            ApprovedByOwner: membership.ApprovedByUserId is not null,
            CanConfirmRecords: OwnerConfirmationAuthority.MayConfirm(membership.Role, confirms),
            IsConfirmGrantEditable: false,
            Authorities: held,
            CanEditAuthorities: callerMayGrant && !isPrimary && letIn,
            // spec: plr-d10 lane MU-4 — the plots he covers (the primary owner covers every plot by label).
            PlotScope: isPrimary ? nameof(MembershipPlotScope.AllPlots) : membership.PlotScope.ToString(),
            PlotIds: !isPrimary && membership.PlotScope == MembershipPlotScope.ChosenPlots
                ? membership.ScopePlotIds.Order().ToList()
                : null);
    }
}
