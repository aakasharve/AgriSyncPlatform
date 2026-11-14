using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, D-76) - which followed schedule is the मुख्य one: the followed schedule that is CHECKED now and
/// comes from an Institution (even in place 2 or 3); else the lowest outside place; else his own; none -> null. An owner type that
/// is not known is not an Institution (P4); an Institution schedule that is not checked now is not मुख्य by the first rule.
/// spec: plr-d10 lane CMP-OWN (founder ticked compare v4) - above all of that, a followed schedule that is the plot farm owner's OWN
/// (its owner_user_id column, D-136) AND stores stages is the main one; one with no stages never is.
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
            (one, ScheduleOwnerType.Expert, true), (two, ScheduleOwnerType.User, true), (three, ScheduleOwnerType.Institution, true)), null);

        Assert.Same(three, main);
    }

    [Fact]
    public void With_no_Institution_schedule_the_lowest_outside_place_is_main()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var two = Follow(ScheduleOrigin.Outside, 2);
        var own = Follow(ScheduleOrigin.Own, 0);

        var main = MainSchedule.Pick([own, two, one], Facts((one, ScheduleOwnerType.Expert, true), (two, ScheduleOwnerType.Expert, true)), null);

        Assert.Same(one, main);
    }

    [Fact]
    public void Only_his_own_schedule_is_main_when_nothing_outside_is_followed()
    {
        var own = Follow(ScheduleOrigin.Own, 0);

        Assert.Same(own, MainSchedule.Pick([own], Facts(), null));
    }

    [Fact]
    public void Nothing_followed_has_no_main_schedule()
    {
        Assert.Null(MainSchedule.Pick([], Facts(), null));
    }

    [Fact]
    public void An_unknown_owner_type_is_not_an_Institution()
    {
        var sample = Follow(ScheduleOrigin.Outside, 1); // a built-in sample carries no owner type
        var other = Follow(ScheduleOrigin.Outside, 2);

        // no facts at all for `sample`; `other` is a known Expert: the lowest place wins, nothing is assumed
        Assert.Same(sample, MainSchedule.Pick([other, sample], Facts((other, ScheduleOwnerType.Expert, true)), null));
        // an owner type that is null on a known schedule is the same
        Assert.Same(sample, MainSchedule.Pick([sample, other], Facts((sample, null, true), (other, ScheduleOwnerType.Expert, true)), null));
    }

    [Fact]
    public void An_Institution_schedule_that_is_not_checked_now_is_not_main_by_the_first_rule()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var institutionWithdrawn = Follow(ScheduleOrigin.Outside, 2);

        var main = MainSchedule.Pick([one, institutionWithdrawn], Facts((one, ScheduleOwnerType.Expert, true), (institutionWithdrawn, ScheduleOwnerType.Institution, false)), null);

        Assert.Same(one, main);
    }

    [Fact]
    public void Two_checked_Institution_schedules_the_lower_place_is_main()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var two = Follow(ScheduleOrigin.Outside, 2);
        var three = Follow(ScheduleOrigin.Outside, 3);

        var main = MainSchedule.Pick([three, two, one], Facts(
            (one, ScheduleOwnerType.Expert, true), (two, ScheduleOwnerType.Institution, true), (three, ScheduleOwnerType.Institution, true)), null);

        Assert.Same(two, main);
    }

    [Fact]
    public void A_row_chosen_before_the_lane_with_no_origin_and_no_place_reads_as_outside_and_comes_after_placed_rows()
    {
        var legacy = Follow(ScheduleOrigin.Outside, null);
        var placed = Follow(ScheduleOrigin.Outside, 2, adoptedDaysAfterT0: 5);
        var own = Follow(ScheduleOrigin.Own, 0);

        Assert.Same(placed, MainSchedule.Pick([own, legacy, placed], Facts(), null));
        Assert.Same(legacy, MainSchedule.Pick([own, legacy], Facts(), null));
    }

    [Fact]
    public void A_row_that_is_not_active_is_never_main()
    {
        var ended = Follow(ScheduleOrigin.Outside, 1);
        ended.Abandon(T0.AddDays(1));
        var kept = Follow(ScheduleOrigin.Outside, 2);

        Assert.Same(kept, MainSchedule.Pick([ended, kept], Facts((ended, ScheduleOwnerType.Institution, true)), null));
        Assert.Null(MainSchedule.Pick([ended], Facts(), null));
    }

    // ---- lane CMP-OWN: his own plan, with stages, is primary ---------------------------------------------------

    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid SomeoneElse = Guid.NewGuid();

    private static MainScheduleFacts OwnFacts(Guid? owner, bool hasStages, TenantScope scope = TenantScope.Team) =>
        new(ScheduleOwnerType.User, false, scope, owner, hasStages);

    private static Func<ScheduleTemplateId, MainScheduleFacts?> FactsOf(params (ScheduleSubscription Sub, MainScheduleFacts Facts)[] known)
    {
        var map = known.ToDictionary(k => k.Sub.ScheduleTemplateId.Value, k => k.Facts);
        return id => map.GetValueOrDefault(id.Value);
    }

    [Fact]
    public void His_own_schedule_with_stages_beats_a_checked_Institution_schedule()
    {
        var institution = Follow(ScheduleOrigin.Outside, 1);
        var own = Follow(ScheduleOrigin.Own, 0);

        var main = MainSchedule.Pick([institution, own], FactsOf(
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true)),
            (own, OwnFacts(Owner, hasStages: true))), Owner);

        Assert.Same(own, main);
    }

    [Fact]
    public void His_own_schedule_with_stages_beats_a_lower_outside_place()
    {
        var outside = Follow(ScheduleOrigin.Outside, 1);
        var own = Follow(ScheduleOrigin.Own, 0);

        var main = MainSchedule.Pick([outside, own], FactsOf(
            (outside, new MainScheduleFacts(ScheduleOwnerType.Expert, true, TenantScope.Public, null, true)),
            (own, OwnFacts(Owner, hasStages: true))), Owner);

        Assert.Same(own, main);
    }

    [Fact]
    public void A_blank_own_schedule_with_no_stages_does_not_become_main()
    {
        var institution = Follow(ScheduleOrigin.Outside, 2);
        var own = Follow(ScheduleOrigin.Own, 0);

        var main = MainSchedule.Pick([own, institution], FactsOf(
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true)),
            (own, OwnFacts(Owner, hasStages: false))), Owner);

        Assert.Same(institution, main); // the old rule decides, exactly as before
    }

    [Fact]
    public void A_blank_own_schedule_alone_is_still_main_by_the_old_last_rule()
    {
        var own = Follow(ScheduleOrigin.Own, 0);

        Assert.Same(own, MainSchedule.Pick([own], FactsOf((own, OwnFacts(Owner, hasStages: false))), Owner));
    }

    [Fact]
    public void A_schedule_owned_by_a_different_user_is_not_his_own()
    {
        var institution = Follow(ScheduleOrigin.Outside, 2);
        var theirs = Follow(ScheduleOrigin.Own, 0);

        var main = MainSchedule.Pick([theirs, institution], FactsOf(
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true)),
            (theirs, OwnFacts(SomeoneElse, hasStages: true))), Owner);

        Assert.Same(institution, main);
    }

    [Fact]
    public void An_unknown_plot_farm_owner_or_a_row_with_no_owner_column_is_never_his_own()
    {
        var institution = Follow(ScheduleOrigin.Outside, 2);
        var own = Follow(ScheduleOrigin.Own, 0);
        var facts = FactsOf(
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true)),
            (own, OwnFacts(Owner, hasStages: true)));

        Assert.Same(institution, MainSchedule.Pick([own, institution], facts, null)); // plot farm owner not known
        Assert.Same(institution, MainSchedule.Pick([own, institution], facts, Guid.Empty));

        var noOwnerColumn = Follow(ScheduleOrigin.Own, 0);
        Assert.Same(institution, MainSchedule.Pick([noOwnerColumn, institution], FactsOf(
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true)),
            (noOwnerColumn, OwnFacts(null, hasStages: true))), Owner));
    }

    [Fact]
    public void A_Private_or_Public_row_with_his_id_on_it_is_not_his_own_plan()
    {
        var institution = Follow(ScheduleOrigin.Outside, 2);
        var privateRow = Follow(ScheduleOrigin.Own, 0);

        // FollowableOnPlot: only a Team row is Own
        Assert.Same(institution, MainSchedule.Pick([privateRow, institution], FactsOf(
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true)),
            (privateRow, OwnFacts(Owner, hasStages: true, TenantScope.Private))), Owner));
    }

    [Fact]
    public void Several_own_schedules_with_stages_the_lowest_place_is_main()
    {
        // his own holds place 0 only; a row made before the places existed has none and comes after one that has it
        var legacy = Follow(ScheduleOrigin.Own, null, adoptedDaysAfterT0: -5);
        var placed = Follow(ScheduleOrigin.Own, 0, adoptedDaysAfterT0: 5);
        var blankLegacy = Follow(ScheduleOrigin.Own, null, adoptedDaysAfterT0: -9);

        var facts = FactsOf(
            (legacy, OwnFacts(Owner, hasStages: true)),
            (placed, OwnFacts(Owner, hasStages: true)),
            (blankLegacy, OwnFacts(Owner, hasStages: false)));

        Assert.Same(placed, MainSchedule.Pick([legacy, placed, blankLegacy], facts, Owner));

        // no place on either: the same tie rule as today, the one adopted first
        var older = Follow(ScheduleOrigin.Own, null, adoptedDaysAfterT0: -9);
        var newer = Follow(ScheduleOrigin.Own, null, adoptedDaysAfterT0: -2);
        Assert.Same(older, MainSchedule.Pick([newer, older], FactsOf(
            (older, OwnFacts(Owner, hasStages: true)), (newer, OwnFacts(Owner, hasStages: true))), Owner));
    }

    [Fact]
    public void An_own_schedule_that_is_not_active_is_never_main()
    {
        var ended = Follow(ScheduleOrigin.Own, 0);
        ended.Abandon(T0.AddDays(1));
        var institution = Follow(ScheduleOrigin.Outside, 2);

        var main = MainSchedule.Pick([ended, institution], FactsOf(
            (ended, OwnFacts(Owner, hasStages: true)),
            (institution, new MainScheduleFacts(ScheduleOwnerType.Institution, true, TenantScope.Public, null, true))), Owner);

        Assert.Same(institution, main);
        Assert.Null(MainSchedule.Pick([ended], FactsOf((ended, OwnFacts(Owner, hasStages: true))), Owner));
    }

    [Fact]
    public void The_old_pick_is_unchanged_when_no_plot_farm_owner_is_given()
    {
        var one = Follow(ScheduleOrigin.Outside, 1);
        var three = Follow(ScheduleOrigin.Outside, 3);

        Assert.Same(three, MainSchedule.Pick([one, three], Facts((one, ScheduleOwnerType.Expert, true), (three, ScheduleOwnerType.Institution, true)), null));
    }
}
