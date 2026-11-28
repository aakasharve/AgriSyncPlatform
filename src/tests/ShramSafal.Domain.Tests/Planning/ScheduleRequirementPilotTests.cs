// spec: plr-d10 pilot lane NO-TRIAL (CTO ruling, 28 Nov 2026: nothing about the trial applies during the pilot) — the truth table of
// ScheduleRequirement.Decide with the trial rules OFF (Pilot:TrialEnforcementEnabled = false, PlanningFacts.TrialRulesApply = false),
// beside the same facts with them ON. The ON table itself is ScheduleRequirementTests (facts built with the default, which is ON).
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleRequirementPilotTests
{
    private static readonly DateTime Now = new(2026, 12, 20, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 12, 20);
    private static readonly FarmId Farm = new(Guid.NewGuid());
    private static readonly Guid Plot = Guid.NewGuid();
    private static readonly Guid Cycle = Guid.NewGuid();

    private static readonly TrialStanding Trialing = new(true, Now.AddDays(5), Now.AddDays(5));
    private static readonly TrialStanding TrialPastItsEnd = new(true, Now.AddDays(-9), Now.AddDays(-9)); // the job expires nothing in the pilot
    private static readonly TrialStanding Expired = new(false, Now.AddDays(-3), Now.AddDays(-3));
    private static readonly TrialStanding PastDue = new(false, null, Now.AddDays(4));
    private static readonly TrialStanding Paid = new(false, null, Now.AddDays(200), IsActive: true);
    private static readonly TrialStanding PaidPastItsEnd = new(false, null, Now.AddDays(-1), IsActive: true);

    private static readonly StageDefinitionDto[] Stages = [new("Pruning", 0, 9), new("Growth", 10, 39), new("Bloom", 40, 79)];

    private static ScheduleTemplateDto CheckedOutside(string crop = "Grapes") =>
        new(Guid.NewGuid(), "Checked " + crop, crop, 80, Stages, [], "h",
            OwnerType: "INSTITUTION", Check: new ScheduleCheckDto("Checked", null, null, null), HasStoredDays: true, Scope: "Public");

    private static ScheduleSubscription Follow(ScheduleTemplateDto template) =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(), Farm, Plot, Cycle, "grapes", new ScheduleTemplateId(template.Id), "v1", Now.AddDays(-30), null,
            ScheduleOrigin.Outside, ScheduleCheckState.Checked, 1);

    private static ScheduleOrigin? OriginOf(ScheduleTemplateDto t) => ScheduleOrigin.Outside;

    private static PlanningFacts Facts(
        TrialStanding? standing, IReadOnlyList<ScheduleTemplateDto> listing, IReadOnlyList<ScheduleSubscription>? followed = null,
        bool extension = false, bool noSeason = false, bool trialRules = true) =>
        new(Plot, noSeason ? null : new PlanningSeason(Cycle, "Grapes", Today.AddDays(-15)), Now, standing, extension,
            followed ?? [], listing, OriginOf, null, TrialRulesApply: trialRules);

    [Fact]
    public void Off_a_trialing_plot_following_a_schedule_is_not_in_trial_and_has_no_today_only_stage()
    {
        var uni = CheckedOutside();
        var on = ScheduleRequirement.Decide(Facts(Trialing, [uni], [Follow(uni)], trialRules: true));
        var off = ScheduleRequirement.Decide(Facts(Trialing, [uni], [Follow(uni)], trialRules: false));

        on.InTrial.Should().BeTrue("control: with the switch on the trial stands");
        on.TrialStage.Should().Be(new StageDefinition("Growth", 10, 39));

        off.InTrial.Should().BeFalse();
        off.TrialStage.Should().BeNull("every stage is open");
        off.FollowsAllowed.Should().BeTrue("a fact, unchanged");
        off.NeedsSchedule.Should().BeFalse();
    }

    public static IEnumerable<object[]> TheTrialsEnd() =>
    [
        ["expired", Expired, false],
        ["a Trialing row past its end", TrialPastItsEnd, false],
        ["an access extension", Trialing, true],
        ["no subscription row", null!, false],
        ["PastDue", PastDue, false],
        ["still in the trial", Trialing, false],
    ];

    [Theory]
    [MemberData(nameof(TheTrialsEnd))]
    public void Off_nothing_the_trial_causes_asks_for_a_schedule(string why, TrialStanding? standing, bool extension)
    {
        var facts = Facts(standing, [CheckedOutside()], extension: extension, trialRules: false);

        var off = ScheduleRequirement.Decide(facts);

        off.NeedsSchedule.Should().BeFalse(why);
        off.InTrial.Should().BeFalse(why);
        off.TrialStage.Should().BeNull(why);
        off.CanFollowSomething.Should().BeTrue("a fact, unchanged");
        off.FollowsAllowed.Should().BeFalse();
    }

    [Theory]
    [MemberData(nameof(TheTrialsEnd))]
    public void On_the_same_facts_decide_exactly_as_before(string why, TrialStanding? standing, bool extension)
    {
        var explicitOn = ScheduleRequirement.Decide(Facts(standing, [CheckedOutside()], extension: extension, trialRules: true));
        var defaultFacts = new PlanningFacts(Plot, new PlanningSeason(Cycle, "Grapes", Today.AddDays(-15)), Now, standing, extension,
            [], [CheckedOutside()], OriginOf, null);
        var byDefault = ScheduleRequirement.Decide(defaultFacts);

        explicitOn.Should().Be(byDefault, why);
        defaultFacts.TrialRulesApply.Should().BeTrue("a construction written before the switch keeps the trial rules");
        // the rule as it was: in the trial nothing asks; after it (expired, past its end, an extension, no row, PastDue) he must choose
        explicitOn.NeedsSchedule.Should().Be(why != "still in the trial", why);
    }

    [Fact]
    public void Off_a_paid_farm_following_nothing_is_still_asked_because_that_is_not_the_trial()
    {
        var off = ScheduleRequirement.Decide(Facts(Paid, [CheckedOutside()], trialRules: false));

        off.NeedsSchedule.Should().BeTrue("D-76 for a paying farm: its cause is the paid plan, not the trial's end");
        off.InTrial.Should().BeFalse();
    }

    [Fact]
    public void Off_a_paid_farm_is_not_asked_once_it_follows_once_nothing_can_be_followed_or_once_its_period_ended()
    {
        var uni = CheckedOutside();

        ScheduleRequirement.Decide(Facts(Paid, [uni], [Follow(uni)], trialRules: false)).NeedsSchedule.Should().BeFalse("it follows one");
        ScheduleRequirement.Decide(Facts(Paid, [CheckedOutside("Onion")], trialRules: false)).NeedsSchedule.Should().BeFalse("nothing for grapes");
        ScheduleRequirement.Decide(Facts(PaidPastItsEnd, [uni], trialRules: false)).NeedsSchedule.Should().BeFalse("past its paid period it is a time limit");
    }

    [Fact]
    public void On_IsActive_changes_nothing()
    {
        var uni = CheckedOutside();
        var unpaidAfter = ScheduleRequirement.Decide(Facts(new TrialStanding(false, null, Now.AddDays(200)), [uni], trialRules: true));
        var paidAfter = ScheduleRequirement.Decide(Facts(Paid, [uni], trialRules: true));

        paidAfter.Should().Be(unpaidAfter, "with the switch on the old rule never read the new field");
        new TrialStanding(true, Now, Now).IsActive.Should().BeFalse("optional and last");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_plot_with_no_crop_season_is_never_asked_in_either_mode(bool trialRules)
    {
        var state = ScheduleRequirement.Decide(Facts(Expired, [CheckedOutside()], noSeason: true, trialRules: trialRules));

        state.NeedsSchedule.Should().BeFalse();
        state.InTrial.Should().BeFalse();
    }
}
