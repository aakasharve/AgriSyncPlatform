// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-133 withdrawn, D-137; register F218, F222 (a), (d), (e)).
// A person's own schedule belongs to the PERSON (schedule_templates.owner_user_id): it is Own on a plot of ANY farm he owns, and never on another
// owner's farm - so after a transfer the new owner's plot cannot follow it afresh. A row with no owner is only RECOGNISED (R23), never Own-followable.
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class FollowableOnPlotOwnerTests
{
    private static readonly Guid Owner = Guid.Parse("a0a00000-0000-4000-8000-000000000001");
    private static readonly Guid OtherOwner = Guid.Parse("b0b00000-0000-4000-8000-000000000001");

    [Fact]
    public void The_owners_schedule_is_Own_on_a_plot_of_any_farm_he_owns() =>
        // The plot's farm is any farm whose owner_user_id is the schedule's owner: the farm id itself decides nothing.
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: Owner));

    [Fact]
    public void It_is_never_Own_on_another_owners_farm() =>
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: OtherOwner, scheduleOwnerUserId: Owner));

    [Fact]
    public void After_a_transfer_the_new_owners_plot_cannot_follow_it_afresh()
    {
        // F222 (a), (e): the farm now belongs to OtherOwner; the schedule still belongs to Owner. The column is compared AT CALL TIME, so the new
        // owner's plot is "another owner's farm" - null, answered like an unknown id. (The plot that already follows it keeps its version: that is
        // the subscription's, not this rule's.)
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: OtherOwner, scheduleOwnerUserId: Owner));
        // And the old owner's plots elsewhere keep following it.
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: Owner));
    }

    [Fact]
    public void The_column_decides_not_the_derived_owner()
    {
        // The second argument is the viewer's derived owner (the first version's maker when no owner is set); the fifth is the COLUMN. With a
        // column set, the column alone is compared.
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, OtherOwner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: Owner));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: OtherOwner));
    }

    [Fact]
    public void An_owned_row_that_is_not_Team_is_never_followable()
    {
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Private, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: Owner));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Licensed, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: Owner));
    }

    [Fact]
    public void An_empty_owner_or_plot_farm_owner_never_matches()
    {
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: Guid.Empty, scheduleOwnerUserId: Owner));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: Guid.Empty));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, Guid.Empty, isBuiltIn: false, plotFarmOwnerUserId: Guid.Empty, scheduleOwnerUserId: Guid.Empty));
    }

    [Fact]
    public void A_Team_row_with_no_owner_keeps_the_R23_recognition_and_nothing_more()
    {
        // F218: recognised as his team's (so adopt answers it as x1 did, not "not found"); the Application layer never lets it be followed.
        Assert.Equal(ScheduleOrigin.Own,
            FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: null));
        // the four-argument call of every older caller
        Assert.Equal(ScheduleOrigin.Own, FollowableOnPlot.Classify(TenantScope.Team, Owner, isBuiltIn: false, Owner));
        Assert.Null(FollowableOnPlot.Classify(TenantScope.Team, OtherOwner, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: null));
    }

    [Fact]
    public void Public_and_built_in_stay_Outside_whatever_owner_is_named()
    {
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Public, null, isBuiltIn: false, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: OtherOwner));
        Assert.Equal(ScheduleOrigin.Outside, FollowableOnPlot.Classify(TenantScope.Team, null, isBuiltIn: true, plotFarmOwnerUserId: Owner, scheduleOwnerUserId: OtherOwner));
    }
}
