using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-GATE-a Task 1 (D-83 = 1, D-82 = 3, D-91 = 1, R6, R7, R9, R10).
/// The truth table of <see cref="ScheduleRequirement.Decide"/>: pure, so every row of the plan's table is one fact here.
/// "After the trial" = the owner account's subscription is not Trialing (or its end has passed), or an access extension is on (R9).
/// </summary>
public sealed class ScheduleRequirementTests
{
    private static readonly DateTime Now = new(2026, 11, 9, 6, 0, 0, DateTimeKind.Utc); // 11:30 IST, 2026-11-09
    private static readonly DateOnly Today = new(2026, 11, 9);
    private static readonly FarmId Farm = new(Guid.NewGuid());
    private static readonly Guid Plot = Guid.NewGuid();
    private static readonly Guid Cycle = Guid.NewGuid();

    private static readonly TrialStanding Trialing = new(true, Now.AddDays(5), Now.AddDays(5));
    private static readonly TrialStanding Expired = new(false, Now.AddDays(-3), Now.AddDays(-3));
    private static readonly TrialStanding Paid = new(false, null, Now.AddDays(200));

    // ---- schedules as the caller's listing carries them -------------------------------------------------------

    private static readonly StageDefinitionDto[] Stages =
    [
        new("Pruning", 0, 9), new("Growth", 10, 39), new("Bloom", 40, 79),
    ];

    /// <summary>A Public row that stores its days and ShramSafal has checked (an Institution one by default).</summary>
    private static ScheduleTemplateDto CheckedOutside(string crop = "Grapes", string owner = "INSTITUTION", string state = "Checked") =>
        new(Guid.NewGuid(), "Checked " + crop, crop, 80, Stages, [], "h",
            OwnerType: owner, Check: new ScheduleCheckDto(state, null, null, null), HasStoredDays: true, Scope: "Public");

    /// <summary>A built-in sample (no scope, no stored days): listed NotChecked.</summary>
    private static ScheduleTemplateDto BuiltInSample(string crop = "Grapes") =>
        new(Guid.NewGuid(), "Sample " + crop, crop, 60, [], [], "h", Check: new ScheduleCheckDto("NotChecked", null, null, null));

    /// <summary>His own schedule (a Team row of his farm's owner): never has a check.</summary>
    private static ScheduleTemplateDto OwnRow(bool storedDays, string crop = "Grapes") =>
        new(Guid.NewGuid(), "Mine " + crop, crop, 80, storedDays ? Stages : [], [], "h",
            OwnerType: "USER", Check: new ScheduleCheckDto("NotChecked", null, null, null), HasStoredDays: storedDays, Scope: "Team");

