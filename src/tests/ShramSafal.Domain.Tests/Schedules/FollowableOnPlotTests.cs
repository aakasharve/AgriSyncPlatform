// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1F Task 3; E4, R23)
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

/// <summary>What a plot may follow depends on the PLOT's farm. Pure: no Application type is used here.</summary>
public sealed class FollowableOnPlotTests
{
    private static readonly Guid ThisFarmOwner = Guid.Parse("a0a00000-0000-4000-8000-000000000001");
    private static readonly Guid OtherFarmOwner = Guid.Parse("b0b00000-0000-4000-8000-000000000001");

    [Fact]
    public void A_built_in_is_Outside() =>
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Public, null, isBuiltIn: true, ThisFarmOwner));

    [Fact]
    public void A_built_in_is_Outside_whatever_its_scope_says() =>
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Private, null, isBuiltIn: true, ThisFarmOwner));

    [Fact]
    public void Public_is_Outside() =>
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Public, OtherFarmOwner, isBuiltIn: false, ThisFarmOwner));

    [Fact]
    public void Team_owned_by_this_farms_owner_is_Own() =>
        Assert.Equal(ScheduleOrigin.Own, FollowableOnPlot.Classify(TenantScope.Team, ThisFarmOwner, isBuiltIn: false, ThisFarmOwner));

    [Fact]
    public void Team_owned_by_another_farms_owner_is_not_followable() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, OtherFarmOwner, isBuiltIn: false, ThisFarmOwner));

    [Fact]
    public void Team_with_no_owner_is_not_followable() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, null, isBuiltIn: false, ThisFarmOwner));

    [Fact]
    public void Private_is_not_followable_even_when_it_is_the_farm_owners_own() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Private, ThisFarmOwner, isBuiltIn: false, ThisFarmOwner));

    [Fact]
    public void Licensed_is_not_followable_until_it_exists() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Licensed, ThisFarmOwner, isBuiltIn: false, ThisFarmOwner));

    [Fact]
    public void An_empty_farm_owner_never_makes_a_team_row_Own() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Guid.Empty, isBuiltIn: false, Guid.Empty));
}
