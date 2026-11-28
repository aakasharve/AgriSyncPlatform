// spec: plr-d10 pilot lane NO-TRIAL (CTO ruling, 28 Nov 2026: nothing about the trial applies during the pilot - no farm is blocked,
// limited or warned by it). The schedule trial rules (D-76 / R9 / R10) with Pilot:TrialEnforcementEnabled = false, the shipped default.
//
// Real Postgres as agrisync_app (E3 first), through the real host, the real pull and the real stage-plan route; the owner account and
// its subscription are arranged as superuser. With the switch ON the same arrangements are the existing SCH-GATE suites
// (PlotPlanningStatePullRealPostgresTests, StagePlanReadRealPostgresTests), whose host defaults the switch on. Fake phone numbers only.
using System;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PilotNoTrialScheduleRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    protected override bool TrialEnforcementEnabled => false;

    private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd");

    private async Task<JsonElement> StagePlanOkAsync(Guid plot, string? forDate = null)
    {
        var (status, body) = await StagePlanAsync(Owner, FarmA, plot, forDate);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    [Fact]
    public async Task A_farm_in_its_trial_is_not_in_trial_and_every_stage_is_open()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(10), DateTime.UtcNow.AddDays(10));
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        await PushAdoptAsync(Owner, plot, cycle, uni.Id);

        var (body, root) = await PullAsync(Owner);
        KeepGateBody("pilot-owner-in-trial", body);
        var state = StateOf(root, plot)!.Value;
        Output.WriteLine($"[EVIDENCE] pilot, Trialing, followed: {state}");
        state.GetProperty("inTrial").GetBoolean().Should().BeFalse("no plot is in its trial during the pilot");
        state.GetProperty("trialStage").ValueKind.Should().Be(JsonValueKind.Null, "no today-only stage");
        state.GetProperty("followsAllowed").GetBoolean().Should().BeTrue();
        state.GetProperty("needsSchedule").GetBoolean().Should().BeFalse();
        StateOf(root, PlotA)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeFalse("a plot following nothing is not asked either");

        // The stage plan honours the date asked: day 2 is "Post Pruning" (with the switch on, the trial answers today's "Canopy Build").
        var plan = await StagePlanOkAsync(plot, Day(TodayIst().AddDays(-18)));
        plan.GetProperty("stage").GetProperty("name").GetString().Should().Be("Post Pruning", "every stage is open in the pilot");
        plan.GetProperty("stage").GetProperty("dayToday").GetInt32().Should().Be(20);
        plan.GetProperty("needsSchedule").GetBoolean().Should().BeFalse();
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("trial-past-its-end")]
    [InlineData("extension")]
    public async Task The_trials_end_never_asks_for_a_schedule(string standing)
    {
        await AssertAppRoleIsNotVacuousAsync();
        switch (standing)
        {
            case "expired":
                await SetStandingAsync(AccountA, Owner, Expired, DateTime.UtcNow.AddDays(-9), DateTime.UtcNow.AddDays(-9));
                break;
            case "trial-past-its-end": // the nightly job expires nothing in the pilot, so the row stays Trialing past day 21
                await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(-9), DateTime.UtcNow.AddDays(-9));
                break;
            default: // R9: with the switch on an extension reads as AFTER the trial
                await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(10), DateTime.UtcNow.AddDays(10));
                await SetExtensionAsync(AccountA, DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(30));
                break;
        }

        await CheckedInstitutionAsync(); // something to follow exists for grapes

        var (body, root) = await PullAsync(Owner);
        KeepGateBody($"pilot-owner-{standing}", body);
        var state = StateOf(root, PlotA)!.Value;
        Output.WriteLine($"[EVIDENCE] pilot, {standing}, nothing followed: {state}");
        state.GetProperty("canFollowSomething").GetBoolean().Should().BeTrue("the precondition: with the switch on this plot would be asked");
        state.GetProperty("followsAllowed").GetBoolean().Should().BeFalse();
        state.GetProperty("needsSchedule").GetBoolean().Should().BeFalse("the trial's end asks nothing in the pilot");
        state.GetProperty("inTrial").GetBoolean().Should().BeFalse();

        var plan = await StagePlanOkAsync(PlotA);
        plan.GetProperty("needsSchedule").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task A_paid_farm_following_nothing_is_still_asked_because_that_is_not_the_trial()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));
        await CheckedInstitutionAsync();

        var state = StateOf((await PullAsync(Owner)).Root, PlotA)!.Value;

        state.GetProperty("needsSchedule").GetBoolean().Should().BeTrue("D-76 for a paying farm is kept: its cause is the paid plan, not the trial's end");
        state.GetProperty("inTrial").GetBoolean().Should().BeFalse();
    }
}
