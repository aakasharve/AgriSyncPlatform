using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

/// <summary>
/// State-machine coverage for <see cref="FarmMembership"/>.
/// Maps to plan spec §8.5.1.
/// </summary>
public sealed class FarmMembershipStateMachineTests
{
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly UserId Worker = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly UserId Owner = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId Approver = new(Guid.Parse("33333333-3333-3333-3333-333333333333"));
    private static readonly FarmInvitationId Invitation = new(Guid.Parse("44444444-4444-4444-4444-444444444444"));

    private static readonly DateTime Now = new(2026, 4, 18, 12, 0, 0, DateTimeKind.Utc);

    [Fact(DisplayName = "Legacy Create produces an Active Bootstrap membership")]
    public void Legacy_Create_produces_active_bootstrap()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Owner, AppRole.PrimaryOwner, Now);

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(JoinedVia.PrimaryOwnerBootstrap, m.JoinedVia);
        Assert.True(m.IsActive);
        Assert.False(m.IsRevoked);
    }

    [Fact(DisplayName = "Invitation claim without approval: PendingOtpClaim → Active")]
    public void Claim_without_approval_transitions_to_active()
    {
        var m = FarmMembership.CreateFromInvitation(
            Guid.NewGuid(), Farm, Worker, AppRole.Worker, JoinedVia.QrScan, Invitation, requireApproval: false, Now);

        Assert.Equal(MembershipStatus.PendingOtpClaim, m.Status);

        m.ClaimWithoutApproval(Now.AddMinutes(1));

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(Now.AddMinutes(1), m.LastSeenAtUtc);
    }

    [Fact(DisplayName = "Invitation claim with approval: PendingApproval → Active (via Approve)")]
    public void Claim_with_approval_transitions_through_pending_approval()
    {
        var m = FarmMembership.CreateFromInvitation(
            Guid.NewGuid(), Farm, Worker, AppRole.Worker, JoinedVia.QrScan, Invitation, requireApproval: true, Now);

        Assert.Equal(MembershipStatus.PendingApproval, m.Status);

        m.Approve(Approver, Now.AddMinutes(2));

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(Approver, m.ApprovedByUserId);
    }

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — typing a farm code makes a REQUEST.
    [Fact(DisplayName = "Typed-code join request: PendingApproval, Worker placeholder, no invitation → Active only via Approve")]
    public void Join_request_is_pending_approval_with_a_placeholder_role()
    {
        var m = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Worker, Now);

        Assert.Equal(MembershipStatus.PendingApproval, m.Status);
        Assert.Equal(AppRole.Worker, m.Role);
        Assert.Equal(JoinedVia.SelfJoin, m.JoinedVia);
        Assert.Null(m.InvitationId);
        Assert.False(m.IsActive);
        Assert.Throws<InvalidOperationException>(() => m.ClaimWithoutApproval(Now));

        m.Approve(Approver, Now.AddMinutes(5));

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(Approver, m.ApprovedByUserId);
    }

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the owner's QR answers a typed-code request.
    [Fact(DisplayName = "Owner's QR activates a typed-code request exactly like a fresh QR claim")]
    public void Owner_qr_activates_a_typed_code_request_as_a_fresh_claim_would()
    {
        var m = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Worker, Now);
        Assert.True(m.IsTypedCodeJoinRequest);

        m.ActivateFromOwnerQr(Invitation, Now.AddMinutes(3));

        // The shape ClaimJoin's fresh claim produces: Active Worker, QrScan, that QR's invitation.
        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(AppRole.Worker, m.Role);
        Assert.Equal(JoinedVia.QrScan, m.JoinedVia);
        Assert.Equal(Invitation, m.InvitationId);
        Assert.Equal(Now.AddMinutes(3), m.LastSeenAtUtc);
        Assert.Equal(Now.AddMinutes(3), m.ModifiedAtUtc);
        Assert.Null(m.ApprovedByUserId);
        Assert.False(m.IsTypedCodeJoinRequest);
    }

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 2, verifier SEC-MU2-1) — a grant left on the
    // waiting request does not ride into the seat the owner's QR makes (a fresh claim has none).
    [Fact(DisplayName = "Owner's QR activation carries no grant left on the waiting request")]
    public void Owner_qr_activation_carries_no_grant_left_on_the_waiting_request()
    {
        var m = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Worker, Now);
        m.SetLabourRecordManagement(true, Now.AddDays(3), Now);
        Assert.True(m.CanManageLabourRecords);

        m.ActivateFromOwnerQr(Invitation, Now.AddMinutes(3));

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.False(m.CanManageLabourRecords);
        Assert.Null(m.LabourGrantExpiresAtUtc);
        Assert.Null(m.Permissions);
        Assert.Equal(FarmPermission.None, m.EffectivePermissions);
    }

    [Fact(DisplayName = "Owner's QR does not approve a PendingApproval seat that did not come from a typed code")]
    public void Owner_qr_does_not_approve_an_invitation_request_that_carries_a_chosen_role()
    {
        var m = FarmMembership.CreateFromInvitation(
            Guid.NewGuid(), Farm, Worker, AppRole.Mukadam, JoinedVia.QrScan, Invitation, requireApproval: true, Now);

        Assert.False(m.IsTypedCodeJoinRequest);
        Assert.Throws<InvalidOperationException>(() => m.ActivateFromOwnerQr(Invitation, Now));
        Assert.Equal(MembershipStatus.PendingApproval, m.Status);
        Assert.Equal(AppRole.Mukadam, m.Role);
    }

    [Fact(DisplayName = "Owner's QR does not lift a pause or touch an Active seat")]
    public void Owner_qr_does_not_lift_a_pause_or_touch_an_active_seat()
    {
        var active = FarmMembership.Create(Guid.NewGuid(), Farm, Worker, AppRole.Mukadam, Now);
        Assert.Throws<InvalidOperationException>(() => active.ActivateFromOwnerQr(Invitation, Now));
        Assert.Equal(AppRole.Mukadam, active.Role);

        var paused = FarmMembership.Create(Guid.NewGuid(), Farm, Worker, AppRole.Worker, Now);
        paused.Suspend(Now);
        Assert.Throws<InvalidOperationException>(() => paused.ActivateFromOwnerQr(Invitation, Now));
        Assert.Equal(MembershipStatus.Suspended, paused.Status);
    }

    [Fact(DisplayName = "Owner's QR activation needs the QR's invitation id")]
    public void Owner_qr_activation_needs_an_invitation_id()
    {
        var m = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Worker, Now);

        Assert.Throws<ArgumentException>(() => m.ActivateFromOwnerQr(new FarmInvitationId(Guid.Empty), Now));
        Assert.Equal(MembershipStatus.PendingApproval, m.Status);
    }

    [Fact(DisplayName = "ClaimWithoutApproval from non-PendingOtpClaim throws")]
    public void Claim_from_wrong_status_throws()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Worker, AppRole.Worker, Now);

        Assert.Throws<InvalidOperationException>(() => m.ClaimWithoutApproval(Now));
    }

    [Fact(DisplayName = "Revoking the last active PrimaryOwner throws (invariant I3)")]
    public void Revoking_last_primary_owner_throws()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Owner, AppRole.PrimaryOwner, Now);

        var ex = Assert.Throws<LastPrimaryOwnerRevocationException>(
            () => m.Revoke(Now, isLastActivePrimaryOwner: true));

        Assert.Equal(Farm, ex.FarmId);
    }

    [Fact(DisplayName = "Revoke is idempotent once terminal")]
    public void Revoke_is_idempotent_on_terminal()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Worker, AppRole.Worker, Now);
        m.Revoke(Now, isLastActivePrimaryOwner: false);

        // Second revoke is a no-op.
        m.Revoke(Now.AddMinutes(1), isLastActivePrimaryOwner: false);

        Assert.Equal(MembershipStatus.Revoked, m.Status);
    }

    [Fact(DisplayName = "Suspend/Restore round-trip preserves Active")]
    public void Suspend_restore_round_trip()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Worker, AppRole.Worker, Now);

        m.Suspend(Now.AddMinutes(1));
        Assert.Equal(MembershipStatus.Suspended, m.Status);

        m.Restore(Now.AddMinutes(2));
        Assert.Equal(MembershipStatus.Active, m.Status);
    }

    [Fact(DisplayName = "Cannot restore from a non-Suspended state")]
    public void Cannot_restore_from_non_suspended()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Worker, AppRole.Worker, Now);

        Assert.Throws<InvalidOperationException>(() => m.Restore(Now));
    }
}
