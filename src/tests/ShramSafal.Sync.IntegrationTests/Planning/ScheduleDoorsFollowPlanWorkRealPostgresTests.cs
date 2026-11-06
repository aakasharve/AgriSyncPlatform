// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 fix round 1 (review M2, L11; founder D-73).
//
// D-73: planning changes are the primary owner's, "plus the people you give 'कामाचं नियोजन करणे'". Five gated doors had no
// fact that fails when their gate call is removed (the old facts used a कामगार, whom the old मुकादम-or-above rule refused
// too, or an owner): migrate, abandon, complete, remove a planned step, and /plan/generate. Here each refuses the मुकादम
// LABEL (a seat the owner gave no PlanWork) and lets the same seat in once PlanWork is given — so removing a gate call, or
// putting the label rule back, turns that door's fact red (proved by a run with all five gate calls taken out: five reds). L11: complete's state change is really kept (it answered success and
// wrote nothing while its read was untracked). Real Postgres as agrisync_app (E3 first), through the real host.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleDoorsFollowPlanWorkRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    private Task<(HttpStatusCode Status, string Body)> MigrateAsync(Guid who, Guid plot, Guid cycle, Guid to) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot}/cycles/{cycle}/schedule/migrate", who,
            new { farmId = FarmA, newScheduleTemplateId = to, reason = "BetterFit" });

    private Task<(HttpStatusCode Status, string Body)> AbandonAsync(Guid who, Guid plot, Guid cycle) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot}/cycles/{cycle}/schedule/abandon", who,
            new { farmId = FarmA, reasonText = "पीक काढले" });

    private Task<(HttpStatusCode Status, string Body)> CompleteAsync(Guid who, Guid plot, Guid cycle) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot}/cycles/{cycle}/schedule/complete", who, new { farmId = FarmA });

    private Task<(HttpStatusCode Status, string Body)> RemoveStepAsync(Guid who) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{Planned}/remove", who,
            new { farmId = FarmA, reason = "गरज नाही" });

    private Task<(HttpStatusCode Status, string Body)> GenerateAsync(Guid who, string name) =>
        SendJsonAsync(HttpMethod.Post, "/shramsafal/plan/generate", who, new
        {
            cropCycleId = CycleA,
            templateName = name,
            stage = "Vegetative",
            planStartDate = "2026-01-01",
            activities = new[] { new { activityName = "फवारणी", offsetDays = 0 } },
        });

    private Task<long> StepRemovedAsync() => CountAsync(
        "SELECT count(*) FROM ssf.planned_activities WHERE \"Id\" = @id AND removed_at_utc IS NOT NULL", ("id", Planned));

    private Task<long> RowsNamedAsync(string name) => CountAsync(
        "SELECT count(*) FROM ssf.schedule_templates WHERE name = @n", ("n", name));

    /// <summary>The मुकादम's seat given "कामाचं नियोजन करणे" (his हजेरी kept as the seed has it).</summary>
    private Task GivePlanWorkAsync() => SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.PlanWork);

    [Fact]
    public async Task Migrate_refuses_the_Mukadam_label_and_admits_the_same_seat_given_PlanWork()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await SeedTemplateRowAsync("Grapes - L8b-1 first");
        var better = await SeedTemplateRowAsync("Grapes - L8b-1 better");
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, first)).Status.Should().Be(HttpStatusCode.OK);
        var before = await SubscriptionsAsync();

        (await MigrateAsync(Mukadam, PlotA, CycleA, better)).Status.Should().Be(HttpStatusCode.Forbidden, "the label grants nothing");
        (await SubscriptionsAsync()).Should().BeEquivalentTo(before, "a refused change writes nothing");

        await GivePlanWorkAsync();
        var migrated = await MigrateAsync(Mukadam, PlotA, CycleA, better);
        migrated.Status.Should().Be(HttpStatusCode.OK, migrated.Body);
    }

    [Fact]
    public async Task Abandon_refuses_the_Mukadam_label_and_admits_the_same_seat_given_PlanWork()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK);

        (await AbandonAsync(Mukadam, PlotA, CycleA)).Status.Should().Be(HttpStatusCode.Forbidden, "the label grants nothing");
        (await SubscriptionsAsync()).Should().ContainSingle().Which.State.Should().Be(0, "still Active");

        await GivePlanWorkAsync();
        var abandoned = await AbandonAsync(Mukadam, PlotA, CycleA);
        abandoned.Status.Should().Be(HttpStatusCode.OK, abandoned.Body);
    }

    [Fact]
    public async Task Complete_refuses_the_Mukadam_label_and_admits_the_same_seat_given_PlanWork()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK);

        (await CompleteAsync(Mukadam, PlotA, CycleA)).Status.Should().Be(HttpStatusCode.Forbidden, "the label grants nothing");
        (await SubscriptionsAsync()).Should().ContainSingle().Which.State.Should().Be(0, "still Active");

        await GivePlanWorkAsync();
        var completed = await CompleteAsync(Mukadam, PlotA, CycleA);
        completed.Status.Should().Be(HttpStatusCode.OK, completed.Body);
    }

    [Fact]
    public async Task Remove_step_refuses_the_Mukadam_label_and_admits_the_same_seat_given_PlanWork()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await RemoveStepAsync(Mukadam)).Status.Should().Be(HttpStatusCode.Forbidden, "the label grants nothing");
        (await StepRemovedAsync()).Should().Be(0);

        await GivePlanWorkAsync();
        var removed = await RemoveStepAsync(Mukadam);
        removed.Status.Should().Be(HttpStatusCode.OK, removed.Body);
        (await StepRemovedAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Plan_generate_refuses_the_Mukadam_label_and_admits_the_same_seat_given_PlanWork()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await GenerateAsync(Mukadam, "Grapes - L8b-1 by the label")).Status.Should().Be(HttpStatusCode.Forbidden, "membership alone is not enough");
        (await RowsNamedAsync("Grapes - L8b-1 by the label")).Should().Be(0);

        await GivePlanWorkAsync();
        var generated = await GenerateAsync(Mukadam, "Grapes - L8b-1 by the planner");
        generated.Status.Should().Be(HttpStatusCode.OK, generated.Body);
        (await RowsNamedAsync("Grapes - L8b-1 by the planner")).Should().Be(1);
    }

    [Fact]
    public async Task Complete_keeps_its_state_change()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK);

        var completed = await CompleteAsync(Owner, PlotA, CycleA);
        completed.Status.Should().Be(HttpStatusCode.OK, completed.Body);

        var kept = (await SubscriptionsAsync()).Should().ContainSingle().Which;
        kept.State.Should().Be(3, "the subscription is kept as Completed (3), not left Active");
        (await CompleteAsync(Owner, PlotA, CycleA)).Status.Should().NotBe(HttpStatusCode.OK, "a completed schedule is not completed again");
    }
}
