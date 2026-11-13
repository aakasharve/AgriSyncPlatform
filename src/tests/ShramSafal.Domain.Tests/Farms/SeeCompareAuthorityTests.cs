// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 (founder D-81): "तुलना पाहणे" is an authority like the others.
// It is OFF for a co-owner / seat until the primary owner gives it, the primary owner always has it, and a Worker seat can never
// hold it. Bit 12 is the next free bit after SeeAllTasks (1 << 11); no stored bit moves (R19). The compare READ that requires it
// is lane CMP-D2 - nothing here builds it.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class SeeCompareAuthorityTests
{
    private static readonly DateTime Now = new(2026, 11, 10, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Friday = Now.AddDays(4);
    private static readonly FarmId Farm = new(Guid.Parse("c3d10001-0000-0000-0000-000000000001"));
    private static readonly UserId Owner = new(Guid.Parse("c3d10001-0000-0000-0000-0000000000a1"));

    private static FarmMembership Seat(AppRole role) =>
        FarmMembership.Create(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), role, Now.AddDays(-30));

    private static Dictionary<FarmAuthority, DateTime?> Set(params (FarmAuthority Authority, DateTime? End)[] items) =>
        items.ToDictionary(i => i.Authority, i => i.End);

    // ── It exists, on the next free bit, switchable, and no stored bit moved ─────────────────────────────────────────

    [Fact]
    public void SeeCompare_is_an_authority_on_bit_12_and_is_switchable()
    {
        FarmAuthorities.TryParse("SeeCompare", out var parsed).Should().BeTrue();
        FarmAuthorities.TryParse("seecompare", out _).Should().BeTrue("the wire name is case-insensitive like every other");
        FarmAuthorities.All.Should().Contain(parsed);
        FarmAuthorities.Switchable.Should().Contain(parsed);
        FarmAuthorities.NameOf(parsed).Should().Be("SeeCompare");

        ((int)FarmAuthorities.BitOf(parsed)).Should().Be(1 << 12);
        ((int)FarmPermission.SeeAllTasks).Should().Be(1 << 11, "the last bit before it did not move");
        FarmPermissionDefaults.All.HasFlag(FarmAuthorities.BitOf(parsed)).Should().BeTrue();
        FarmPermissionDefaults.Known.HasFlag(FarmAuthorities.BitOf(parsed)).Should().BeTrue();
        FarmAuthorities.RequiredBy(parsed).Should().BeNull("it needs no other authority");
    }

    [Fact]
    public void Every_authority_has_its_own_bit_and_every_stored_bit_is_named_once()
    {
        var bits = FarmAuthorities.All
            .Where(a => a != FarmAuthority.TakeAttendance)
            .Select(a => (int)FarmAuthorities.BitOf(a))
            .ToList();
        bits.Should().OnlyHaveUniqueItems();
        bits.Should().OnlyContain(b => b != 0 && (b & (b - 1)) == 0, "one flag bit each");
        // spec: plr-d10 lane REM-1 (R19) - the same one test, over EVERY member of the stored mask (retired bits included): each is a
        // distinct single bit, and none is ever renumbered (the values are persisted).
        var members = Enum.GetValues<FarmPermission>().Where(p => p != FarmPermission.None).Select(p => (int)p).ToList();
        members.Should().OnlyHaveUniqueItems();
        members.Should().OnlyContain(b => (b & (b - 1)) == 0, "every member is a single bit");
        ((int)FarmPermission.ManageReminders).Should().Be(1 << 13, "the next free bit after SeeCompare (1 << 12)");
        FarmAuthorities.Switchable.Should().BeEquivalentTo(FarmAuthorities.All, "every authority is enforced and offered");
    }

    [Fact]
    public void The_permission_mask_round_trips_by_name_never_by_ordinal()
    {
        var bit = FarmAuthorities.BitOf(FarmAuthority.SeeCompare);
        FarmPermissionDefaults.Names(bit).Should().Equal("SeeCompare");
        FarmPermissionDefaults.TryParse(["seeCompare"], out var parsed).Should().BeTrue();
        parsed.Should().Be(bit);
        FarmPermissionDefaults.TryParse(["SeeAllTasks", "SeeCompare"], out var both).Should().BeTrue();
        FarmPermissionDefaults.Names(both).Should().Equal("SeeAllTasks", "SeeCompare");
        FarmPermissionDefaults.IsKnown(bit).Should().BeTrue();
        // A bit nobody has defined yet is still unknown (bit 14; bit 13 is ManageReminders since lane REM-1).
        FarmPermissionDefaults.IsKnown((FarmPermission)(1 << 14)).Should().BeFalse();
    }

    // ── The start value is OFF: no label gets it by default; the primary owner always holds it ───────────────────────

    [Fact]
    public void No_default_seat_gets_it_and_the_primary_owner_always_holds_it()
    {
        var bit = FarmAuthorities.BitOf(FarmAuthority.SeeCompare);
        foreach (var role in Enum.GetValues<AppRole>().Where(r => r != AppRole.PrimaryOwner))
        {
            FarmPermissionDefaults.For(role).HasFlag(bit).Should().BeFalse($"{role} starts with nothing");
            FarmPermissionDefaults.Effective(role, null).HasFlag(bit).Should().BeFalse($"{role} with nothing stored");
            Seat(role).Holds(FarmAuthority.SeeCompare, Now).Should().BeFalse($"a {role} label alone does not hold SeeCompare");
        }

        FarmPermissionDefaults.For(AppRole.PrimaryOwner).HasFlag(bit).Should().BeTrue();
        Seat(AppRole.PrimaryOwner).Holds(FarmAuthority.SeeCompare, Now).Should().BeTrue();
        Seat(AppRole.PrimaryOwner).Holds(FarmAuthority.SeeCompare, Now.AddYears(20)).Should().BeTrue("a label, not a date, gives the owner everything");
    }

    // ── Who can be given it: not a Worker seat, ever ─────────────────────────────────────────────────────────────────

    [Fact]
    public void A_co_owner_and_a_mukadam_can_be_given_it_and_hold_it_until_its_end()
    {
        foreach (var role in new[] { AppRole.SecondaryOwner, AppRole.Mukadam })
        {
            var seat = Seat(role);
            seat.SetAuthorities(Set((FarmAuthority.SeeCompare, Friday)), Now).Should().BeTrue();

            seat.StoresAuthority(FarmAuthority.SeeCompare).Should().BeTrue();
            seat.ExpiryOf(FarmAuthority.SeeCompare).Should().Be(Friday);
            seat.Holds(FarmAuthority.SeeCompare, Now).Should().BeTrue();
            seat.Holds(FarmAuthority.SeeCompare, Friday.AddTicks(-1)).Should().BeTrue();
            seat.Holds(FarmAuthority.SeeCompare, Friday).Should().BeFalse("an expired seat does not hold it (strict, like every other)");
            seat.Holds(FarmAuthority.SeeAllTasks, Now).Should().BeFalse("giving one authority brings no other along");
        }
    }

    [Fact]
    public void A_permanent_grant_is_held_and_taking_it_back_stops_it()
    {
        var seat = Seat(AppRole.SecondaryOwner);
        seat.SetAuthorities(Set((FarmAuthority.SeeCompare, null)), Now);
        seat.Holds(FarmAuthority.SeeCompare, Now.AddYears(5)).Should().BeTrue();

        seat.SetAuthorities(Set((FarmAuthority.SeeAllTasks, null)), Now.AddMinutes(1)).Should().BeTrue("the whole set is desired state");
        seat.StoresAuthority(FarmAuthority.SeeCompare).Should().BeFalse();
        seat.Holds(FarmAuthority.SeeCompare, Now.AddMinutes(2)).Should().BeFalse();
    }

    [Fact]
    public void A_worker_seat_can_never_be_given_it_through_the_whole_set()
    {
        var seat = Seat(AppRole.Worker);
        var act = () => seat.SetAuthorities(Set((FarmAuthority.SeeCompare, null)), Now);

        act.Should().Throw<ArgumentException>("a Worker seat is refused, never trimmed");
        seat.StoresAuthority(FarmAuthority.SeeCompare).Should().BeFalse("nothing was written");
        seat.Permissions.Should().BeNull();
    }

    [Fact]
    public void A_worker_seat_can_never_be_given_it_through_an_approval_or_an_access_change()
    {
        var bit = FarmAuthorities.BitOf(FarmAuthority.SeeCompare);

        var waiting = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), Now.AddDays(-1));
        var approve = () => waiting.Approve(Owner, AppRole.Worker, bit, Now);
        approve.Should().Throw<ArgumentException>();
        waiting.Status.Should().Be(MembershipStatus.PendingApproval, "the refusal wrote nothing");

        var mukadam = Seat(AppRole.Mukadam);
        var change = () => mukadam.SetAccess(AppRole.Worker, bit, Owner, Now);
        change.Should().Throw<ArgumentException>();
        mukadam.Role.Should().Be(AppRole.Mukadam);

        // The same bit is fine for a seat that is not a Worker.
        var coOwner = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, new UserId(Guid.NewGuid()), Now.AddDays(-1));
        coOwner.Approve(Owner, AppRole.SecondaryOwner, bit, Now);
        coOwner.Holds(FarmAuthority.SeeCompare, Now).Should().BeTrue();
    }

    [Fact]
    public void A_bit_that_somehow_sits_on_a_worker_seat_is_not_held()
    {
        // The read side fails closed too: a stored bit on a Worker (a row written by hand, an older build) holds nothing.
        var held = FarmAuthorities.IsHeld(
            AppRole.Worker, FarmAuthorities.BitOf(FarmAuthority.SeeCompare), labourGrant: false, labourGrantExpiresAtUtc: null,
            expiriesJson: null, FarmAuthority.SeeCompare, Now);
        held.Should().BeFalse();
        FarmPermissionDefaults.Effective(AppRole.Worker, FarmPermission.SeeCompare | FarmPermission.PlanWork)
            .Should().Be(FarmPermission.PlanWork, "the stored bit is dropped for a Worker, like an unknown bit");
        FarmPermissionDefaults.Effective(AppRole.Mukadam, FarmPermission.SeeCompare)
            .Should().Be(FarmPermission.SeeCompare);

        FarmAuthorities.IsHeld(
            AppRole.Mukadam, FarmAuthorities.BitOf(FarmAuthority.SeeCompare), labourGrant: false, labourGrantExpiresAtUtc: null,
            expiriesJson: null, FarmAuthority.SeeCompare, Now).Should().BeTrue("control: the same bit on a Mukadam seat is held");
    }

    [Fact]
    public void On_the_card_it_is_not_in_force_for_a_worker_and_nobody_else()
    {
        FarmAuthorities.NotInForce(AppRole.Worker, MembershipPlotScope.AllPlots).Should().Contain(FarmAuthority.SeeCompare);
        FarmAuthorities.NotInForce(AppRole.Worker, MembershipPlotScope.OwnWork).Should().Contain(FarmAuthority.SeeCompare);
        FarmAuthorities.NotInForce(AppRole.Mukadam, MembershipPlotScope.AllPlots).Should().NotContain(FarmAuthority.SeeCompare);
        FarmAuthorities.NotInForce(AppRole.SecondaryOwner, MembershipPlotScope.AllPlots).Should().NotContain(FarmAuthority.SeeCompare);
        FarmAuthorities.NotInForce(AppRole.PrimaryOwner, MembershipPlotScope.OwnWork).Should().BeEmpty();
    }

    // ── The personal invitation: the same rule, named at the door ────────────────────────────────────────────────────

    [Fact]
    public void An_invitation_to_a_worker_cannot_carry_it_and_one_to_a_mukadam_can()
    {
        PersonalInvitation Make(RelationshipLabel label, MembershipPlotScope scope) =>
            PersonalInvitation.Create(
                Guid.NewGuid(), Farm, "पाटील फार्म", Owner, label, "रमेश", "+916000012345", null, scope,
                scope == MembershipPlotScope.ChosenPlots ? [Guid.NewGuid()] : [],
                scope == MembershipPlotScope.ChosenPlots ? ["प्लॉट 1"] : [],
                new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.SeeCompare] = null },
                "48217730", Now);

        var worker = () => Make(RelationshipLabel.Worker, MembershipPlotScope.OwnWork);
        worker.Should().Throw<ArgumentException>();
        Make(RelationshipLabel.Mukadam, MembershipPlotScope.AllPlots).Should().NotBeNull();
        Make(RelationshipLabel.CoOwner, MembershipPlotScope.AllPlots).Should().NotBeNull();
    }
}
