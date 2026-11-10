// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 2 (R30; founder D-74, D-82 = 3).
// A farm's own schedule belongs to the FARM it names, not to whoever owns that farm: a plot of another farm of the same owner never follows it.
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class FollowableOnPlotOwnFarmTests
{
    private static readonly Guid Owner = Guid.Parse("a0a00000-0000-4000-8000-000000000001");
    private static readonly Guid OtherOwner = Guid.Parse("b0b00000-0000-4000-8000-000000000001");
    private static readonly Guid FarmA = Guid.Parse("a0a00000-0000-4000-8000-0000000000a1");
    private static readonly Guid FarmB = Guid.Parse("a0a00000-0000-4000-8000-0000000000b1");

    [Fact]
    public void A_chain_of_farm_A_is_Own_on_a_plot_of_farm_A() =>
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: FarmA));

    [Fact]
    public void A_chain_of_farm_A_is_not_Own_on_a_plot_of_the_same_owners_farm_B() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: FarmB));

    [Fact]
    public void A_chain_of_farm_A_is_not_Own_on_a_plot_of_another_owners_farm_either() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, OtherOwner, ownFarmId: FarmA, plotFarmId: FarmB));

    [Fact]
    public void The_farm_decides_even_when_the_owner_differs_after_a_transfer() =>
        // R30: the schedule belongs to the farm; whoever the maker or owner is, farm A's plot may follow it.
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, OtherOwner, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: FarmA));

    [Fact]
    public void An_own_farm_row_that_is_not_Team_is_never_followable()
    {
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Private, Owner, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: FarmA));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Licensed, Owner, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: FarmA));
    }

    [Fact]
    public void An_empty_plot_farm_never_matches_an_own_farm()
    {
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: default));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, Owner, ownFarmId: Guid.Empty, plotFarmId: Guid.Empty));
    }

    [Fact]
    public void A_Team_row_with_no_farm_keeps_the_owner_rule_R23() =>
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, Owner, ownFarmId: null, plotFarmId: FarmB));

    [Fact]
    public void A_Team_row_with_no_farm_of_another_owner_is_still_not_followable() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, OtherOwner, isBuiltIn: false, Owner, ownFarmId: null, plotFarmId: FarmA));

    [Fact]
    public void Public_and_built_in_stay_Outside_whatever_farm_is_named()
    {
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Public, null, isBuiltIn: false, Owner, ownFarmId: FarmA, plotFarmId: FarmB));
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Team, null, isBuiltIn: true, Owner, ownFarmId: FarmA, plotFarmId: FarmB));
    }
}
