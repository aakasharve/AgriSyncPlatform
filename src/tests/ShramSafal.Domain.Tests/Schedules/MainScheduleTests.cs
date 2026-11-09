using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, D-76) - which followed schedule is the मुख्य one: the followed schedule that is CHECKED now and
/// comes from an Institution (even in place 2 or 3); else the lowest outside place; else his own; none -> null. An owner type that
/// is not known is not an Institution (P4); an Institution schedule that is not checked now is not मुख्य by the first rule.
/// </summary>
public sealed class MainScheduleTests
{
    private static readonly FarmId Farm = new(Guid.NewGuid());
    private static readonly Guid Plot = Guid.NewGuid();
    private static readonly Guid Cycle = Guid.NewGuid();
    private static readonly DateTime T0 = new(2026, 11, 1, 6, 0, 0, DateTimeKind.Utc);

    private static ScheduleSubscription Follow(ScheduleOrigin origin, short? slot, int adoptedDaysAfterT0 = 0) =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(), Farm, Plot, Cycle, "grapes", ScheduleTemplateId.New(), "v1", T0.AddDays(adoptedDaysAfterT0),
            null, origin, origin == ScheduleOrigin.Own ? null : ScheduleCheckState.Checked, slot);

    private static Func<ScheduleTemplateId, MainScheduleFacts?> Facts(params (ScheduleSubscription Sub, ScheduleOwnerType? Owner, bool Checked)[] known)
    {
        var map = known.ToDictionary(k => k.Sub.ScheduleTemplateId.Value, k => new MainScheduleFacts(k.Owner, k.Checked));
        return id => map.GetValueOrDefault(id.Value);
    }

    [Fact]
    public void A_followed_checked_Institution_schedule_is_main_even_in_place_3()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var two = Follow(ScheduleOrigin.Outside, 2);
        var three = Follow(ScheduleOrigin.Outside, 3);

        var main = MainSchedule.Pick([one, two, three], Facts(
            (one, ScheduleOwnerType.Expert, true), (two, ScheduleOwnerType.User, true), (three, ScheduleOwnerType.Institution, true)));

        Assert.Same(three, main);
    }

    [Fact]
    public void With_no_Institution_schedule_the_lowest_outside_place_is_main()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var two = Follow(ScheduleOrigin.Outside, 2);
        var own = Follow(ScheduleOrigin.Own, 0);

        var main = MainSchedule.Pick([own, two, one], Facts((one, ScheduleOwnerType.Expert, true), (two, ScheduleOwnerType.Expert, true)));

        Assert.Same(one, main);
    }

    [Fact]
    public void Only_his_own_schedule_is_main_when_nothing_outside_is_followed()
    {
        var own = Follow(ScheduleOrigin.Own, 0);

        Assert.Same(own, MainSchedule.Pick([own], Facts()));
    }

    [Fact]
    public void Nothing_followed_has_no_main_schedule()
    {
        Assert.Null(MainSchedule.Pick([], Facts()));
    }

    [Fact]
    public void An_unknown_owner_type_is_not_an_Institution()
    {
        var sample = Follow(ScheduleOrigin.Outside, 1); // a built-in sample carries no owner type
        var other = Follow(ScheduleOrigin.Outside, 2);

        // no facts at all for `sample`; `other` is a known Expert: the lowest place wins, nothing is assumed
        Assert.Same(sample, MainSchedule.Pick([other, sample], Facts((other, ScheduleOwnerType.Expert, true))));
        // an owner type that is null on a known schedule is the same
        Assert.Same(sample, MainSchedule.Pick([sample, other], Facts((sample, null, true), (other, ScheduleOwnerType.Expert, true))));
    }

    [Fact]
    public void An_Institution_schedule_that_is_not_checked_now_is_not_main_by_the_first_rule()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var institutionWithdrawn = Follow(ScheduleOrigin.Outside, 2);

        var main = MainSchedule.Pick([one, institutionWithdrawn], Facts((one, ScheduleOwnerType.Expert, true), (institutionWithdrawn, ScheduleOwnerType.Institution, false)));

        Assert.Same(one, main);
    }

    [Fact]
    public void Two_checked_Institution_schedules_the_lower_place_is_main()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var two = Follow(ScheduleOrigin.Outside, 2);
        var three = Follow(ScheduleOrigin.Outside, 3);

        var main = MainSchedule.Pick([three, two, one], Facts(
            (one, ScheduleOwnerType.Expert, true), (two, ScheduleOwnerType.Institution, true), (three, ScheduleOwnerType.Institution, true)));

        Assert.Same(two, main);
    }

    [Fact]
    public void A_row_chosen_before_the_lane_with_no_origin_and_no_place_reads_as_outside_and_comes_after_placed_rows()
    {
        var legacy = Follow(ScheduleOrigin.Outside, null);
        var placed = Follow(ScheduleOrigin.Outside, 2, adoptedDaysAfterT0: 5);
        var own = Follow(ScheduleOrigin.Own, 0);

        Assert.Same(placed, MainSchedule.Pick([own, legacy, placed], Facts()));
        Assert.Same(legacy, MainSchedule.Pick([own, legacy], Facts()));
    }

    [Fact]
    public void A_row_that_is_not_active_is_never_main()
    {
        var ended = Follow(ScheduleOrigin.Outside, 1);
        ended.Abandon(T0.AddDays(1));
        var kept = Follow(ScheduleOrigin.Outside, 2);

        Assert.Same(kept, MainSchedule.Pick([ended, kept], Facts((ended, ScheduleOwnerType.Institution, true))));
        Assert.Null(MainSchedule.Pick([ended], Facts()));
    }
}
