// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 1 (founder D-24e1, D-26, D-79; MU design §11.6).
// Who sees a task, and which of its plot rows: the primary owner, the creator, the assignee, a holder of SeeAllTasks; a
// chosen-plots seat only a task with one of his plots and only his plots' rows; a Farm / Unspecified task only the creator
// and the assignee (and the primary owner). A crew headcount gives no other worker access. Pure.
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;
using static ShramSafal.Domain.Tests.Planning.PlannedWorkTests;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlannedWorkVisibilityTests
{
    private static IReadOnlySet<Guid> Chosen(params Guid[] plots) => plots.ToHashSet();

    [Fact]
    public void The_primary_owner_sees_every_task_with_every_row()
    {
        var task = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB]));
        PlannedWorkVisibility.VisiblePlots(Seat(primary: true), task).Should().BeEquivalentTo([PlotA, PlotB]);
        PlannedWorkVisibility.VisiblePlots(Seat(primary: true), Make(Details(PlannedWorkScope.Farm))).Should().NotBeNull().And.BeEmpty();
    }

    [Fact]
    public void A_reminder_is_seen_by_its_maker_and_the_primary_owner_and_nobody_else_D79()
    {
        var reminder = Make();
        PlannedWorkVisibility.VisiblePlots(Seat(Creator), reminder).Should().NotBeNull("his own statement");
        PlannedWorkVisibility.VisiblePlots(Seat(primary: true), reminder).Should().NotBeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Stranger), reminder).Should().BeNull("an unrelated worker");
        PlannedWorkVisibility.VisiblePlots(Seat(Stranger, plan: true, assign: true), reminder).Should().BeNull("PlanWork and AssignWork are not a view");
    }

    [Fact]
    public void The_assignee_sees_the_task_and_a_headcount_gives_no_other_worker_access()
    {
        var crew = Make(Details(assignee: Raju, crew: "मुकादम आणि ५ बायका", headcount: 6));
        PlannedWorkVisibility.VisiblePlots(Seat(Raju), crew).Should().NotBeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Stranger), crew).Should().BeNull();
    }

    [Fact]
    public void SeeAllTasks_shows_everything_on_every_plot_to_a_seat_that_covers_every_plot()
    {
        var plotTask = Make(Details(assignee: Raju));
        var farmTask = Make(Details(PlannedWorkScope.Farm, assignee: Raju));
        PlannedWorkVisibility.VisiblePlots(Seat(seeAll: true), plotTask).Should().Equal(PlotA);
        PlannedWorkVisibility.VisiblePlots(Seat(seeAll: true), farmTask).Should().NotBeNull("an all-plots seat reads the farm's tasks");
        PlannedWorkVisibility.VisiblePlots(Seat(), plotTask).Should().BeNull("without it, no");
    }

    [Fact]
    public void An_inactive_seat_sees_nothing_even_as_the_creator()
    {
        PlannedWorkVisibility.VisiblePlots(Seat(Creator, active: false), Make()).Should().BeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Raju, active: false, seeAll: true), Make(Details(assignee: Raju))).Should().BeNull();
    }

    [Fact]
    public void A_chosen_plots_seat_sees_a_plot_task_only_with_one_of_his_plots_and_only_his_rows()
    {
        var both = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB], assignee: Raju));
        var onlyB = Make(Details(PlannedWorkScope.Plot, [PlotB], assignee: Raju));

        var seesA = Seat(seeAll: true, chosen: Chosen(PlotA));
        PlannedWorkVisibility.VisiblePlots(seesA, both).Should().Equal(PlotA);
        PlannedWorkVisibility.VisiblePlots(seesA, onlyB).Should().BeNull("none of its plots is his");
    }

    [Fact]
    public void A_chosen_plots_seat_sees_a_farm_or_unspecified_task_only_as_its_creator_or_assignee()
    {
        var farmTask = Make(Details(PlannedWorkScope.Farm, assignee: Raju));
        var unspecified = Make(Details(PlannedWorkScope.Unspecified, assignee: Raju));
        var chosen = Chosen(PlotA);

        PlannedWorkVisibility.VisiblePlots(Seat(seeAll: true, chosen: chosen), farmTask).Should().BeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(seeAll: true, chosen: chosen), unspecified).Should().BeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Raju, chosen: chosen), farmTask).Should().NotBeNull("he is the assignee");
        PlannedWorkVisibility.VisiblePlots(Seat(Creator, chosen: chosen), farmTask).Should().NotBeNull("he made it");
    }

    [Fact]
    public void An_assignee_on_chosen_plots_sees_his_plots_rows_and_no_task_that_is_not_on_his_plots()
    {
        var both = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB], assignee: Raju));
        var elsewhere = Make(Details(PlannedWorkScope.Plot, [PlotB], assignee: Raju));
        var seat = Seat(Raju, chosen: Chosen(PlotA));

        PlannedWorkVisibility.VisiblePlots(seat, both).Should().Equal(PlotA);
        PlannedWorkVisibility.VisiblePlots(seat, elsewhere).Should().BeNull("a task on another plot is not his, even assigned (MU design §11.6)");
    }

    [Fact]
    public void A_seat_without_the_grant_sees_only_what_he_made_or_was_given_whatever_his_label()
    {
        // A कामगार / स्वतःचं काम seat holds nothing by his label; the grant is the owner's explicit switch (like lab records).
        var plotTask = Make(Details(assignee: Raju));
        PlannedWorkVisibility.VisiblePlots(Seat(Stranger), plotTask).Should().BeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Raju), plotTask).Should().NotBeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Creator), plotTask).Should().NotBeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Stranger, seeAll: true), plotTask).Should().NotBeNull("switched on for him");
    }

    [Fact]
    public void A_cancelled_task_is_seen_by_the_same_people()
    {
        var task = Make(Details(assignee: Raju));
        task.Cancel(Creator, null, Now);
        PlannedWorkVisibility.VisiblePlots(Seat(Raju), task).Should().NotBeNull();
        PlannedWorkVisibility.VisiblePlots(Seat(Stranger), task).Should().BeNull();
    }

    [Fact]
    public void A_dropped_plot_row_is_never_a_visible_row()
    {
        var task = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB]));
        task.Edit(Details(PlannedWorkScope.Plot, [PlotB]), Now.AddMinutes(1));
        PlannedWorkVisibility.VisiblePlots(Seat(primary: true), task).Should().Equal(PlotB);
    }

    [Fact]
    public void The_old_assignee_is_told_to_forget_the_task_and_nobody_else_is()
    {
        var task = Make(Details(assignee: Raju));
        task.Edit(Details(assignee: Stranger), Now.AddMinutes(1));

        PlannedWorkVisibility.MustForget(Seat(Raju), task).Should().BeTrue("his phone holds it and may not any more");
        PlannedWorkVisibility.MustForget(Seat(Stranger), task).Should().BeFalse("he is the assignee now");
        PlannedWorkVisibility.MustForget(Seat(Creator), task).Should().BeFalse();
        PlannedWorkVisibility.MustForget(Seat(Guid.NewGuid()), task).Should().BeFalse("never held it: nothing to take back");
        PlannedWorkVisibility.MustForget(Seat(Raju, primary: true), task).Should().BeFalse("he still sees it");
    }
}
