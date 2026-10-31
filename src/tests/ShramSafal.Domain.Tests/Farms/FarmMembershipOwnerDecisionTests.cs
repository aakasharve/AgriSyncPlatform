// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — extends FarmMembershipStateMachineTests with the
// owner's decisions (approve-as-role / decline / pause / restore / remove / set access), the
// bookkeeping each one writes, and the SEC-2 "stopped by the owner" reading of an ended seat.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class FarmMembershipOwnerDecisionTests
{
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly UserId Person = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly UserId Owner = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly DateTime Now = new(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc);

    private static FarmMembership Request() =>
        FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Person, Now.AddDays(-1));

    private static FarmMembership ActiveSeat(AppRole role = AppRole.Worker)
    {
        var m = Request();
        m.Approve(Owner, role, permissions: null, Now.AddHours(-2));
        return m;
    }

    [Theory]
    [InlineData(AppRole.Worker)]
    [InlineData(AppRole.Mukadam)]
    [InlineData(AppRole.SecondaryOwner)]
    public void Approve_lets_the_person_in_as_the_role_the_OWNER_chose(AppRole role)
    {
        var m = Request();
        Assert.Equal(AppRole.Worker, m.Role); // the placeholder nobody granted

        m.Approve(Owner, role, permissions: null, Now);

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(role, m.Role);
        Assert.Null(m.Permissions);
        Assert.Equal(Owner, m.ApprovedByUserId);
        Assert.Equal(Owner, m.StatusChangedByUserId);
        Assert.Equal(Now, m.StatusChangedAtUtc);
        Assert.Equal(Now, m.AccessChangedAtUtc);
        Assert.Null(m.StatusReason);
    }

    [Fact]
    public void Approve_never_makes_a_primary_owner_and_leaves_the_request_untouched()
    {
        var m = Request();

        Assert.Throws<ArgumentException>(() => m.Approve(Owner, AppRole.PrimaryOwner, null, Now));

        Assert.Equal(MembershipStatus.PendingApproval, m.Status);
        Assert.Equal(AppRole.Worker, m.Role);
        Assert.Null(m.AccessChangedAtUtc);
    }

    [Fact]
    public void Approve_stores_the_owners_permission_choice_and_the_effective_set_follows_it()
    {
        var m = Request();
        var chosen = FarmPermission.ReviewMoney | FarmPermission.PlanWork;

        m.Approve(Owner, AppRole.Mukadam, chosen, Now);

        Assert.Equal(chosen, m.Permissions);
        Assert.Equal(chosen, m.EffectivePermissions);
        Assert.False(m.EffectivePermissions.HasFlag(FarmPermission.SeeMoney), "only what the owner stored");
    }

    [Fact]
    public void A_waiting_or_paused_seat_has_no_effective_permissions_whatever_is_stored()
    {
        var waiting = Request();
        Assert.Equal(FarmPermission.None, waiting.EffectivePermissions);

        // A seat with a stored power (the primary owner's explicit choice, D-22) holds it while
        // Active and nothing once paused.
        var paused = Request();
        paused.Approve(Owner, AppRole.Mukadam, FarmPermission.ReviewMoney, Now.AddHours(-2));
        Assert.Equal(FarmPermission.ReviewMoney, paused.EffectivePermissions);
        paused.Suspend(Owner, "पाऊस", Now);
        Assert.Equal(FarmPermission.None, paused.EffectivePermissions);
    }

    [Fact]
    public void Approve_twice_is_refused_as_a_wrong_status()
    {
        var m = ActiveSeat();
        Assert.Throws<InvalidOperationException>(() => m.Approve(Owner, AppRole.Mukadam, null, Now));
        Assert.Equal(AppRole.Worker, m.Role);
    }

    [Fact]
    public void Decline_ends_the_request_with_the_owners_reason()
    {
        var m = Request();

        m.Decline(Owner, "  ओळख नाही  ", Now);

        Assert.Equal(MembershipStatus.Revoked, m.Status);
        Assert.Equal(Now, m.RevokedAtUtc);
        Assert.Equal("ओळख नाही", m.StatusReason);
        Assert.Equal(Owner, m.StatusChangedByUserId);
        Assert.True(m.EndedAfterOwnerStop);
    }

    [Fact]
    public void Decline_is_only_for_a_waiting_seat()
    {
        var m = ActiveSeat();
        Assert.Throws<InvalidOperationException>(() => m.Decline(Owner, null, Now));
        Assert.Equal(MembershipStatus.Active, m.Status);
    }

    [Fact]
    public void Pause_and_restore_record_who_and_why_and_restore_clears_the_reason()
    {
        var m = ActiveSeat();

        m.Suspend(Owner, "हिशोब तपासायचा आहे", Now);
        Assert.Equal(MembershipStatus.Suspended, m.Status);
        Assert.Equal("हिशोब तपासायचा आहे", m.StatusReason);
        Assert.Equal(Owner, m.StatusChangedByUserId);
        Assert.Equal(Now, m.AccessChangedAtUtc);

        m.Restore(Owner, Now.AddHours(1));
        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Null(m.StatusReason);
        Assert.Equal(Now.AddHours(1), m.AccessChangedAtUtc);
    }

    [Fact]
    public void Restore_of_someone_not_paused_is_refused()
    {
        var m = ActiveSeat();
        Assert.Throws<InvalidOperationException>(() => m.Restore(Owner, Now));
    }

    [Fact]
    public void A_reason_over_500_characters_is_refused_BEFORE_anything_moves()
    {
        var m = ActiveSeat();
        var before = m.AccessChangedAtUtc;

        Assert.Throws<ArgumentException>(() => m.Suspend(Owner, new string('x', 501), Now));

        Assert.Equal(MembershipStatus.Active, m.Status);
        Assert.Equal(before, m.AccessChangedAtUtc);
        Assert.Null(m.StatusReason);
    }

    [Fact]
    public void Remove_ends_an_Active_or_paused_seat_and_counts_as_an_owner_stop()
    {
        var active = ActiveSeat();
        active.Remove(Owner, "काम सोडलं", Now, isLastActivePrimaryOwner: false);
        Assert.Equal(MembershipStatus.Revoked, active.Status);
        Assert.Equal("काम सोडलं", active.StatusReason);
        Assert.True(active.EndedAfterOwnerStop);

        var paused = ActiveSeat();
        paused.Suspend(Owner, null, Now);
        paused.Remove(Owner, null, Now.AddMinutes(1), isLastActivePrimaryOwner: false);
        Assert.Equal(MembershipStatus.Revoked, paused.Status);
    }

    [Fact]
    public void Remove_of_the_last_Active_primary_owner_is_refused_I3()
    {
        var m = FarmMembership.Create(Guid.NewGuid(), Farm, Person, AppRole.PrimaryOwner, Now);

        Assert.Throws<LastPrimaryOwnerRevocationException>(
            () => m.Remove(Owner, null, Now, isLastActivePrimaryOwner: true));
        Assert.Equal(MembershipStatus.Active, m.Status);
    }

    [Fact]
    public void Remove_of_a_waiting_request_is_refused_decline_is_the_word_for_that()
    {
        var m = Request();
        Assert.Throws<InvalidOperationException>(() => m.Remove(Owner, null, Now, false));
        Assert.Equal(MembershipStatus.PendingApproval, m.Status);
    }

    [Fact]
    public void SetAccess_reports_whether_anything_moved_and_bumps_access_only_then()
    {
        var m = ActiveSeat(AppRole.Mukadam);
        var stamped = m.AccessChangedAtUtc;

        Assert.False(m.SetAccess(AppRole.Mukadam, null, Owner, Now), "a re-sent state is not a decision");
        Assert.Equal(stamped, m.AccessChangedAtUtc);

        Assert.True(m.SetAccess(AppRole.Mukadam, FarmPermission.PlanWork, Owner, Now));
        Assert.Equal(FarmPermission.PlanWork, m.EffectivePermissions);
        Assert.Equal(Now, m.AccessChangedAtUtc);

        // Founder D-22: a co-owner label brings no power by itself (only the primary owner holds All).
        Assert.True(m.SetAccess(AppRole.SecondaryOwner, null, Owner, Now.AddMinutes(1)));
        Assert.Equal(FarmPermission.None, m.EffectivePermissions);
    }

    [Fact]
    public void SetAccess_on_a_waiting_request_is_refused_approve_answers_it()
    {
        var m = Request();
        Assert.Throws<InvalidOperationException>(() => m.SetAccess(AppRole.Mukadam, null, Owner, Now));
    }

    [Fact]
    public void A_plain_exit_is_not_an_owner_stop_but_an_exit_from_a_PAUSED_seat_is()
    {
        var left = ActiveSeat();
        left.Exit(Now, isLastActivePrimaryOwner: false);
        Assert.Equal(MembershipStatus.Exited, left.Status);
        Assert.Equal(Person, left.StatusChangedByUserId);
        Assert.False(left.EndedAfterOwnerStop, "he left on his own; the QR may let him back in");

        var pausedThenLeft = ActiveSeat();
        pausedThenLeft.Suspend(Owner, "थांबा", Now);
        pausedThenLeft.Exit(Now.AddMinutes(5), isLastActivePrimaryOwner: false);
        Assert.Equal(MembershipStatus.Exited, pausedThenLeft.Status);
        Assert.Equal(Owner, pausedThenLeft.StatusChangedByUserId);
        Assert.Equal("थांबा", pausedThenLeft.StatusReason);
        Assert.True(pausedThenLeft.EndedAfterOwnerStop,
            "SEC-2: leaving a paused seat must not turn into a fresh Active seat by scanning the QR");

        var restoredThenLeft = ActiveSeat();
        restoredThenLeft.Suspend(Owner, null, Now);
        restoredThenLeft.Restore(Owner, Now.AddMinutes(1));
        restoredThenLeft.Exit(Now.AddMinutes(2), isLastActivePrimaryOwner: false);
        Assert.False(restoredThenLeft.EndedAfterOwnerStop, "the owner let him work again before he left");
    }

    /// <summary>On its own a withdrawn request is the person's act, not the owner's — but it must
    /// never HIDE an earlier owner stop (see the history facts below: SEC-2 bypass).</summary>
    [Fact]
    public void A_withdrawn_request_is_not_itself_an_owner_stop()
    {
        var m = Request();
        m.Exit(Now, isLastActivePrimaryOwner: false);
        Assert.False(m.EndedAfterOwnerStop);
        Assert.False(m.WasLetInByOwner);
    }

    // ── SEC-2 over the person's WHOLE history on the farm ───────────────────────

    /// <summary>The bypass the round-1 verifiers proved on real Postgres: paused → left → his
    /// re-scan made a waiting request → he withdrew it → scan again. The newest ended seat is the
    /// withdrawn request; the owner's stop is still unanswered.</summary>
    [Fact]
    public void A_withdrawn_request_never_hides_the_owners_earlier_stop()
    {
        var paused = ActiveSeat(at: Now.AddDays(-10));
        paused.Suspend(Owner, "थांबा", Now.AddDays(-9));
        paused.Exit(Now.AddDays(-8), isLastActivePrimaryOwner: false);

        var reScan = QrRequest(at: Now.AddDays(-7));
        reScan.Exit(Now.AddDays(-6), isLastActivePrimaryOwner: false); // "विनंती मागे घ्या"

        Assert.True(FarmMembership.HasUnansweredOwnerStop([paused, reScan]));
        // Order of the list does not matter: seats are ordered by when they were made.
        Assert.True(FarmMembership.HasUnansweredOwnerStop([reScan, paused]));
    }

    [Theory]
    [InlineData("removed")]
    [InlineData("declined")]
    public void A_removal_or_decline_stays_a_stop_through_a_withdrawn_typed_code_request(string how)
    {
        FarmMembership stopped;
        if (how == "removed")
        {
            stopped = ActiveSeat(at: Now.AddDays(-10));
            stopped.Remove(Owner, null, Now.AddDays(-9), isLastActivePrimaryOwner: false);
        }
        else
        {
            stopped = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Person, Now.AddDays(-10));
            stopped.Decline(Owner, null, Now.AddDays(-9));
        }

        var typed = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Person, Now.AddDays(-5));
        typed.Exit(Now.AddDays(-4), isLastActivePrimaryOwner: false);

        Assert.True(FarmMembership.HasUnansweredOwnerStop([stopped, typed]));
    }

    [Fact]
    public void Only_the_owners_own_let_in_answers_his_stop_and_a_later_plain_exit_is_then_no_stop()
    {
        var removed = ActiveSeat(at: Now.AddDays(-10));
        removed.Remove(Owner, null, Now.AddDays(-9), isLastActivePrimaryOwner: false);

        var approvedAgain = QrRequest(at: Now.AddDays(-5));
        approvedAgain.Approve(Owner, AppRole.Worker, null, Now.AddDays(-4));
        approvedAgain.Exit(Now.AddDays(-2), isLastActivePrimaryOwner: false); // left on his own

        Assert.True(approvedAgain.WasLetInByOwner);
        Assert.False(FarmMembership.HasUnansweredOwnerStop([removed, approvedAgain]),
            "the owner let him in again after the removal; leaving later on his own is not a stop");

        // …but a NEW stop after that let-in is unanswered again.
        var pausedLater = QrRequest(at: Now.AddDays(-1));
        pausedLater.Approve(Owner, AppRole.Worker, null, Now.AddHours(-20));
        pausedLater.Suspend(Owner, null, Now.AddHours(-10));
        pausedLater.Exit(Now.AddHours(-5), isLastActivePrimaryOwner: false);
        Assert.True(FarmMembership.HasUnansweredOwnerStop([removed, approvedAgain, pausedLater]));
    }

    [Fact]
    public void No_stop_at_all_never_waits_a_newcomer_or_someone_who_only_left_on_his_own()
    {
        Assert.False(FarmMembership.HasUnansweredOwnerStop([]));

        var withdrawn = Request();
        withdrawn.Exit(Now, isLastActivePrimaryOwner: false);
        var left = ActiveSeat(at: Now.AddDays(1));
        left.Exit(Now.AddDays(2), isLastActivePrimaryOwner: false);

        Assert.False(FarmMembership.HasUnansweredOwnerStop([withdrawn, left]));
    }

    [Fact]
    public void Changing_the_labour_grant_is_an_access_change()
    {
        var m = ActiveSeat(AppRole.Mukadam);
        var stamped = m.AccessChangedAtUtc;

        Assert.True(m.SetLabourRecordManagement(true, expiresAtUtc: null, Now.AddHours(3)));
        Assert.Equal(Now.AddHours(3), m.AccessChangedAtUtc);

        Assert.False(m.SetLabourRecordManagement(true, expiresAtUtc: null, Now.AddHours(4)), "a re-send moves nothing");
        Assert.Equal(Now.AddHours(3), m.AccessChangedAtUtc);
        Assert.NotEqual(stamped, m.AccessChangedAtUtc);
    }

    private static FarmMembership ActiveSeat(DateTime at)
    {
        var m = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Person, at);
        m.Approve(Owner, AppRole.Worker, permissions: null, at.AddMinutes(1));
        return m;
    }

    private static FarmMembership QrRequest(DateTime at) =>
        FarmMembership.CreateFromInvitation(Guid.NewGuid(), Farm, Person, AppRole.Worker, JoinedVia.QrScan,
            new FarmInvitationId(Guid.NewGuid()), requireApproval: true, at);
}
