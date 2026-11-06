// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 2 ("wire push").
//
// adopt_schedule / migrate_schedule / abandon_schedule have been in the sync contract since 0.9.0, but /sync/push answered
// MUTATION_TYPE_UNIMPLEMENTED for all three. Wired here onto the SAME handlers the REST routes call: the actor is the
// token's user (never the payload's actorUserId), a replayed request is a no-op, the plot's day 0 (referenceDate) is
// kept, and a payload exactly as 1.0.17's contract shapes it (no referenceDate) still adopts (P11). Real Postgres as
// agrisync_app (E3 first), through the production push handler.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class SchedulePushRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    /// <summary>adopt_schedule exactly as the 0.9.0 contract (and release 1.0.17's bundled schema) shapes it.</summary>
    private static Dictionary<string, object?> OldAdopt(Guid farm, Guid plot, Guid cycle, Guid template, Guid actor) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["scheduleTemplateId"] = template,
        ["actorUserId"] = actor,
    };

    [Fact]
    public async Task Push_adopt_writes_the_same_row_as_REST()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");

        var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes);
        rest.Status.Should().Be(HttpStatusCode.OK, rest.Body);
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1-adopt-push", OldAdopt(FarmA, plot2, cycle2, BuiltInGrapes, Owner));
        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");

        var rows = await SubscriptionsAsync();
        rows.Should().HaveCount(2);
        var byRest = rows.Single(r => r.Plot == PlotA);
        var byPush = rows.Single(r => r.Plot == plot2);
        byPush.Should().BeEquivalentTo(
            byRest with { Id = byPush.Id, Plot = plot2, Cycle = cycle2 },
            "the push door writes exactly the row the REST door writes");
        (await ScheduleAuditAsync()).Should().BeEquivalentTo(new[] { ("Adopted", Owner), ("Adopted", Owner) });
    }

    [Fact]
    public async Task Push_ignores_payload_actorUserId()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // The owner's phone names someone else as the actor: the audit names the token's user.
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1-actor", OldAdopt(FarmA, PlotA, CycleA, BuiltInGrapes, Worker));
        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        (await ScheduleAuditAsync()).Should().ContainSingle().Which.Should().Be(("Adopted", Owner));

        // A कामगार naming the owner as actor gains nothing: his own seat decides, and he is refused.
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var forged = await PushAsync(Worker, "adopt_schedule", "l8b1-forged", OldAdopt(FarmA, plot2, cycle2, BuiltInGrapes, Owner));
        forged.Status.Should().Be("failed");
        forged.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await SubscriptionsAsync()).Should().ContainSingle("the forged actor wrote nothing");
    }

    [Fact]
    public async Task Replayed_clientCommandId_is_a_noop()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var payload = OldAdopt(FarmA, PlotA, CycleA, BuiltInGrapes, Owner);
        payload["clientCommandId"] = "l8b1-replay";

        var first = await PushAsync(Owner, "adopt_schedule", "l8b1-replay", payload);
        first.Status.Should().Be("applied", $"{first.ErrorCode}: {first.ErrorMessage}");
        var again = await PushAsync(Owner, "adopt_schedule", "l8b1-replay", payload);
        again.Status.Should().Be("duplicate", "the same request again is answered from what was kept, not applied twice");

        (await SubscriptionsAsync()).Should().ContainSingle();
        (await ScheduleAuditAsync()).Should().ContainSingle();
    }

    [Fact]
    public async Task Old_payload_without_referenceDate_still_adopts()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // P11: exactly the old shape — accepted, day 0 left to the crop season's start.
        var old = await PushAsync(Owner, "adopt_schedule", "l8b1-old", OldAdopt(FarmA, PlotA, CycleA, BuiltInGrapes, Owner));
        old.Status.Should().Be("applied", $"{old.ErrorCode}: {old.ErrorMessage}");
        (await SubscriptionsAsync()).Single(r => r.Plot == PlotA).ReferenceDate.Should().BeNull();

        // The new phone's day 0 is kept.
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var withDay0 = OldAdopt(FarmA, plot2, cycle2, BuiltInGrapes, Owner);
        withDay0["referenceDate"] = "2026-09-15";
        var current = await PushAsync(Owner, "adopt_schedule", "l8b1-day0", withDay0);
        current.Status.Should().Be("applied", $"{current.ErrorCode}: {current.ErrorMessage}");
        (await SubscriptionsAsync()).Single(r => r.Plot == plot2).ReferenceDate.Should().Be(new DateOnly(2026, 9, 15));
    }

    [Fact]
    public async Task Push_migrate_then_abandon_keeps_one_active_choice_and_the_history()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var second = await SeedTemplateRowAsync("Grapes - L8b-1 second");

        var adopt = OldAdopt(FarmA, PlotA, CycleA, BuiltInGrapes, Owner);
        adopt["referenceDate"] = "2026-09-15";
        (await PushAsync(Owner, "adopt_schedule", "l8b1-m-adopt", adopt)).Status.Should().Be("applied");

        var migrated = await PushAsync(Owner, "migrate_schedule", "l8b1-m-migrate", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["newScheduleTemplateId"] = second,
            ["reason"] = "Other",
            ["actorUserId"] = Owner,
        });
        migrated.Status.Should().Be("applied", $"{migrated.ErrorCode}: {migrated.ErrorMessage}");

        var rows = await SubscriptionsAsync();
        rows.Should().HaveCount(2);
        var before = rows.Single(r => r.Template == BuiltInGrapes);
        var now = rows.Single(r => r.Template == second);
        before.State.Should().Be(1, "the earlier choice is Migrated, not deleted");
        now.State.Should().Be(0, "exactly one choice is active");
        now.MigratedFrom.Should().Be(before.Id);
        before.MigratedTo.Should().Be(now.Id);
        now.ReferenceDate.Should().Be(new DateOnly(2026, 9, 15), "a switch that names no day 0 keeps the plot's day 0");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_migration_events WHERE new_subscription_id = @id", ("id", now.Id)))
            .Should().Be(1, "the switch is recorded (I-16)");

        var abandoned = await PushAsync(Owner, "abandon_schedule", "l8b1-m-abandon", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["actorUserId"] = Owner,
        });
        abandoned.Status.Should().Be("applied", $"{abandoned.ErrorCode}: {abandoned.ErrorMessage}");
        (await SubscriptionsAsync()).Single(r => r.Id == now.Id).State.Should().Be(2, "abandon ends the active choice");
        (await ScheduleAuditAsync()).Select(a => a.Action).Should().Equal("Adopted", "Migrated", "Abandoned");
    }
}
