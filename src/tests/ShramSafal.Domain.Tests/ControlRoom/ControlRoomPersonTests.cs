using FluentAssertions;
using ShramSafal.Domain.ControlRoom;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

public sealed class ControlRoomPersonTests
{
    private static readonly Guid FounderId = Guid.Parse("00000000-0000-0000-0000-0000000000f1");
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);
    private const string Phone = "+919000000012";

    private static ControlRoomPerson NewPerson(params string[] ticks) =>
        ControlRoomPerson.Add(Guid.NewGuid(), Phone, "Example: Asha", ControlRoomRole.Viewer, ticks, FounderId, Now);

    [Fact]
    public void Add_refuses_a_number_that_is_not_an_Indian_mobile()
    {
        var act = () => ControlRoomPerson.Add(Guid.NewGuid(), "12345", "Example: Asha", ControlRoomRole.Viewer, [], FounderId, Now);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Add_stores_plus91_and_ten_digits()
    {
        var spaced = () => ControlRoomPerson.Add(Guid.NewGuid(), "+91 90000 00012", "Example: Asha", ControlRoomRole.Viewer, [], FounderId, Now);
        spaced.Should().Throw<ArgumentException>();

        var p = NewPerson();
        p.PhoneE164.Should().Be("+919000000012");
        p.IsActive.Should().BeTrue();
        p.AddedAtUtc.Should().Be(Now);
        p.AddedByUserId.Should().Be(FounderId);
        p.UserId.Should().BeNull();
    }

    [Fact]
    public void Add_trims_the_name_and_refuses_an_empty_or_long_one()
    {
        ControlRoomPerson.Add(Guid.NewGuid(), Phone, "  Example: Asha  ", ControlRoomRole.Viewer, [], FounderId, Now)
            .DisplayName.Should().Be("Example: Asha");
        foreach (var bad in new[] { "", "   ", new string('x', 81) })
        {
            var act = () => ControlRoomPerson.Add(Guid.NewGuid(), Phone, bad, ControlRoomRole.Viewer, [], FounderId, Now);
            act.Should().Throw<ArgumentException>();
        }
        ControlRoomPerson.Add(Guid.NewGuid(), Phone, new string('x', 80), ControlRoomRole.Viewer, [], FounderId, Now)
            .DisplayName.Should().HaveLength(80);
    }

    [Fact]
    public void Add_refuses_an_unknown_tick()
    {
        var act = () => NewPerson(ControlRoomTicks.Users, "bogus");
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Ticks_are_kept_once_each_in_tick_order()
    {
        var p = NewPerson(ControlRoomTicks.MyVisits, ControlRoomTicks.CompanyNumbers, ControlRoomTicks.MyVisits, ControlRoomTicks.Users);
        p.Ticks.Should().Equal(ControlRoomTicks.CompanyNumbers, ControlRoomTicks.Users, ControlRoomTicks.MyVisits);
    }

    [Fact]
    public void Change_reports_ticks_added_and_removed()
    {
        var p = NewPerson(ControlRoomTicks.CompanyNumbers, ControlRoomTicks.Users);
        var later = Now.AddHours(1);

        var change = p.Change("Example: Asha K", ControlRoomRole.Admin, [ControlRoomTicks.Users, ControlRoomTicks.FarmerPhones], later);

        change.Added.Should().Equal(ControlRoomTicks.FarmerPhones);
        change.Removed.Should().Equal(ControlRoomTicks.CompanyNumbers);
        p.Ticks.Should().Equal(ControlRoomTicks.Users, ControlRoomTicks.FarmerPhones);
        p.DisplayName.Should().Be("Example: Asha K");
        p.StartingRole.Should().Be(ControlRoomRole.Admin);
        p.ChangedAtUtc.Should().Be(later);
    }

    [Fact]
    public void Change_with_the_same_ticks_reports_two_empty_lists()
    {
        var p = NewPerson(ControlRoomTicks.Users);
        var change = p.Change("Example: Asha", ControlRoomRole.Viewer, [ControlRoomTicks.Users], Now.AddMinutes(1));
        change.Added.Should().NotBeNull().And.BeEmpty();
        change.Removed.Should().NotBeNull().And.BeEmpty();
    }

    [Fact]
    public void A_removed_person_cannot_be_changed_bound_or_kept()
    {
        var p = NewPerson();
        p.Remove(FounderId, Now.AddDays(1));

        p.IsActive.Should().BeFalse();
        p.RemovedByUserId.Should().Be(FounderId);
        p.RemovedAtUtc.Should().Be(Now.AddDays(1));
        new Action(() => p.Change("Example: Asha", ControlRoomRole.Viewer, [], Now)).Should().Throw<InvalidOperationException>();
        new Action(() => p.BindTo(Guid.NewGuid(), Guid.NewGuid(), Now)).Should().Throw<InvalidOperationException>();
        new Action(() => p.Keep(Now)).Should().Throw<InvalidOperationException>();
        new Action(() => p.Remove(FounderId, Now)).Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void BindTo_refuses_a_second_account()
    {
        var p = NewPerson();
        var user = Guid.NewGuid();
        var seat = Guid.NewGuid();

        p.BindTo(user, seat, Now);
        p.UserId.Should().Be(user);
        p.MembershipId.Should().Be(seat);

        p.BindTo(user, Guid.NewGuid(), Now.AddMinutes(5));
        p.MembershipId.Should().Be(seat);

        new Action(() => p.BindTo(Guid.NewGuid(), Guid.NewGuid(), Now)).Should().Throw<InvalidOperationException>();
        p.UserId.Should().Be(user);
    }

    [Fact]
    public void Keep_marks_the_time_and_leaves_the_ticks()
    {
        var p = NewPerson(ControlRoomTicks.Users);
        var at = Now.AddDays(30);
        p.Keep(at);
        p.KeptAtUtc.Should().Be(at);
        p.Ticks.Should().Equal(ControlRoomTicks.Users);
    }

    [Fact]
    public void History_actions_carry_the_agreed_names()
    {
        ControlRoomHistoryAction.EntityType.Should().Be("control_room");
        ControlRoomHistoryAction.ActorRole.Should().Be("control_room");
        ControlRoomHistoryAction.CodeNotSent.Should().Be("code_not_sent");
        ControlRoomHistoryAction.DaySheetPrinted.Should().Be("day_sheet_printed");
    }
}
