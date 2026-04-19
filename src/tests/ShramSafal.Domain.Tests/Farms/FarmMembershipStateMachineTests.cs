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
