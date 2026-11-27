// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - slice 1, "The switch" (founder: built hidden, shown to chosen farms only).
//
// The farm-scoped switch `schedule_mechanism` (the existing ssf.feature_flags row; NO row = off, so no migration):
//   * the pull carries `capabilities.scheduleMechanism.farmIds` (the farms of THIS caller's pull that the switch is on for);
//     with the switch off for every one of them the key is not there at all, so the bytes are what they were before;
//   * a reserved set of NEW mutation names (empty in production today; slice 2 fills it) is refused with
//     `ShramSafal.ScheduleMechanismOff` for a farm the switch is off for. A TEST-REGISTERED name stands in for them here.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host, the real pull route and the real push handler.
// The flag row is arranged as superuser (arrangement only); everything under test reads it as the application role.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleMechanismSwitchRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Probe = "schedule.mechanism.probe";
    private const string OffCode = "ShramSafal.ScheduleMechanismOff";

    /// <summary>The production switch, with ONE test-registered reserved name (production reserves none yet).</summary>
    protected override void AddHostServices(IServiceCollection services) =>
        services.AddScoped(sp => ScheduleMechanismSwitch.WithReservedNames(sp.GetRequiredService<IShramSafalRepository>(), [Probe]));

    private Task SetFlagAsync(bool enabled, string? cohort) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', @enabled, @cohort, 'slice-1 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = EXCLUDED.enabled, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("enabled", enabled), ("cohort", cohort is null ? DBNull.Value : cohort));

    private static Dictionary<string, object?> ProbePayload(Guid farm, string id) => new()
    {
        ["farmId"] = farm,
        ["probeId"] = id,
    };

    /// <summary>
    /// The whole pull of a caller (from the beginning) as a JSON tree, without the three fields every pull restamps by itself: the two clocks and
    /// the attention board (it mints a fresh card id and a generated-at stamp each time it is built, switch or no switch).
    /// </summary>
    private async Task<JsonObject> BodyAsync(Guid user, bool withoutCapabilities = false)
    {
        var (_, root) = await PullAsync(user);
        return Normalised(JsonNode.Parse(root.GetRawText())!.AsObject(), withoutCapabilities);
    }

    private static JsonObject Normalised(JsonObject tree, bool withoutCapabilities = false)
    {
        tree.Remove("serverTimeUtc");
        tree.Remove("nextCursorUtc");
        tree.Remove("attentionBoard");
        if (withoutCapabilities)
        {
            tree.Remove("capabilities");
        }

        return tree;
    }

    private static JsonObject? Capabilities(JsonObject body) => body["capabilities"]?.AsObject();

    private static Guid[] FarmsOn(JsonObject body) =>
        Capabilities(body)?["scheduleMechanism"]?["farmIds"]?.AsArray().Select(n => Guid.Parse(n!.GetValue<string>())).OrderBy(g => g).ToArray() ?? [];

    private async Task<(string Status, string? Code)> PushProbeAsync(Guid actor, Guid farm, string id)
    {
        var result = await PushAsync(actor, Probe, id, ProbePayload(farm, id));
        return (result.Status, result.ErrorCode);
    }

    [Fact]
    public async Task SwitchOff_RefusesNewMutations_AndPullIsAsBefore()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Everything that exists today is untouched by the gate: a cost entry still applies as the owner (before the baseline is taken).
        await PushAppliedAsync(Owner, "add_cost_entry", "sw-off-cost", CostPayload(Guid.NewGuid(), FarmA, PlotA, CycleA, 12.34m));

        // No row at all: the pull is the pull of today (no `capabilities` key), and a reserved name is refused.
        var baseline = await BodyAsync(Owner);
        baseline.ContainsKey("capabilities").Should().BeFalse("with the switch off the key is not sent: the bytes are what they were");

        var refused = await PushAsync(Owner, Probe, "probe-off-1", ProbePayload(FarmA, "probe-off-1"));
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be(OffCode, "a new mutation name is refused, with a code that says why");
        refused.ErrorMessage.Should().Contain("not switched on");

        // Fail closed: a reserved name that names no farm cannot be shown to be on.
        var noFarm = await PushAsync(Owner, Probe, "probe-off-2", new Dictionary<string, object?> { ["probeId"] = "x" });
        noFarm.Status.Should().Be("failed");
        noFarm.ErrorCode.Should().Be(OffCode);

        // A disabled row (the list kept, the master off) and a row that lights only the OTHER farm change nothing for this farm.
        await SetFlagAsync(enabled: false, cohort: FarmA.ToString());
        var disabled = await BodyAsync(Owner);
        disabled.ContainsKey("capabilities").Should().BeFalse();
        (await PushProbeAsync(Owner, FarmA, "probe-off-3")).Code.Should().Be(OffCode);

        await SetFlagAsync(enabled: true, cohort: FarmB.ToString());
        var otherFarmOn = await BodyAsync(Owner);
        otherFarmOn.ContainsKey("capabilities").Should().BeFalse("the switch is on for farm B only; farm A's owner is told nothing");
        otherFarmOn.ToJsonString().Should().NotContain(FarmB.ToString(), "no other farm id leaks");
        (await PushProbeAsync(Owner, FarmA, "probe-off-4")).Code.Should().Be(OffCode);

        // An enabled row that names nobody lights nothing (fail closed).
        await SetFlagAsync(enabled: true, cohort: null);
        (await BodyAsync(Owner)).ContainsKey("capabilities").Should().BeFalse();
        (await PushProbeAsync(Owner, FarmA, "probe-off-5")).Code.Should().Be(OffCode);

        // And the other fields of the pull never moved through any of it.
        JsonNode.DeepEquals(await BodyAsync(Owner), baseline).Should().BeTrue("with the switch off the pull is exactly what it was");
    }

    [Fact]
    public async Task SwitchOn_OneFarm_OtherFarmUnchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var baselineA = await BodyAsync(Owner);
        var baselineB = await BodyAsync(OwnerB);

        // Direction 1: on for farm A only.
        await SetFlagAsync(enabled: true, cohort: FarmA.ToString());
        var ownerA = await BodyAsync(Owner);
        FarmsOn(ownerA).Should().Equal(FarmA);
        Capabilities(ownerA)!.Select(p => p.Key).Should().Equal("scheduleMechanism");
        Capabilities(ownerA)!["scheduleMechanism"]!.AsObject().Select(p => p.Key).Should().Equal("farmIds");
        ownerA.Remove("capabilities");
        JsonNode.DeepEquals(ownerA, baselineA).Should().BeTrue("farm A's pull differs by the one new key and nothing else");

        var ownerB = await BodyAsync(OwnerB);
        ownerB.ContainsKey("capabilities").Should().BeFalse("farm B's switch is off: its pull is untouched");
        JsonNode.DeepEquals(ownerB, baselineB).Should().BeTrue();

        (await PushProbeAsync(Owner, FarmA, "probe-on-a-1")).Code.Should().NotBe(OffCode,
            "the gate lets farm A's name through (the catalog then answers, as the name is a test one)");
        (await PushProbeAsync(OwnerB, FarmB, "probe-on-b-1")).Code.Should().Be(OffCode);

        // Direction 2: flip it - on for farm B only. Farm A follows at once, no restart, no cache.
        await SetFlagAsync(enabled: true, cohort: FarmB.ToString());
        (await BodyAsync(Owner)).ContainsKey("capabilities").Should().BeFalse();
        FarmsOn(await BodyAsync(OwnerB)).Should().Equal(FarmB);
        (await PushProbeAsync(Owner, FarmA, "probe-on-a-2")).Code.Should().Be(OffCode);
        (await PushProbeAsync(OwnerB, FarmB, "probe-on-b-2")).Code.Should().NotBe(OffCode);

        // Both farms listed: each caller is told only about HIS farms (no other farm's id in his answer).
        await SetFlagAsync(enabled: true, cohort: $"{FarmA}|{FarmB:N}");
        var both = await BodyAsync(Owner);
        FarmsOn(both).Should().Equal(FarmA);
        both.ToJsonString().Should().NotContain(FarmB.ToString(), "another farm's id never reaches this caller");
        FarmsOn(await BodyAsync(OwnerB)).Should().Equal(FarmB);

        // The master off beats the list; `all` lights every farm a caller reads.
        await SetFlagAsync(enabled: false, cohort: $"{FarmA}|{FarmB}");
        (await BodyAsync(Owner)).ContainsKey("capabilities").Should().BeFalse();
        (await BodyAsync(OwnerB)).ContainsKey("capabilities").Should().BeFalse();
        await SetFlagAsync(enabled: true, cohort: "all");
        FarmsOn(await BodyAsync(Owner)).Should().Equal(FarmA);
        FarmsOn(await BodyAsync(OwnerB)).Should().Equal(FarmB);

        // A seat that reads the farm is told too (the switch is the farm's, not the seat's); a paused seat reads nothing.
        FarmsOn(await BodyAsync(Worker)).Should().Equal(FarmA);
        (await BodyAsync(Paused)).ContainsKey("capabilities").Should().BeFalse("a paused seat reads no farm");
    }

    [Fact]
    public async Task Release_1_0_17_reader_ignores_the_new_capabilities_key()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A 1.0.17 phone: it names its version, sends no `farms=` and no `scheduleFormat`, and starts from the beginning.
        async Task<JsonObject> Pull1017Async(string query = "")
        {
            using var response = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00%3A00%3A00Z" + query, Owner, null, "1.0.17");
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.OK, body);
            return JsonNode.Parse(body)!.AsObject();
        }

        static JsonObject Same(JsonObject raw) => Normalised(JsonNode.Parse(raw.ToJsonString())!.AsObject(), withoutCapabilities: true);

        var before = await Pull1017Async();
        before.ContainsKey("capabilities").Should().BeFalse();
        await SetFlagAsync(enabled: true, cohort: FarmA.ToString());
        var after = await Pull1017Async();

        // Every key 1.0.17 reads is still there with the kind it expects.
        foreach (var list in new[]
                 {
                     "farms", "plots", "cropCycles", "dailyLogs", "attachments", "costEntries", "financeCorrections", "dayLedgers",
                     "priceConfigs", "plannedActivities", "auditEvents", "operators", "scheduleTemplates", "cropTypes",
                     "activityCategories", "costCategories", "testInstances", "testRecommendations", "complianceSignals",
                     "jobCards", "attendanceMarks", "scheduleSubscriptions", "plotMainSchedules",
                 })
        {
            after[list].Should().NotBeNull($"1.0.17 reads '{list}'");
            after[list]!.GetValueKind().Should().Be(JsonValueKind.Array, $"'{list}' is a list");
        }

        // The ONLY difference the switch makes to what 1.0.17 receives is the one new key it never reads, and its shape is the contract the
        // new phone's reader parses: an object holding only `scheduleMechanism`, which holds only `farmIds`, a list of farm-id strings.
        after.Select(p => p.Key).Except(before.Select(p => p.Key)).Should().Equal(new[] { "capabilities" });
        before.Select(p => p.Key).Except(after.Select(p => p.Key)).Should().BeEmpty("no key 1.0.17 had is gone");
        after.Select(p => p.Key).Should().OnlyHaveUniqueItems();
        after["capabilities"]!.ToJsonString().Should().Be("{\"scheduleMechanism\":{\"farmIds\":[\"" + FarmA + "\"]}}");
        JsonNode.DeepEquals(Same(after), Same(before)).Should().BeTrue("every other part of the pull is the same");

        // The new phone's query: `scheduleFormat=2` is a query parameter (no new header, so CORS is untouched). It is accepted, an
        // unreadable value is ignored, and neither changes what the pull carries - except (slice 3) that a phone asking for format 2 or more, on a farm the
        // switch is on for, is also sent the works of its own schedules and their history (`ownScheduleItems` / `ownScheduleItemRevisions`), the season-end carries
        // (slice 11, `ownScheduleCarries`) and the schedule owner's voice (slice 12b, `ownerMessages` / `ownerClips` / `ownerMessageStates`): all empty here, and
        // NONE of them reaches a phone that does not ask for format 2 (P11). The full gate of 25 Nov found this list still naming slice 3's two keys only.
        foreach (var query in new[] { "&scheduleFormat=2", "&scheduleFormat=abc", "&scheduleFormat=", "&scheduleFormat=99999999999999" })
        {
            var asked = await Pull1017Async(query);
            FarmsOn(asked).Should().Equal(new[] { FarmA }, $"'{query}' is read leniently: the answer is the same");
            var asksFormat2 = query == "&scheduleFormat=2"; // the other three are unreadable (a number too big for the query is too)
            foreach (var key in new[] { "ownScheduleItems", "ownScheduleItemRevisions", "ownScheduleCarries", "ownerMessages", "ownerClips", "ownerMessageStates" })
            {
                if (asksFormat2)
                {
                    asked[key]!.AsArray().Count.Should().Be(0, $"'{query}': no own work exists in this proof");
                }
                else
                {
                    asked.ContainsKey(key).Should().BeFalse($"'{query}' does not ask for the new format");
                }

                asked.Remove(key);
            }

            // spec: repair D-9 - the farm's setup is its own key, asked for with its own parameter: a schedule format says nothing about it.
            asked.ContainsKey("farmSetup").Should().BeFalse($"'{query}' does not ask for the farm's setup");
            JsonNode.DeepEquals(Same(asked), Same(before)).Should().BeTrue($"'{query}' changes nothing else");
        }

        // ── spec: plr-d10 repair D-9 (farm setup on the server) - `farmSetup` is NEVER a key for a phone that does not ask (`farmSetup=1`, a query
        // parameter like scheduleFormat, read leniently), so an old phone's pull is what it was (P11). D-9 is for every farm and is NOT behind the
        // schedule switch: the answer is the same whatever the switch says.
        foreach (var query in new[] { "&farmSetup=", "&farmSetup=abc", "&farmSetup=0", "&farmSetup=99999999999999" })
        {
            var notAsked = await Pull1017Async(query);
            notAsked.ContainsKey("farmSetup").Should().BeFalse($"'{query}' is unreadable: it says nothing and never refuses the pull");
            JsonNode.DeepEquals(Same(notAsked), Same(before)).Should().BeTrue($"'{query}' changes nothing");
        }

        // A phone that asks is sent ONE new key and nothing else moves: one entry per farm he reads, empty while the farm has no setup yet.
        var askedSetup = await Pull1017Async("&farmSetup=1");
        askedSetup.Select(p => p.Key).Except(after.Select(p => p.Key)).Should().Equal(new[] { "farmSetup" });
        askedSetup["farmSetup"]!.ToJsonString().Should().Be(
            "[{\"farmId\":\"" + FarmA + "\",\"waterSources\":[],\"powerTimes\":null,\"machines\":[],\"plotWater\":[]}]");
        askedSetup.Remove("farmSetup");
        JsonNode.DeepEquals(Same(askedSetup), Same(before)).Should().BeTrue("asking for the farm's setup changes nothing else");

        // After the farm HAS a setup, the phone that does not ask still receives no such key, and EVERY part of its pull is what it was before any
        // setup existed (the audit row of the save is not part of this pull either).
        (await PushAsync(Owner, "farmsetup.machine.save", "switch-d9-machine", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["machineId"] = Guid.Parse("d9cc0000-0000-4000-8000-000000000001"),
            ["baseRevision"] = 0,
            ["name"] = "ट्रॅक्टर",
            ["machineType"] = "tractor",
            ["ownership"] = "owned",
        })).Status.Should().Be("applied");
        var afterSetup = await Pull1017Async();
        afterSetup.ContainsKey("farmSetup").Should().BeFalse("an old phone is never sent the farm's setup");
        afterSetup.Select(p => p.Key).Should().BeEquivalentTo(after.Select(p => p.Key), "no key is added or lost");
        JsonNode.DeepEquals(Same(afterSetup), Same(before)).Should().BeTrue("the old phone's pull is what it was before any setup existed");
        (await Pull1017Async("&farmSetup=1"))["farmSetup"]![0]!["machines"]!.AsArray().Count.Should().Be(1);
    }
}
