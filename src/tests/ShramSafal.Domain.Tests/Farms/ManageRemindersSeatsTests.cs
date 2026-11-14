// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1b (founder B9, reversing the REM-1 m2 ruling): "आठवणींची मांडणी बदलणे" (ManageReminders) may be held by
// a मुकादम or a सहमालक / कुटुंब seat of ANY plot scope (every plot, chosen plots, स्वतःचं काम). The कामगार LABEL can still never hold it: every grant door
// refuses it (never trims it), every read drops it (fail closed), the card lists it as not in force, and the settings door never passes a Worker seat even when a
// stale grant is stored. Mirrors CMP-D1's SeeCompare tests; the plot scope is in the question only to prove it no longer changes the answer.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class ManageRemindersSeatsTests
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

    /// <summary>Every seat that may hold it: a मुकादम or a सहमालक / कुटुंब, on every plot scope (one clear row per scope).</summary>
    public static TheoryData<AppRole, MembershipPlotScope> HoldingSeats => new()
    {
        { AppRole.Mukadam, MembershipPlotScope.AllPlots },
        { AppRole.Mukadam, MembershipPlotScope.ChosenPlots },
        { AppRole.Mukadam, MembershipPlotScope.OwnWork },
        { AppRole.SecondaryOwner, MembershipPlotScope.AllPlots },
        { AppRole.SecondaryOwner, MembershipPlotScope.ChosenPlots },
        { AppRole.SecondaryOwner, MembershipPlotScope.OwnWork },
    };

    /// <summary>The कामगार label, on every plot scope: never.</summary>
    public static TheoryData<MembershipPlotScope> WorkerScopes => new()
    {
        MembershipPlotScope.AllPlots,
        MembershipPlotScope.ChosenPlots,
        MembershipPlotScope.OwnWork,
    };

    // ── the one rule ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(HoldingSeats))]
    public void A_mukadam_or_co_owner_seat_of_any_plot_scope_can_hold_it(AppRole role, MembershipPlotScope scope)
    {
        FarmAuthorities.CanBeHeldBy(role, FarmAuthority.ManageReminders, scope).Should().BeTrue();
        FarmAuthorities.NotInForce(role, scope).Should().NotContain(FarmAuthority.ManageReminders, "the card offers the switch");
    }

    [Theory]
    [MemberData(nameof(WorkerScopes))]
    public void The_worker_label_can_never_hold_it_on_any_plot_scope(MembershipPlotScope scope)
    {
        FarmAuthorities.CanBeHeldBy(AppRole.Worker, FarmAuthority.ManageReminders, scope).Should().BeFalse();
        FarmAuthorities.CanBeHeldBy(AppRole.Worker, FarmAuthority.ManageReminders).Should().BeFalse("the two-argument form says the same");
        FarmAuthorities.NotInForce(AppRole.Worker, scope).Should().Contain(FarmAuthority.ManageReminders, "the card says so and offers no switch");
    }

    [Fact]
    public void The_primary_owner_always_holds_it_by_label()
    {
        FarmAuthorities.CanBeHeldBy(AppRole.PrimaryOwner, FarmAuthority.ManageReminders, MembershipPlotScope.OwnWork).Should().BeTrue("by label");
        FarmAuthorities.NotInForce(AppRole.PrimaryOwner, MembershipPlotScope.OwnWork).Should().BeEmpty();
    }

    [Fact]
    public void The_other_authorities_are_asked_nothing_new()
    {
        foreach (var authority in FarmAuthorities.All.Where(a => a is not (FarmAuthority.ManageReminders or FarmAuthority.SeeCompare or FarmAuthority.EditFarmSetup)))
        {
            FarmAuthorities.CanBeHeldBy(AppRole.Mukadam, authority, MembershipPlotScope.ChosenPlots).Should().BeTrue($"{authority} is unchanged");
        }
    }

    // ── every grant door: refused for a Worker (writes nothing), given to a mukadam / co-owner of any scope ──────────────

    [Theory]
    [MemberData(nameof(WorkerScopes))]
    public void Door_the_whole_set_refuses_it_for_a_worker_and_writes_nothing(MembershipPlotScope scope)
    {
        var seat = Seat(AppRole.Worker, scope);
        var act = () => seat.SetAuthorities(Give(), Now);

        act.Should().Throw<ArgumentException>("refused, never trimmed");
        seat.StoresAuthority(FarmAuthority.ManageReminders).Should().BeFalse();
        seat.Permissions.Should().BeNull();
    }

    [Theory]
    [MemberData(nameof(HoldingSeats))]
    public void Door_the_whole_set_gives_it_to_a_mukadam_or_co_owner_of_any_scope(AppRole role, MembershipPlotScope scope)
    {
        var seat = Seat(role, scope);
        seat.SetAuthorities(Give(), Now).Should().BeTrue();
        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(1)).Should().BeTrue("honoured on read");
        seat.HoldsIgnoringStatus(FarmAuthority.ManageReminders, Now.AddMinutes(1)).Should().BeTrue("honoured on the projection read");
        seat.EffectivePermissions.HasFlag(FarmPermission.ManageReminders).Should().BeTrue("honoured in the effective set");
    }

    [Fact]
    public void Door_an_approval_refuses_it_for_a_worker_and_gives_it_to_a_co_owner()
    {
        var waiting = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), Now.AddDays(-1));
        var act = () => waiting.Approve(Owner, AppRole.Worker, Bit, Now);
        act.Should().Throw<ArgumentException>();
        waiting.Status.Should().Be(MembershipStatus.PendingApproval, "the refusal wrote nothing");

        var coOwner = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), Now.AddDays(-1));
        coOwner.Approve(Owner, AppRole.SecondaryOwner, Bit, Now);
        coOwner.Holds(FarmAuthority.ManageReminders, Now).Should().BeTrue();
    }

    [Theory]
    [MemberData(nameof(WorkerScopes))]
    public void Door_an_access_change_refuses_it_for_a_worker(MembershipPlotScope scope)
    {
        var seat = Seat(AppRole.Mukadam, scope);
        var act = () => seat.SetAccess(AppRole.Worker, Bit, Owner, Now);

        act.Should().Throw<ArgumentException>();
        seat.Permissions.Should().BeNull("nothing was written");
    }

    [Theory]
    [MemberData(nameof(HoldingSeats))]
    public void Door_an_access_change_gives_it_to_a_mukadam_or_co_owner_of_any_scope(AppRole role, MembershipPlotScope scope)
    {
        var seat = Seat(role, scope);
        seat.SetAccess(role, Bit, Owner, Now).Should().BeTrue();
        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(1)).Should().BeTrue();
    }

    [Fact]
    public void Door_a_personal_invitation_refuses_it_for_a_worker_and_carries_it_for_a_mukadam_or_co_owner_of_any_scope()
    {
        PersonalInvitation Make(RelationshipLabel label, MembershipPlotScope scope) =>
            PersonalInvitation.Create(
                Guid.NewGuid(), Farm, "पाटील फार्म", Owner, label, "रमेश", "+916000012345", null, scope,
                scope == MembershipPlotScope.ChosenPlots ? [Guid.NewGuid()] : [],
                scope == MembershipPlotScope.ChosenPlots ? ["प्लॉट 1"] : [],
                new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.ManageReminders] = null },
                "48217731", Now);

        foreach (var scope in new[] { MembershipPlotScope.AllPlots, MembershipPlotScope.ChosenPlots, MembershipPlotScope.OwnWork })
        {
            var worker = () => Make(RelationshipLabel.Worker, scope);
            worker.Should().Throw<ArgumentException>($"a Worker label on {scope}");
            Make(RelationshipLabel.Mukadam, scope).Should().NotBeNull($"a मुकादम on {scope}");
            Make(RelationshipLabel.CoOwner, scope).Should().NotBeNull($"a सहमालक on {scope}");
        }
    }

    // ── every read: a stored Worker grant is dropped; a mukadam / co-owner grant is honoured whatever the scope ─────────

    [Theory]
    [MemberData(nameof(HoldingSeats))]
    public void Read_a_grant_survives_a_change_of_plot_scope_for_a_mukadam_or_co_owner(AppRole role, MembershipPlotScope scope)
    {
        var seat = Seat(role);
        seat.SetAuthorities(Give(), Now);
        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(1)).Should().BeTrue("control: held while he sees every plot");

        seat.SetPlotScope(scope, scope == MembershipPlotScope.ChosenPlots ? [Plot] : null, Now.AddMinutes(2));

        seat.Holds(FarmAuthority.ManageReminders, Now.AddMinutes(3)).Should().BeTrue("the seat read");
        seat.HoldsIgnoringStatus(FarmAuthority.ManageReminders, Now.AddMinutes(3)).Should().BeTrue("the projection read");
        seat.EffectivePermissions.HasFlag(FarmPermission.ManageReminders).Should().BeTrue("the effective set");
        FarmAuthorities.IsHeld(
            role, Bit, labourGrant: false, labourGrantExpiresAtUtc: null, expiriesJson: null, FarmAuthority.ManageReminders,
            Now, scope).Should().BeTrue("the one rule");
        FarmPermissionDefaults.Effective(role, Bit | FarmPermission.PlanWork, scope)
            .Should().Be(Bit | FarmPermission.PlanWork, "the bit is kept");
    }

    [Theory]
    [MemberData(nameof(WorkerScopes))]
    public void Read_a_stored_worker_grant_holds_nothing_on_every_read(MembershipPlotScope scope)
    {
        FarmAuthorities.IsHeld(
            AppRole.Worker, Bit, labourGrant: false, labourGrantExpiresAtUtc: null, expiriesJson: null, FarmAuthority.ManageReminders,
            Now, scope).Should().BeFalse("the one rule");
        FarmAuthorities.IsHeld(
            AppRole.Worker, Bit, false, null, null, FarmAuthority.ManageReminders, Now)
            .Should().BeFalse("no scope given: still a Worker");
        FarmPermissionDefaults.Effective(AppRole.Worker, Bit | FarmPermission.PlanWork, scope)
            .Should().Be(FarmPermission.PlanWork, "the bit is dropped like an unknown bit");
    }

    [Fact]
    public void Read_a_caller_that_cannot_say_the_plot_scope_gets_the_same_answer()
    {
        FarmAuthorities.IsHeld(
            AppRole.SecondaryOwner, Bit, labourGrant: false, labourGrantExpiresAtUtc: null, expiriesJson: null, FarmAuthority.ManageReminders, Now)
            .Should().BeTrue("the plot scope does not change the answer for a co-owner");
    }

    [Fact]
    public void Read_the_application_policy_passes_a_mukadam_or_co_owner_of_any_scope_and_never_a_worker_even_with_a_stale_grant()
    {
        FarmAccess Access(AppRole role, MembershipPlotScope scope, bool registrant = false) =>
            new(role, MembershipStatus.Active, registrant, Bit, PlotScope: scope);

        foreach (var scope in new[] { MembershipPlotScope.AllPlots, MembershipPlotScope.ChosenPlots, MembershipPlotScope.OwnWork })
        {
            FarmAccessPolicy.Holds(Access(AppRole.SecondaryOwner, scope), FarmAuthority.ManageReminders, Now).Should().BeTrue($"co-owner on {scope}");
            FarmAccessPolicy.Holds(Access(AppRole.Mukadam, scope), FarmAuthority.ManageReminders, Now).Should().BeTrue($"mukadam on {scope}");
            FarmAccessPolicy.EffectiveBits(Access(AppRole.SecondaryOwner, scope), Now)
                .HasFlag(FarmPermission.ManageReminders).Should().BeTrue($"the effective bits on {scope}");
            FarmAccessPolicy.Holds(Access(AppRole.Worker, scope), FarmAuthority.ManageReminders, Now).Should().BeFalse($"a Worker on {scope}");
            FarmAccessPolicy.EffectiveBits(Access(AppRole.Worker, scope), Now)
                .HasFlag(FarmPermission.ManageReminders).Should().BeFalse($"a Worker's effective bits on {scope}");
        }

        FarmAccessPolicy.Holds(Access(AppRole.PrimaryOwner, MembershipPlotScope.AllPlots, registrant: true), FarmAuthority.ManageReminders, Now)
            .Should().BeTrue("the primary account holder passes by label");
    }
}
