// lane 2b (MU farm-relationships design §2, §11.1, §11.2; founder D-22 / D-26 / D-44) — the seat's
// two write paths for authorities: the primary owner's whole-set route (SetAuthorities) and the one
// switch older phones still send (SetLegacyLabourSwitch, "हजेरी व पक्कं" = हजेरी + confirm records).
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class FarmMembershipAuthoritiesTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Friday = Now.AddDays(4);

    private static FarmMembership Seat(AppRole role = AppRole.SecondaryOwner) =>
        FarmMembership.Create(Guid.NewGuid(), new FarmId(Guid.NewGuid()), new UserId(Guid.NewGuid()), role, Now.AddDays(-30));

    private static Dictionary<FarmAuthority, DateTime?> Set(params (FarmAuthority Authority, DateTime? End)[] items) =>
        items.ToDictionary(i => i.Authority, i => i.End);

    [Fact]
    public void The_whole_set_is_stored_each_with_its_own_end_and_a_label_adds_nothing()
    {
        var seat = Seat();

        var moved = seat.SetAuthorities(Set(
            (FarmAuthority.TakeAttendance, null),
            (FarmAuthority.ConfirmRecords, Friday),
            (FarmAuthority.SeeMoney, null),
            (FarmAuthority.ReviewMoney, Friday)), Now);

        Assert.True(moved);
        Assert.True(seat.CanManageLabourRecords);
        Assert.Null(seat.LabourGrantExpiresAtUtc);
        Assert.Equal(FarmPermission.ConfirmRecords | FarmPermission.SeeMoney | FarmPermission.AddCost, seat.Permissions);
        Assert.Equal(Friday, seat.ExpiryOf(FarmAuthority.ConfirmRecords));
        Assert.Equal(Friday, seat.ExpiryOf(FarmAuthority.ReviewMoney));
        Assert.Null(seat.ExpiryOf(FarmAuthority.SeeMoney));

        Assert.True(seat.Holds(FarmAuthority.ConfirmRecords, Friday.AddTicks(-1)));
        Assert.False(seat.Holds(FarmAuthority.ConfirmRecords, Friday));
        Assert.True(seat.Holds(FarmAuthority.TakeAttendance, Friday.AddYears(1)));
        // The सहमालक label brings nothing that was not chosen.
        Assert.False(seat.Holds(FarmAuthority.EditFarmSetup, Now));
        Assert.False(seat.Holds(FarmAuthority.SeeWages, Now));
    }

    [Fact]
    public void A_resent_set_moves_nothing_and_an_absent_authority_is_taken_back()
    {
        var seat = Seat();
        var desired = Set((FarmAuthority.TakeAttendance, Friday), (FarmAuthority.EditFarmSetup, null));
        Assert.True(seat.SetAuthorities(desired, Now));
        Assert.False(seat.SetAuthorities(desired, Now.AddMinutes(1)), "a re-sent request is not a decision");

        Assert.True(seat.SetAuthorities(Set((FarmAuthority.EditFarmSetup, null)), Now.AddMinutes(2)));
        Assert.False(seat.CanManageLabourRecords);
        Assert.Null(seat.LabourGrantExpiresAtUtc);
        Assert.True(seat.Holds(FarmAuthority.EditFarmSetup, Now.AddMinutes(3)));
    }

    [Fact]
    public void Refused_never_trimmed_an_end_already_past_a_money_review_without_money_an_ended_seat()
    {
        var seat = Seat();
        Assert.Throws<ArgumentException>(() => seat.SetAuthorities(Set((FarmAuthority.ConfirmRecords, Now)), Now));
        Assert.Throws<ArgumentException>(() => seat.SetAuthorities(Set((FarmAuthority.ReviewMoney, null)), Now));
        Assert.Throws<ArgumentException>(() => seat.SetAuthorities(Set((FarmAuthority.SeeWages, null)), Now));
        Assert.Null(seat.Permissions);
        Assert.False(seat.CanManageLabourRecords);

        seat.Revoke(Now);
        Assert.Throws<InvalidOperationException>(() => seat.SetAuthorities(Set((FarmAuthority.EditFarmSetup, null)), Now));
    }

    [Fact]
    public void The_older_phones_one_switch_means_hazeri_and_confirming_together_and_touches_nothing_else()
    {
        var seat = Seat(AppRole.Mukadam);
        seat.SetAuthorities(Set((FarmAuthority.EditFarmSetup, Friday), (FarmAuthority.SeeMoney, null)), Now);

        Assert.True(seat.SetLegacyLabourSwitch(true, Friday, Now));
        Assert.True(seat.Holds(FarmAuthority.TakeAttendance, Now));
        Assert.True(seat.Holds(FarmAuthority.ConfirmRecords, Now));
        Assert.Equal(Friday, seat.LabourGrantExpiresAtUtc);
        Assert.Equal(Friday, seat.ExpiryOf(FarmAuthority.ConfirmRecords));
        Assert.Equal(Friday, seat.ExpiryOf(FarmAuthority.EditFarmSetup));
        Assert.True(seat.Holds(FarmAuthority.SeeMoney, Now));

        Assert.False(seat.SetLegacyLabourSwitch(true, Friday, Now.AddMinutes(1)), "re-sent: nothing moves");

        Assert.True(seat.SetLegacyLabourSwitch(false, null, Now.AddMinutes(2)));
        Assert.False(seat.Holds(FarmAuthority.TakeAttendance, Now.AddMinutes(3)));
        Assert.False(seat.Holds(FarmAuthority.ConfirmRecords, Now.AddMinutes(3)));
        Assert.True(seat.Holds(FarmAuthority.EditFarmSetup, Now.AddMinutes(3)));
        Assert.Equal(Friday, seat.ExpiryOf(FarmAuthority.EditFarmSetup));

        Assert.Throws<ArgumentException>(() => seat.SetLegacyLabourSwitch(true, Now.AddMinutes(-1), Now));
    }

    [Fact]
    public void A_chosen_bit_brings_what_it_needs_and_nothing_else()
    {
        Assert.Equal(FarmPermission.SeeMoney | FarmPermission.AddCost, FarmAuthorities.WithWhatTheyNeed(FarmPermission.AddCost));
        Assert.Equal(FarmPermission.SeeMoney | FarmPermission.SeeWages, FarmAuthorities.WithWhatTheyNeed(FarmPermission.SeeWages));
        Assert.Equal(FarmPermission.PlanWork, FarmAuthorities.WithWhatTheyNeed(FarmPermission.PlanWork));
        Assert.Equal(FarmPermission.None, FarmAuthorities.WithWhatTheyNeed(FarmPermission.None));
    }
}
