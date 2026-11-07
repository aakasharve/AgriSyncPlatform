// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 fix round 1 (review H1, E4 both ways).
//
// The three planned-work doors (add a step, move a step, remove a step) asked PlanWork on the farm the BODY named, and
// never asked whether the season (add) or the step's season (move / remove) belongs to that farm. ssf.planned_activities
// carries no farm_id and has no row policy, so a step of any farm loads under any farm's scope. The reviewer's case:
// Ramesh was a मुकादम on farm A and was removed; his phone still holds farm A's step ids. He owns his own farm B (any
// sign-up), where he holds every authority. Naming farm B, he moved, removed and added steps of farm A's season.
// Here, on a real Postgres as agrisync_app (E3 first), through the real host: a foreign CHILD (farm A's step, farm B named)
// and a foreign PARENT (farm A's season, farm B named) are answered not-found and nothing of farm A changes; the same
// doors on his own farm, and farm A's owner on farm A, still work (not vacuous).
using System;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkFarmWallRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    /// <summary>Ramesh: the owner of farm B (every authority there), with no seat on farm A.</summary>
    private static readonly Guid Ramesh = OwnerB;

    private async Task<string> PlannedStateAsync(Guid id)
    {
        var date = await CountAsync(
            "SELECT coalesce((SELECT (planned_date - DATE '2026-01-01') FROM ssf.planned_activities WHERE \"Id\" = @id), -1)",
            ("id", id));
        var removed = await CountAsync(
            "SELECT count(*) FROM ssf.planned_activities WHERE \"Id\" = @id AND removed_at_utc IS NOT NULL", ("id", id));
        return $"day {date}, removed {removed}";
    }

    [Fact]
    public async Task A_foreign_child_farm_As_step_named_under_farm_B_is_not_found_and_unchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var before = await PlannedStateAsync(Planned);
        before.Should().Be("day 273, removed 0", "the seeded step of farm A's season is due 2026-10-01");

        var moved = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{Planned}/override", Ramesh,
            new { farmId = FarmB, newPlannedDate = "2026-12-24", reason = "माझ्या शेतावरून" });
        moved.Status.Should().Be(HttpStatusCode.NotFound, moved.Body);
        ErrorCode(moved.Body).Should().Be("ShramSafal.PlannedActivityNotFound");

        var removed = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{Planned}/remove", Ramesh,
            new { farmId = FarmB, reason = "माझ्या शेतावरून" });
        removed.Status.Should().Be(HttpStatusCode.NotFound, removed.Body);
        ErrorCode(removed.Body).Should().Be("ShramSafal.PlannedActivityNotFound");

        (await PlannedStateAsync(Planned)).Should().Be(before, "farm A's plan is changed by nobody outside farm A (E4)");

        // Not vacuous: farm A's owner, naming farm A, moves the same step.
        var owner = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{Planned}/override", Owner,
            new { farmId = FarmA, newPlannedDate = "2026-10-05", reason = "पाऊस" });
        owner.Status.Should().Be(HttpStatusCode.OK, owner.Body);
        (await PlannedStateAsync(Planned)).Should().Be("day 277, removed 0");
    }

    [Fact]
    public async Task A_foreign_parent_farm_As_season_named_under_farm_B_is_not_found_and_nothing_is_added()
    {
        await AssertAppRoleIsNotVacuousAsync();
        long StepsOn(Guid cycle) => CountAsync(
            "SELECT count(*) FROM ssf.planned_activities WHERE crop_cycle_id = @c", ("c", cycle)).GetAwaiter().GetResult();
        var stepsOnA = StepsOn(CycleA);

        var added = await SendJsonAsync(HttpMethod.Post, "/shramsafal/planned-activities", Ramesh, new
        {
            cropCycleId = CycleA,
            farmId = FarmB,
            activityName = "फवारणी",
            stage = "Vegetative",
            plannedDate = "2026-12-24",
            reason = "माझ्या शेतावरून",
        });
        added.Status.Should().Be(HttpStatusCode.NotFound, added.Body);
        ErrorCode(added.Body).Should().Be("ShramSafal.CropCycleNotFound");
        StepsOn(CycleA).Should().Be(stepsOnA, "no step is put into farm A's season from farm B (E4)");

        // Not vacuous: on his own season, naming his own farm, the same request adds the step.
        var own = await SendJsonAsync(HttpMethod.Post, "/shramsafal/planned-activities", Ramesh, new
        {
            cropCycleId = CycleB,
            farmId = FarmB,
            activityName = "फवारणी",
            stage = "Vegetative",
            plannedDate = "2026-12-24",
            reason = "माझं शेत",
        });
        own.Status.Should().Be(HttpStatusCode.Created, own.Body);
        StepsOn(CycleB).Should().Be(1);
        StepsOn(CycleA).Should().Be(stepsOnA);
    }
}
