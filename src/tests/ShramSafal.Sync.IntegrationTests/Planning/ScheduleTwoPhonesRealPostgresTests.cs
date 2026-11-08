// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-2 fix round 1 (B006, B012; Review Focus 1).
//
// Two phones of one farm choose a plot's schedule while offline: the second arrival is refused, never a silent overwrite.
//   - the second phone's ADOPT answers exactly ShramSafal.ScheduleAlreadyAdopted;
//   - two offline SWITCHES: the second names the subscription it believed active (fromSubscriptionId) and is refused with
//     ShramSafal.ScheduleChangedElsewhere, nothing written;
//   - a switch that names no fromSubscriptionId behaves exactly as before (P11: no phone before this lane sends one).
// Real Postgres as agrisync_app (E3 first), through the production push handler.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleTwoPhonesRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    private Dictionary<string, object?> Adopt(Guid template, Guid? subscription = null) => new()
    {
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["scheduleTemplateId"] = template,
        ["actorUserId"] = Owner,
        ["subscriptionId"] = subscription ?? Guid.NewGuid(),
    };

    private Dictionary<string, object?> Switch(Guid template, Guid? from)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["newScheduleTemplateId"] = template,
            ["reason"] = "Other",
            ["actorUserId"] = Owner,
        };
        if (from is { } f)
        {
            payload["fromSubscriptionId"] = f;
        }

        return payload;
    }

    [Fact]
    public async Task Second_phone_push_adopt_answers_ScheduleAlreadyAdopted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await SeedTemplateRowAsync("Grapes - L8b-2 first");
        var second = await SeedTemplateRowAsync("Grapes - L8b-2 second");

        (await PushAsync(Owner, "adopt_schedule", "phone-a-adopt", Adopt(first))).Status.Should().Be("applied");
        var refused = await PushAsync(Owner, "adopt_schedule", "phone-b-adopt", Adopt(second));

        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.ScheduleAlreadyAdopted");
        var rows = await SubscriptionsAsync();
        rows.Should().ContainSingle("the second choice wrote nothing").Which.Template.Should().Be(first);
    }

    [Fact]
    public async Task Two_offline_switches_the_second_is_refused_and_nothing_is_overwritten()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await SeedTemplateRowAsync("Grapes - L8b-2 A");
        var b = await SeedTemplateRowAsync("Grapes - L8b-2 B");
        var c = await SeedTemplateRowAsync("Grapes - L8b-2 C");

        // Both phones hold the same Active subscription (A) when they go offline.
        var held = Guid.NewGuid();
        (await PushAsync(Owner, "adopt_schedule", "base-adopt", Adopt(a, held))).Status.Should().Be("applied");

        // Phone 1 switches to B first; phone 2, still believing A is active, then tries C.
        var one = await PushAsync(Owner, "migrate_schedule", "phone-1-switch", Switch(b, held));
        one.Status.Should().Be("applied", $"{one.ErrorCode}: {one.ErrorMessage}");
        var two = await PushAsync(Owner, "migrate_schedule", "phone-2-switch", Switch(c, held));

        two.Status.Should().Be("failed");
        two.ErrorCode.Should().Be("ShramSafal.ScheduleChangedElsewhere");
        var rows = await SubscriptionsAsync();
        rows.Should().HaveCount(2, "A (migrated) and B (active): the refused switch added nothing");
        rows.Single(r => r.State == 0).Template.Should().Be(b, "phone 1's choice stands");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_migration_events")).Should().Be(1);
    }

    [Fact]
    public async Task A_switch_queued_behind_a_refused_offline_adopt_is_refused_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await SeedTemplateRowAsync("Grapes - L8b-2 A");
        var b = await SeedTemplateRowAsync("Grapes - L8b-2 B");
        var c = await SeedTemplateRowAsync("Grapes - L8b-2 C");

        (await PushAsync(Owner, "adopt_schedule", "other-phone-adopt", Adopt(a))).Status.Should().Be("applied");
        // This phone adopted B offline (refused), then switched to C: the switch names ITS pending id, which never existed.
        var pending = Guid.NewGuid();
        (await PushAsync(Owner, "adopt_schedule", "my-adopt", Adopt(b, pending))).ErrorCode.Should().Be("ShramSafal.ScheduleAlreadyAdopted");
        var switched = await PushAsync(Owner, "migrate_schedule", "my-switch", Switch(c, pending));

        switched.ErrorCode.Should().Be("ShramSafal.ScheduleChangedElsewhere");
        (await SubscriptionsAsync()).Should().ContainSingle().Which.Template.Should().Be(a);
    }

    [Fact]
    public async Task Migrate_without_fromSubscriptionId_behaves_as_before()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await SeedTemplateRowAsync("Grapes - L8b-2 A");
        var b = await SeedTemplateRowAsync("Grapes - L8b-2 B");

        (await PushAsync(Owner, "adopt_schedule", "plain-adopt", Adopt(a))).Status.Should().Be("applied");
        var switched = await PushAsync(Owner, "migrate_schedule", "plain-switch", Switch(b, null));

        switched.Status.Should().Be("applied", $"{switched.ErrorCode}: {switched.ErrorMessage}");
        (await SubscriptionsAsync()).Single(r => r.State == 0).Template.Should().Be(b);
    }
}