    private static ScheduleSubscription Follow(ScheduleTemplateDto template, ScheduleOrigin origin, short slot, DateOnly? day0 = null) =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(), Farm, Plot, Cycle, "grapes", new ScheduleTemplateId(template.Id), "v1", Now.AddDays(-30), day0,
            origin, origin == ScheduleOrigin.Own ? null : ScheduleCheckState.Checked, slot);

    /// <summary>The origin the caller's farm gives a listed row: Public or built-in is Outside, a Team row is his own.</summary>
    private static ScheduleOrigin? OriginOf(ScheduleTemplateDto t) =>
        t.Scope is null or "Public" ? ScheduleOrigin.Outside : t.Scope == "Team" ? ScheduleOrigin.Own : null;

    private static PlanningFacts Facts(
        TrialStanding? standing,
        IReadOnlyList<ScheduleTemplateDto> listing,
        IReadOnlyList<ScheduleSubscription>? followed = null,
        bool extension = false,
        PlanningSeason? season = null,
        bool noSeason = false) =>
        new(Plot,
            noSeason ? null : season ?? new PlanningSeason(Cycle, "Grapes", Today.AddDays(-15)),
            Now, standing, extension, followed ?? [], listing, OriginOf);

    // ---- the plan's table -------------------------------------------------------------------------------------

    [Fact]
    public void Trialing_with_no_schedule_is_in_trial_and_nothing_asks()
    {
        var state = ScheduleRequirement.Decide(Facts(Trialing, [CheckedOutside()]));

        Assert.True(state.InTrial);
        Assert.False(state.NeedsSchedule);
        Assert.False(state.FollowsAllowed);
        Assert.True(state.CanFollowSomething);
        Assert.Equal(Cycle, state.CropCycleId);
    }

    [Fact]
    public void Trialing_with_a_checked_schedule_gives_todays_stage_of_the_main_schedule()
    {
        var university = CheckedOutside();
        var state = ScheduleRequirement.Decide(Facts(
            Trialing, [university], [Follow(university, ScheduleOrigin.Outside, 1)])); // today = day 15 -> Growth (10-39)

        Assert.True(state.InTrial);
        Assert.Equal(new StageDefinition("Growth", 10, 39), state.TrialStage);
        Assert.True(state.FollowsAllowed);
    }

    [Fact]
    public void A_stage_ending_inside_the_trial_gives_the_next_one()
    {
        var university = CheckedOutside();
        var followed = new[] { Follow(university, ScheduleOrigin.Outside, 1) };

        // day 39 = the last day of Growth; the next day (40) is Bloom: the trial shows the stage that holds TODAY.
        var lastDay = ScheduleRequirement.Decide(Facts(Trialing, [university], followed,
            season: new PlanningSeason(Cycle, "Grapes", Today.AddDays(-39))));
        var nextDay = ScheduleRequirement.Decide(Facts(Trialing, [university], followed,
            season: new PlanningSeason(Cycle, "Grapes", Today.AddDays(-40))));

        Assert.Equal("Growth", lastDay.TrialStage!.Name);
        Assert.Equal(new StageDefinition("Bloom", 40, 79), nextDay.TrialStage);
    }

    [Fact]
    public void The_trial_stage_counts_from_the_plots_own_day_zero_when_one_was_set()
    {
        var university = CheckedOutside();
        var state = ScheduleRequirement.Decide(Facts(
            Trialing, [university], [Follow(university, ScheduleOrigin.Outside, 1, day0: Today.AddDays(-45))]));

        Assert.Equal("Bloom", state.TrialStage!.Name);
    }

    [Fact]
    public void No_trial_stage_when_the_main_schedule_stores_no_stages_or_today_is_in_none()
    {
        var sample = BuiltInSample();
        var university = CheckedOutside();

        var onSample = ScheduleRequirement.Decide(Facts(Trialing, [sample], [Follow(sample, ScheduleOrigin.Outside, 1)]));
        var afterTheEnd = ScheduleRequirement.Decide(Facts(Trialing, [university], [Follow(university, ScheduleOrigin.Outside, 1)],
            season: new PlanningSeason(Cycle, "Grapes", Today.AddDays(-200))));
        var notFollowing = ScheduleRequirement.Decide(Facts(Trialing, [university]));

        Assert.Null(onSample.TrialStage);
        Assert.Null(afterTheEnd.TrialStage);
        Assert.Null(notFollowing.TrialStage);
    }

    [Fact]
    public void After_the_trial_there_is_no_trial_stage()
    {
        var university = CheckedOutside();
        var state = ScheduleRequirement.Decide(Facts(Paid, [university], [Follow(university, ScheduleOrigin.Outside, 1)]));

        Assert.Null(state.TrialStage);
    }

    [Fact]
    public void Expired_with_no_schedule_and_a_checked_schedule_for_the_crop_needs_a_schedule()
    {
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside()]));

        Assert.False(state.InTrial);
        Assert.False(state.FollowsAllowed);
        Assert.True(state.CanFollowSomething);
        Assert.True(state.NeedsSchedule);
    }

    [Fact]
    public void No_checked_schedule_no_sample_and_no_own_schedule_nothing_asks()
    {
        // The library holds only another crop's checked schedule and an own schedule without stored days: nothing for grapes.
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside("Onion"), OwnRow(storedDays: false)]));

        Assert.False(state.InTrial);
        Assert.False(state.CanFollowSomething);
        Assert.False(state.NeedsSchedule);
    }

    [Fact]
    public void An_access_extension_reads_as_after_the_trial()
    {
        var expiredWithExtension = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside()], extension: true));
        var trialingWithExtension = ScheduleRequirement.Decide(Facts(Trialing, [CheckedOutside()], extension: true));

        Assert.False(expiredWithExtension.InTrial);
        Assert.True(expiredWithExtension.NeedsSchedule);
        Assert.False(trialingWithExtension.InTrial);
        Assert.True(trialingWithExtension.NeedsSchedule);
    }

    [Fact]
    public void A_paid_farm_following_a_checked_schedule_is_asked_nothing()
    {
        var university = CheckedOutside();
        var state = ScheduleRequirement.Decide(Facts(Paid, [university], [Follow(university, ScheduleOrigin.Outside, 1)]));

        Assert.False(state.InTrial);
        Assert.True(state.FollowsAllowed);
        Assert.False(state.NeedsSchedule);
    }

    [Fact]
    public void Own_only_with_stored_days_is_satisfied_without_a_check()
    {
        var mine = OwnRow(storedDays: true);
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside(), mine], [Follow(mine, ScheduleOrigin.Own, 0)]));

        Assert.True(state.FollowsAllowed);
        Assert.False(state.NeedsSchedule);
    }

    [Fact]
    public void Own_only_without_stored_days_is_not_followed()
    {
        var mine = OwnRow(storedDays: false);
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside(), mine], [Follow(mine, ScheduleOrigin.Own, 0)]));

        Assert.False(state.FollowsAllowed);
        Assert.True(state.NeedsSchedule);
    }

    [Fact]
    public void A_sample_on_a_crop_with_no_checked_schedule_is_followable_and_followed()
    {
        var sample = BuiltInSample();

        var notYetFollowed = ScheduleRequirement.Decide(Facts(Expired, [sample]));
        var followed = ScheduleRequirement.Decide(Facts(Expired, [sample], [Follow(sample, ScheduleOrigin.Outside, 1)]));

        Assert.True(notYetFollowed.CanFollowSomething);
        Assert.True(notYetFollowed.NeedsSchedule);
        Assert.True(followed.FollowsAllowed);
        Assert.False(followed.NeedsSchedule);
    }

    [Fact]
    public void A_sample_kept_from_before_still_counts_as_followed_after_a_checked_one_arrives()
    {
        var sample = BuiltInSample();
        var university = CheckedOutside();

        // The pull lists the kept sample as a followed extra next to the new checked schedule (R7).
        var state = ScheduleRequirement.Decide(Facts(Expired, [university, sample], [Follow(sample, ScheduleOrigin.Outside, 1)]));

        Assert.True(state.FollowsAllowed);
        Assert.False(state.NeedsSchedule);
    }

    // ---- mine -------------------------------------------------------------------------------------------------

    [Fact]
    public void A_Trialing_row_past_its_end_is_after_the_trial()
    {
        // The daily job that expires it may be up to a day late: the clock decides first.
        var late = new TrialStanding(true, Now.AddHours(-1), Now.AddHours(-1));
        var noEndDate = new TrialStanding(true, null, Now.AddHours(-1));

        Assert.False(ScheduleRequirement.Decide(Facts(late, [CheckedOutside()])).InTrial);
        Assert.True(ScheduleRequirement.Decide(Facts(late, [CheckedOutside()])).NeedsSchedule);
        Assert.False(ScheduleRequirement.Decide(Facts(noEndDate, [CheckedOutside()])).InTrial);
        Assert.True(ScheduleRequirement.Decide(Facts(new TrialStanding(true, null, Now.AddHours(1)), [CheckedOutside()])).InTrial);
    }

    [Fact]
    public void No_subscription_row_is_after_the_trial()
    {
        var state = ScheduleRequirement.Decide(Facts(null, [CheckedOutside()]));

        Assert.False(state.InTrial);
        Assert.True(state.NeedsSchedule);
    }

    [Fact]
    public void An_own_schedule_that_adopt_cannot_take_yet_makes_nothing_ask()
    {
        // ChooseAsync answers OwnScheduleNotOpenYet for the Own branch (SCH-OWN opens it): the gate must not ask him to choose
        // something the server would refuse (P5). The same predicate answers both.
        var mine = OwnRow(storedDays: true);
        var state = ScheduleRequirement.Decide(Facts(Expired, [mine]));

        Assert.False(state.CanFollowSomething);
        Assert.False(state.NeedsSchedule);
        Assert.False(ScheduleLibrary.NewChoiceOpen(ScheduleOrigin.Own, isBuiltIn: false, hasStoredDays: true, ScheduleCheckState.NotChecked, cropHasChecked: false));
    }

    [Fact]
    public void A_followed_schedule_whose_check_was_withdrawn_still_counts_as_followed()
    {
        var withdrawn = CheckedOutside(state: "Withdrawn");
        var state = ScheduleRequirement.Decide(Facts(Expired, [withdrawn], [Follow(withdrawn, ScheduleOrigin.Outside, 1)]));

        Assert.True(state.FollowsAllowed);
        Assert.False(state.NeedsSchedule);
        // and a withdrawn schedule is never something NEW to choose
        Assert.False(ScheduleRequirement.Decide(Facts(Expired, [withdrawn])).CanFollowSomething);
    }

    [Fact]
    public void A_plot_with_no_crop_season_never_asks()
    {
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside()], noSeason: true));

        Assert.Null(state.CropCycleId);
        Assert.False(state.CanFollowSomething);
        Assert.False(state.FollowsAllowed);
        Assert.False(state.NeedsSchedule);
        Assert.False(state.InTrial);
    }

    [Fact]
    public void Only_a_schedule_of_the_plots_crop_counts()
    {
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside("Onion")]));

        Assert.False(state.CanFollowSomething);
        Assert.False(state.NeedsSchedule);
    }

    [Fact]
    public void A_row_followed_on_an_older_season_does_not_satisfy_the_current_one()
    {
        var university = CheckedOutside();
        var olderSeason = ScheduleSubscription.Adopt(
            Guid.NewGuid(), Farm, Plot, Guid.NewGuid(), "grapes", new ScheduleTemplateId(university.Id), "v1", Now.AddDays(-400),
            null, ScheduleOrigin.Outside, ScheduleCheckState.Checked, 1);

        var state = ScheduleRequirement.Decide(Facts(Expired, [university], [olderSeason]));

        Assert.False(state.FollowsAllowed);
        Assert.True(state.NeedsSchedule);
    }

    // ---- the one "a new choice is open" predicate (shared with ChooseAsync) -----------------------------------

    [Theory]
    [InlineData(ScheduleCheckState.Checked, false, true)]   // a checked outside schedule is open even if the crop has others
    [InlineData(ScheduleCheckState.NotChecked, false, false)] // a stored-days row waiting for its check is not
    [InlineData(ScheduleCheckState.Returned, false, false)]
    [InlineData(ScheduleCheckState.Withdrawn, false, false)]
    public void A_stored_days_outside_row_is_open_only_when_checked(ScheduleCheckState live, bool cropHasChecked, bool expected)
    {
        Assert.Equal(expected, ScheduleLibrary.NewChoiceOpen(ScheduleOrigin.Outside, isBuiltIn: false, hasStoredDays: true, live, cropHasChecked));
    }

    [Theory]
    [InlineData(true, false, false, true)]   // a built-in sample, crop has no checked schedule
    [InlineData(true, false, true, false)]   // ... once the crop has one, it is not open (D-91 = 1)
    [InlineData(false, false, false, true)]  // a Public row without stored days is a sample too
    [InlineData(false, false, true, false)]
    public void A_sample_is_open_exactly_while_its_crop_has_no_checked_schedule(bool isBuiltIn, bool hasStoredDays, bool cropHasChecked, bool expected)
    {
        Assert.Equal(expected, ScheduleLibrary.NewChoiceOpen(ScheduleOrigin.Outside, isBuiltIn, hasStoredDays, ScheduleCheckState.NotChecked, cropHasChecked));
    }

    [Fact]
    public void A_row_the_plots_farm_may_not_follow_is_never_open()
    {
        Assert.False(ScheduleLibrary.NewChoiceOpen(null, isBuiltIn: false, hasStoredDays: true, ScheduleCheckState.Checked, cropHasChecked: false));
    }

    // ---- the gate is read by the pull and the stage plan only (D-83 = 1) --------------------------------------

    [Fact]
    public void ScheduleRequirement_is_read_only_by_the_pull_and_the_stage_plan()
    {
        var root = SourceRoot();
        var allowed = new[]
        {
            Path.Combine("ShramSafal.Application", "Services", "ScheduleRequirement.cs"),
            Path.Combine("ShramSafal.Application", "Services", "ScheduleStagePlan.cs"),
            Path.Combine("ShramSafal.Application", "UseCases", "Sync", "PullSyncChanges", "PullSyncChangesHandler.cs"),
            Path.Combine("ShramSafal.Api", "DependencyInjection.cs"),
        }.Select(p => Path.GetFullPath(Path.Combine(root, p))).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var namingIt = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .Where(f => File.ReadAllText(f).Contains("ScheduleRequirement", StringComparison.Ordinal))
            .Select(Path.GetFullPath)
            .ToList();

        var strangers = namingIt.Where(f => !allowed.Contains(f)).Select(f => Path.GetRelativePath(root, f)).ToList();
        Assert.True(strangers.Count == 0,
            "These files name ScheduleRequirement; a record door, attendance, cost entry or any push case must never ask it "
            + "(D-83 = 1: capture never waits for a schedule): " + string.Join(", ", strangers));
        Assert.True(namingIt.Count >= 3, "The guard found too few files: it may be scanning the wrong place.");
    }

    [Fact]
    public void ScheduleStagePlan_is_read_only_by_its_route_and_the_gate()
    {
        // The stage plan calls the gate, so a record door that took it would reach the gate by the back (SCH-GATE-a review L003).
        var root = SourceRoot();
        var allowed = new[]
        {
            Path.Combine("ShramSafal.Application", "Services", "ScheduleStagePlan.cs"),
            Path.Combine("ShramSafal.Application", "Services", "ScheduleRequirement.cs"),
            Path.Combine("ShramSafal.Api", "Endpoints", "PlanningEndpoints.cs"),
            Path.Combine("ShramSafal.Api", "DependencyInjection.cs"),
        }.Select(p => Path.GetFullPath(Path.Combine(root, p))).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var namingIt = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .Where(f => File.ReadAllText(f).Contains("ScheduleStagePlan", StringComparison.Ordinal))
            .Select(Path.GetFullPath)
            .ToList();

        var strangers = namingIt.Where(f => !allowed.Contains(f)).Select(f => Path.GetRelativePath(root, f)).ToList();
        Assert.True(strangers.Count == 0,
            "These files name ScheduleStagePlan, which reads the gate; a record door must never ask it (D-83 = 1): " + string.Join(", ", strangers));
        Assert.True(namingIt.Count >= 3, "The guard found too few files: it may be scanning the wrong place.");
    }

    private static string SourceRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "apps", "ShramSafal");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate apps/ShramSafal from the test execution directory.");
    }
}
