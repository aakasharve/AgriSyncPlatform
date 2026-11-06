// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 3 (the authority gate).
//
// Founder card D-73 (L8-1, "who may choose or change a plot's schedule, and move a schedule step"), answered 2026-11-06,
// choice 1: "You, plus the people you give 'कामाचं नियोजन करणे'". ScheduleChangeGate asks exactly that on every planning
// door — the primary owner, or a seat holding PlanWork (not yet ended) — plus the MU-4 plot rule; a label grants nothing
// (D-26). A change made offline before PlanWork ended, that reaches the server after it, counts inside the late window
// and is flagged for the owner (MU design §11.2); anything later is refused and kept whole for the owner (never dropped).
// Real Postgres as agrisync_app (E3 first), through the real host and the production push handler.
using System;
using System.Collections.Generic;
using System.Globalization;
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
public sealed class ScheduleChangeAuthorityRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    private static Dictionary<string, object?> Adopt(Guid plot, Guid cycle, Guid actor) => new()
    {
        ["farmId"] = FarmA,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["scheduleTemplateId"] = BuiltInGrapes,
        ["actorUserId"] = actor,
    };

    private Task<(HttpStatusCode Status, string Body)> MoveStepAsync(Guid who) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{Planned}/override", who,
            new { farmId = FarmA, newPlannedDate = "2026-10-20", reason = "पुढे ठरवले" });

    [Fact]
    public async Task Worker_without_PlanWork_gets_403_on_adopt_and_plan_override()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // REST adopt as the कामगार seat: refused, nothing kept.
        var rest = await AdoptAsync(Worker, FarmA, PlotA, CycleA, BuiltInGrapes);
        rest.Status.Should().Be(HttpStatusCode.Forbidden, rest.Body);

        // The same through /sync/push: refused with the code every phone parks visibly (P10).
        var pushed = await PushAsync(Worker, "adopt_schedule", "l8b1-worker-adopt", Adopt(PlotA, CycleA, Worker));
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await SubscriptionsAsync()).Should().BeEmpty("a refused change writes nothing");

        // "पुढे ठरवा" on the farm's planned step as the कामगार: refused.
        (await MoveStepAsync(Worker)).Status.Should().Be(HttpStatusCode.Forbidden);

        // The मुकादम LABEL grants nothing (D-26): refused on both doors until the owner gives PlanWork.
        (await AdoptAsync(Mukadam, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await MoveStepAsync(Mukadam)).Status.Should().Be(HttpStatusCode.Forbidden);
        // ... and so does the सहमालक label.
        (await AdoptAsync(CoOwner, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.Forbidden);

        // Not vacuous: given "कामाचं नियोजन करणे", the same मुकादम seat adopts and moves the step; the owner always may.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.PlanWork);
        var planner = await AdoptAsync(Mukadam, FarmA, PlotA, CycleA, BuiltInGrapes);
        planner.Status.Should().Be(HttpStatusCode.OK, planner.Body);
        var move = await MoveStepAsync(Mukadam);
        move.Status.Should().Be(HttpStatusCode.OK, move.Body);
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var owner = await AdoptAsync(Owner, FarmA, plot2, cycle2, BuiltInGrapes);
        owner.Status.Should().Be(HttpStatusCode.OK, owner.Body);
    }

    [Fact]
    public async Task Expired_PlanWork_offline_arrival_is_flagged_not_dropped()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // The owner gave the मुकादम "plan work" until two days ago.
        var ended = DateTime.UtcNow.AddDays(-2);
        await ExecOnSuperuserAsync("""
            UPDATE ssf.farm_memberships
               SET permissions = coalesce(permissions, 0) | 8,
                   authority_expires_at = jsonb_build_object('8', @end)
             WHERE farm_id = @farm AND user_id = @mukadam;
            """, ("end", ended.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture)),
            ("farm", FarmA), ("mukadam", Mukadam));
        (await AdoptAsync(Mukadam, FarmA, PlotA, CycleA, BuiltInGrapes)).Status
            .Should().Be(HttpStatusCode.Forbidden, "online, PlanWork has ended");

        // Chosen on his phone (offline) a day BEFORE the end, reaching the server now: it counts, and it is flagged.
        var beforeEnd = Adopt(PlotA, CycleA, Mukadam);
        beforeEnd["decidedAtUtc"] = ended.AddDays(-1).ToString("O", CultureInfo.InvariantCulture);
        var late = await PushAsync(Mukadam, "adopt_schedule", "l8b1-late-ok", beforeEnd);
        late.Status.Should().Be("applied", $"{late.ErrorCode}: {late.ErrorMessage}");
        var kept = (await SubscriptionsAsync()).Should().ContainSingle().Which;
        kept.Plot.Should().Be(PlotA);
        (await ScheduleAuditAsync()).Select(a => a.Action)
            .Should().Equal(new[] { "Adopted", "AcceptedAfterResponsibilityEnded" }, "the owner is told it arrived after the end");

        // Chosen AFTER the end: refused — and not dropped: the whole change is kept for the owner.
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var afterEnd = Adopt(plot2, cycle2, Mukadam);
        afterEnd["decidedAtUtc"] = ended.AddHours(1).ToString("O", CultureInfo.InvariantCulture);
        var refused = await PushAsync(Mukadam, "adopt_schedule", "l8b1-late-refused", afterEnd);
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await SubscriptionsAsync()).Should().ContainSingle("nothing of the refused change was applied");
        (await CountAsync("""
            SELECT count(*) FROM ssf.audit_events
            WHERE entity_type = 'RefusedSyncMutation' AND action = 'WorkKeptForOwner' AND farm_id = @farm
              AND payload::text LIKE '%adopt_schedule%'
            """, ("farm", FarmA))).Should().Be(1, "the refused change is kept whole for the owner (P10)");
    }
}
