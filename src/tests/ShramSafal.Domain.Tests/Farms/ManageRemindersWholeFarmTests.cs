// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1, CTO ruling on review m2: "आठवणींची मांडणी बदलणे" (ManageReminders) may be held ONLY by a
// whole-farm seat. A person who sees only part of the farm (a Worker label, a seat on स्वतःचं काम, a chosen-plots seat) can never hold it: every grant
// door refuses it (never trims it), every read drops it (fail closed), the card lists it as not in force, and the settings door never passes such a seat
// even when a stale grant is stored. Mirrors CMP-D1's SeeCompare tests, with the plot scope in the question.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class ManageRemindersWholeFarmTests
{
    private static readonly DateTime Now = new(2026, 11, 13, 6, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("c3d20001-0000-0000-0000-000000000001"));
    private static readonly UserId Owner = new(Guid.Parse("c3d20001-0000-0000-0000-0000000000a1"));
    private static readonly FarmPermission Bit = FarmPermission.ManageReminders;
    private static readonly Guid Plot = Guid.Parse("c3d20001-0000-0000-0000-0000000000b1");

    private static FarmMembership Seat(AppRole role, MembershipPlotScope scope = MembershipPlotScope.AllPlots)
    {
        var seat = FarmMembership.Create(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), role, Now.AddDays(-30));
        if (scope != MembershipPlotScope.AllPlots)
        {
            seat.SetPlotScope(scope, scope == MembershipPlotScope.ChosenPlots ? [Plot] : null, Now.AddDays(-29));
        }

        return seat;
    }

    private static Dictionary<FarmAuthority, DateTime?> Give() => new() { [FarmAuthority.ManageReminders] = null };

    public static TheoryData<AppRole, MembershipPlotScope> PartFarmSeats => new()
    {
        { AppRole.Worker, MembershipPlotScope.AllPlots },
        { AppRole.Worker, MembershipPlotScope.OwnWork },
        { AppRole.Worker, MembershipPlotScope.ChosenPlots },
        { AppRole.Mukadam, MembershipPlotScope.OwnWork },
        { AppRole.Mukadam, MembershipPlotScope.ChosenPlots },
        { AppRole.SecondaryOwner, MembershipPlotScope.OwnWork },
        { AppRole.SecondaryOwner, MembershipPlotScope.ChosenPlots },
    };

    public static TheoryData<AppRole> WholeFarmLabels => new() { AppRole.Mukadam, AppRole.SecondaryOwner };

    // ── the one rule ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(PartFarmSeats))]
    public void A_seat_that_sees_only_part_of_the_farm_can_never_hold_it(AppRole role, MembershipPlotScope scope)
    {
        FarmAuthorities.CanBeHeldBy(role, FarmAuthority.ManageReminders, scope).Should().BeFalse();
        FarmAuthorities.NotInForce(role, scope).Should().Contain(FarmAuthority.ManageReminders, "the card says so and offers no switch");
    }

    [Theory]
    [MemberData(nameof(WholeFarmLabels))]
    public void A_whole_farm_seat_can_hold_it_and_the_primary_owner_always_does(AppRole role)
    {
        FarmAuthorities.CanBeHeldBy(role, FarmAuthority.ManageReminders, MembershipPlotScope.AllPlots).Should().BeTrue();
        FarmAuthorities.NotInForce(role, MembershipPlotScope.AllPlots).Should().NotContain(FarmAuthority.ManageReminders);
        FarmAuthorities.CanBeHeldBy(AppRole.PrimaryOwner, FarmAuthority.ManageReminders, MembershipPlotScope.OwnWork).Should().BeTrue("by label");
        FarmAuthorities.NotInForce(AppRole.PrimaryOwner, MembershipPlotScope.OwnWork).Should().BeEmpty();
    }

    [Fact]
    public void The_other_authorities_are_asked_nothing_new_about_the_plot_scope()
    {
        foreach (var authority in FarmAuthorities.All.Where(a => a is not (FarmAuthority.ManageReminders or FarmAuthority.SeeCompare or FarmAuthority.EditFarmSetup)))
        {
            FarmAuthorities.CanBeHeldBy(AppRole.Mukadam, authority, MembershipPlotScope.ChosenPlots).Should().BeTrue($"{authority} is unchanged");
        }
    }

    // ── every grant door refuses it, writes nothing ──────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(PartFarmSeats))]
    public void Door_the_whole_set_refuses_it_and_writes_nothing(AppRole role, MembershipPlotScope scope)
    {
        var seat = Seat(role, scope);
        var act = () => seat.SetAuthorities(Give(), Now);

        act.Should().Throw<ArgumentException>("refused, never trimmed");
        seat.StoresAuthority(FarmAuthority.ManageReminders).Should().BeFalse();
        seat.Permissions.Should().BeNull();
    }

    [Fact]
    public void Door_the_whole_set_gives_it_to_a_whole_farm_seat()
    {
        var seat = Seat(AppRole.SecondaryOwner);
        seat.SetAuthorities(Give(), Now).Should().BeTrue();
        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(1)).Should().BeTrue();
    }

    [Fact]
    public void Door_an_approval_refuses_it_for_a_worker_and_gives_it_to_a_whole_farm_seat()
    {
        var waiting = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), Now.AddDays(-1));
        var act = () => waiting.Approve(Owner, AppRole.Worker, Bit, Now);
        act.Should().Throw<ArgumentException>();
        waiting.Status.Should().Be(MembershipStatus.PendingApproval, "the refusal wrote nothing");

        var coOwner = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), Now.AddDays(-1));
        coOwner.Approve(Owner, AppRole.SecondaryOwner, Bit, Now);
        coOwner.Holds(FarmAuthority.ManageReminders, Now).Should().BeTrue("control: the same bit on a whole-farm seat");
    }

    [Theory]
    [InlineData(AppRole.Worker, MembershipPlotScope.AllPlots)]
    [InlineData(AppRole.Mukadam, MembershipPlotScope.ChosenPlots)]
    [InlineData(AppRole.Mukadam, MembershipPlotScope.OwnWork)]
    public void Door_an_access_change_refuses_it(AppRole role, MembershipPlotScope scope)
    {
        var seat = Seat(AppRole.Mukadam, scope);
        var act = () => seat.SetAccess(role, Bit, Owner, Now);

        act.Should().Throw<ArgumentException>();
        seat.Permissions.Should().BeNull("nothing was written");
        Seat(AppRole.Mukadam).SetAccess(AppRole.Mukadam, Bit, Owner, Now).Should().BeTrue("control: a whole-farm seat takes it");
    }

    [Fact]
    public void Door_a_personal_invitation_refuses_it_for_part_of_the_farm_and_carries_it_for_the_whole_farm()
    {
        PersonalInvitation Make(RelationshipLabel label, MembershipPlotScope scope) =>
            PersonalInvitation.Create(
                Guid.NewGuid(), Farm, "पाटील फार्म", Owner, label, "रमेश", "+916000012345", null, scope,
                scope == MembershipPlotScope.ChosenPlots ? [Guid.NewGuid()] : [],
                scope == MembershipPlotScope.ChosenPlots ? ["प्लॉट 1"] : [],
                new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.ManageReminders] = null },
                "48217731", Now);

        var worker = () => Make(RelationshipLabel.Worker, MembershipPlotScope.OwnWork);
        worker.Should().Throw<ArgumentException>();
        var chosen = () => Make(RelationshipLabel.Mukadam, MembershipPlotScope.ChosenPlots);
        chosen.Should().Throw<ArgumentException>();
        var ownWork = () => Make(RelationshipLabel.Mukadam, MembershipPlotScope.OwnWork);
        ownWork.Should().Throw<ArgumentException>();
        Make(RelationshipLabel.Mukadam, MembershipPlotScope.AllPlots).Should().NotBeNull();
        Make(RelationshipLabel.CoOwner, MembershipPlotScope.AllPlots).Should().NotBeNull();
    }

    // ── every read drops a stale grant (a row an older build or a hand left behind, or a seat narrowed after the grant) ─

    [Fact]
    public void Read_a_grant_stored_before_the_seat_was_narrowed_holds_nothing_on_every_read()
    {
        var seat = Seat(AppRole.SecondaryOwner);
        seat.SetAuthorities(Give(), Now);
        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(1)).Should().BeTrue("control: held while he sees the whole farm");

        seat.SetPlotScope(MembershipPlotScope.ChosenPlots, [Plot], Now.AddMinutes(2));

        seat.StoresAuthority(FarmAuthority.ManageReminders).Should().BeTrue("stored data is untouched: no migration");
        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(3)).Should().BeFalse("the seat read");
        seat.HoldsIgnoringStatus(FarmAuthority.ManageReminders, Now.AddMinutes(3)).Should().BeFalse("the projection read");
        seat.EffectivePermissions.HasFlag(FarmPermission.ManageReminders).Should().BeFalse("the effective set");
        FarmAuthorities.IsHeld(
            AppRole.SecondaryOwner, Bit, labourGrant: false, labourGrantExpiresAtUtc: null, expiriesJson: null, FarmAuthority.ManageReminders,
            Now, MembershipPlotScope.ChosenPlots).Should().BeFalse("the one rule");
        FarmPermissionDefaults.Effective(AppRole.Mukadam, Bit | FarmPermission.PlanWork, MembershipPlotScope.OwnWork)
            .Should().Be(FarmPermission.PlanWork, "the bit is dropped like an unknown bit");
        FarmPermissionDefaults.Effective(AppRole.Mukadam, Bit, MembershipPlotScope.AllPlots).Should().Be(Bit, "control");
    }

    [Fact]
    public void Read_a_caller_that_cannot_say_the_plot_scope_is_answered_closed()
    {
        FarmAuthorities.IsHeld(
            AppRole.SecondaryOwner, Bit, labourGrant: false, labourGrantExpiresAtUtc: null, expiriesJson: null, FarmAuthority.ManageReminders, Now)
            .Should().BeFalse("no scope given: fail closed");
        FarmAuthorities.IsHeld(
            AppRole.SecondaryOwner, Bit, false, null, null, FarmAuthority.ManageReminders, Now, MembershipPlotScope.AllPlots)
            .Should().BeTrue("control: a whole-farm seat");
    }

    [Fact]
    public void Read_the_application_policy_never_passes_a_part_farm_seat_even_with_a_stale_grant()
    {
        FarmAccess Access(AppRole role, MembershipPlotScope scope, bool registrant = false) =>
            new(role, MembershipStatus.Active, registrant, Bit, PlotScope: scope);

        FarmAccessPolicy.Holds(Access(AppRole.SecondaryOwner, MembershipPlotScope.AllPlots), FarmAuthority.ManageReminders, Now).Should().BeTrue("control");
        FarmAccessPolicy.Holds(Access(AppRole.SecondaryOwner, MembershipPlotScope.ChosenPlots), FarmAuthority.ManageReminders, Now).Should().BeFalse();
        FarmAccessPolicy.Holds(Access(AppRole.Mukadam, MembershipPlotScope.OwnWork), FarmAuthority.ManageReminders, Now).Should().BeFalse();
        FarmAccessPolicy.Holds(Access(AppRole.Worker, MembershipPlotScope.AllPlots), FarmAuthority.ManageReminders, Now).Should().BeFalse();
        FarmAccessPolicy.EffectiveBits(Access(AppRole.SecondaryOwner, MembershipPlotScope.ChosenPlots), Now)
            .HasFlag(FarmPermission.ManageReminders).Should().BeFalse();
        FarmAccessPolicy.Holds(Access(AppRole.PrimaryOwner, MembershipPlotScope.AllPlots, registrant: true), FarmAuthority.ManageReminders, Now)
            .Should().BeTrue("the primary account holder passes by label");
    }
}
