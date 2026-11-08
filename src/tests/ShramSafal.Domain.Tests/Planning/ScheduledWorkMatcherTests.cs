using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — "Before trusting its overdue counts,
/// fix how scheduled work is matched to completed records." The matcher's rules, one fact per test: work
/// recorded on its day (or within the documented tolerance) is NOT overdue; work not recorded IS overdue; one
/// record meets one step; kind of work, not exact wording; dates are the farmer's work days.
/// </summary>
public sealed class ScheduledWorkMatcherTests
{
    private static readonly DateOnly Today = new(2026, 10, 30);
    private static readonly Guid Cycle = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static PlannedActivity Step(string name, int dayOffset) =>
        PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), Cycle, name, "Fruiting", Today.AddDays(dayOffset),
            new UserId(Guid.NewGuid()), "test", new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc));

    private static RecordedWork Did(string type, int dayOffset, ExecutionStatus status = ExecutionStatus.Completed, bool disputed = false) =>
        new(type, Today.AddDays(dayOffset), status, disputed);

    private static ScheduledWorkStatus Only(IReadOnlyList<ScheduledWorkStatus> result)
    {
        Assert.Single(result);
        return result[0];
    }

    [Fact]
    public void Work_recorded_on_the_scheduled_day_is_not_overdue()
    {
        var result = ScheduledWorkMatcher.Match([Step("Foliar Spray", -2)], [Did("Spray Mancozeb", -2)], Today);
        Assert.Equal(ScheduledWorkState.Done, Only(result).State);
    }

    [Theory]
    [InlineData(-3)] // three days early
    [InlineData(3)]  // three days late
    [InlineData(1)]
    public void Work_recorded_within_the_on_time_tolerance_is_not_overdue(int daysFromPlan)
    {
        Assert.Equal(3, ScheduledWorkMatcher.OnTimeToleranceDays);
        var result = ScheduledWorkMatcher.Match([Step("Drip Irrigation", -5)], [Did("Irrigation", -5 + daysFromPlan)], Today);
        Assert.Equal(ScheduledWorkState.Done, Only(result).State);
    }

    [Fact]
    public void Work_not_recorded_is_overdue_with_its_days_late()
    {
        var result = Only(ScheduledWorkMatcher.Match([Step("Foliar Spray", -1)], [], Today));
        Assert.Equal(ScheduledWorkState.Overdue, result.State);
        Assert.Equal(1, result.DaysLate);
    }

    [Fact]
    public void A_step_planned_for_today_and_not_yet_recorded_is_due_today_not_overdue()
    {
        var result = Only(ScheduledWorkMatcher.Match([Step("Foliar Spray", 0)], [], Today));
        Assert.Equal(ScheduledWorkState.DueToday, result.State);
        Assert.Equal(0, result.DaysLate);
    }

    [Fact]
    public void One_record_meets_one_step_never_every_step_of_the_same_name()
    {
        // The old rule: one "Spray" in the cycle cleared EVERY planned spray of the season.
        var early = Step("Foliar Spray", -10);
        var recent = Step("Foliar Spray", -3);
        var result = ScheduledWorkMatcher.Match([early, recent], [Did("Spray Sulphur", -3)], Today);

        Assert.Equal(ScheduledWorkState.Done, result.Single(r => r.Planned.Id == recent.Id).State);
        var missed = result.Single(r => r.Planned.Id == early.Id);
        Assert.Equal(ScheduledWorkState.Overdue, missed.State);
        Assert.Equal(10, missed.DaysLate);
    }

    [Fact]
    public void A_step_keeps_the_record_made_on_its_own_day_closest_pairs_first()
    {
        var a = Step("Foliar Spray", -6);
        var b = Step("Foliar Spray", -4);
        // one record, two days after A and ON B's day: it is B's.
        var result = ScheduledWorkMatcher.Match([a, b], [Did("Spray", -4)], Today);
        Assert.Equal(ScheduledWorkState.Done, result.Single(r => r.Planned.Id == b.Id).State);
        Assert.Equal(ScheduledWorkState.Overdue, result.Single(r => r.Planned.Id == a.Id).State);
    }

    [Fact]
    // lane WORK-ID (D-104a): the record was "Fertilizer Urea" before; urea is not the planned 19:19:19, so it no longer
    // clears that line (the lateness rule this test pins is unchanged - the record now names the planned grade).
    public void Work_recorded_late_still_clears_the_step()
    {
        var result = ScheduledWorkMatcher.Match([Step("Fertigation 19:19:19", -12)], [Did("Fertilizer 19:19:19", -2)], Today);
        Assert.Equal(ScheduledWorkState.Done, Only(result).State);
    }

    [Fact]
    public void Work_done_well_before_the_window_does_not_clear_a_later_step()
    {
        var result = ScheduledWorkMatcher.Match([Step("Foliar Spray", -2)], [Did("Spray", -9)], Today);
        Assert.Equal(ScheduledWorkState.Overdue, Only(result).State);
    }

    [Fact]
    public void Other_work_of_the_catch_all_kind_does_not_clear_a_step()
    {
        var result = ScheduledWorkMatcher.Match([Step("Pruning", -1)], [Did("Weeding", -1)], Today);
        Assert.Equal(ScheduledWorkState.Overdue, Only(result).State);

        var same = ScheduledWorkMatcher.Match([Step("Pruning", -1)], [Did("pruning", -1)], Today);
        Assert.Equal(ScheduledWorkState.Done, Only(same).State);
    }

    [Theory]
    [InlineData(ExecutionStatus.Skipped, false, "Spray")]
    [InlineData(ExecutionStatus.Delayed, false, "Spray")]
    [InlineData(ExecutionStatus.Completed, true, "Spray")]     // the owner disputed the record
    [InlineData(ExecutionStatus.Completed, false, "Reminder")] // a mirrored note, not work
    public void Skipped_delayed_disputed_and_note_rows_are_not_work_done(ExecutionStatus status, bool disputed, string type)
    {
        var result = ScheduledWorkMatcher.Match([Step("Foliar Spray", -1)], [Did(type, -1, status, disputed)], Today);
        Assert.Equal(ScheduledWorkState.Overdue, Only(result).State);
    }

    [Fact]
    public void Partial_and_modified_work_count_as_done()
    {
        var result = ScheduledWorkMatcher.Match(
            [Step("Foliar Spray", -1), Step("Drip Irrigation", -1)],
            [Did("Spray", -1, ExecutionStatus.Partial), Did("Irrigation", -1, ExecutionStatus.Modified)],
            Today);
        Assert.All(result, r => Assert.Equal(ScheduledWorkState.Done, r.State));
    }

    [Fact]
    public void Future_steps_are_not_listed_and_cannot_take_a_record()
    {
        var past = Step("Foliar Spray", -2);
        var future = Step("Foliar Spray", 1);
        var result = ScheduledWorkMatcher.Match([past, future], [Did("Spray", -1)], Today);

        var listed = Assert.Single(result);
        Assert.Equal(past.Id, listed.Planned.Id);
        Assert.Equal(ScheduledWorkState.Done, listed.State);
    }

    [Fact]
    public void A_record_dated_after_today_is_ignored()
    {
        var result = ScheduledWorkMatcher.Match([Step("Foliar Spray", 0)], [Did("Spray", 1)], Today);
        Assert.Equal(ScheduledWorkState.DueToday, Only(result).State);
    }

    [Fact]
    public void A_removed_step_is_never_listed()
    {
        var removed = Step("Foliar Spray", -1);
        removed.SoftRemove(new UserId(Guid.NewGuid()), "not needed", new DateTime(2026, 10, 29, 0, 0, 0, DateTimeKind.Utc));
        Assert.Empty(ScheduledWorkMatcher.Match([removed], [], Today));
    }

    // ---- lane WORK-ID: one matcher, words in either language (D-77) ----

    [Fact]
    public void Marathi_spray_record_meets_a_planned_foliar_spray()
    {
        var result = ScheduledWorkMatcher.Match([Step("Foliar Spray", -1)], [Did("आज औषध मारलं", -1), Did("फवारणी", -1)], Today);
        Assert.Equal(ScheduledWorkState.Done, Only(result).State);
        Assert.True(ScheduledWorkMatcher.SameWork("Foliar Spray", "फवारणी"));
    }

    [Fact]
    public void Spray_carrier_water_never_clears_an_irrigation_step()
    {
        var result = ScheduledWorkMatcher.Match([Step("Drip Irrigation", -1)], [Did("फवारणीसाठी पाणी आणलं", -1)], Today);
        Assert.Equal(ScheduledWorkState.Overdue, Only(result).State);
        Assert.False(ScheduledWorkMatcher.SameWork("Irrigation", "Spray water 1000 L"));
    }

    [Fact]
    public void Weeding_never_clears_pruning_in_either_language()
    {
        Assert.Equal(ScheduledWorkState.Overdue, Only(ScheduledWorkMatcher.Match([Step("छाटणी", -1)], [Did("खुरपणी", -1)], Today)).State);
        Assert.Equal(ScheduledWorkState.Overdue, Only(ScheduledWorkMatcher.Match([Step("खुरपणी", -1)], [Did("Pruning", -1)], Today)).State);
        Assert.Equal(ScheduledWorkState.Done, Only(ScheduledWorkMatcher.Match([Step("खुरपणी", -1)], [Did("निंदणी", -1)], Today)).State);
    }

    [Fact]
    public void A_fungicide_spray_never_clears_an_insecticide_line()
    {
        Assert.Equal(ScheduledWorkState.Overdue,
            Only(ScheduledWorkMatcher.Match([Step("कीटकनाशक फवारणी", -1)], [Did("Spray Mancozeb", -1)], Today)).State);
        Assert.Equal(ScheduledWorkState.Done,
            Only(ScheduledWorkMatcher.Match([Step("बुरशीनाशक फवारणी", -1)], [Did("Spray Mancozeb", -1)], Today)).State);
    }

    [Fact]
    public void Names_nobody_can_recognise_still_meet_by_their_own_words_as_before()
    {
        Assert.True(ScheduledWorkMatcher.SameWork("Staking", "Staking vines"));
        Assert.False(ScheduledWorkMatcher.SameWork("Staking", "Soil test"));
        Assert.False(ScheduledWorkMatcher.SameWork("Staking", "Spray"));
    }

    [Fact]
    public void Two_unrecognised_names_meet_only_the_old_way()
    {
        // R12: words nobody can recognise are never counted as anything else - no close-spelling guess.
        Assert.Null(WorkRecogniser.Recognise("Stakng"));
        Assert.Null(WorkRecogniser.Recognise("Staking"));
        var near = WorkRecogniser.SameWork("Stakng", "Staking");
        Assert.False(near.Matched);
        Assert.Equal("not-recognised-different-name", near.ReasonKey);

        // the old base rule still holds: one name containing the other
        Assert.Null(WorkRecogniser.Recognise("Staking vines"));
        var contained = WorkRecogniser.SameWork("Staking", "Staking vines");
        Assert.True(contained.Matched);
        Assert.Equal("not-recognised-same-name", contained.ReasonKey);
    }
}
