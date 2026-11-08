// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-2 Task 1 ("every phone of the farm follows the same schedule";
// founder D-32, register F09, finding F96).
//
// A plot's chosen schedule is kept on the server (lane L8b-1) but never travelled on the pull, so a second phone of the
// farm never saw it. The pull now carries `scheduleSubscriptions`: changed since the phone's cursor, every state (a switch is
// seen), for the farms whose overview the seat reads (the rule planned work follows), a chosen-plots seat only his plots.
// And F96: a planned step on an UNCHANGED older crop season was dropped from the pull (it was filtered by the seasons that
// changed in THIS pull), so a move or a removal there never reached the next pull.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host: the real schedule doors write, the real
// pull reads, a phone's whole-second cursor is used. Fake phone numbers only (the base farm's 93000000xx).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleSubscriptionPullRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    private static IReadOnlyList<JsonElement> Subscriptions(JsonElement root) => ArrayOf(root, "scheduleSubscriptions");

    private static JsonElement Of(JsonElement root, Guid plot, string state = "Active") =>
        Subscriptions(root).Single(s => s.GetProperty("plotId").GetGuid() == plot && s.GetProperty("state").GetString() == state);

    private async Task<HttpStatusCode> SetChosenPlotsAsync(Guid person, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
        return response.StatusCode;
    }

    private static async Task NextWholeSecondAsync()
    {
        var now = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - now.Millisecond + 30));
    }

    /// <summary>The P11 run's input: when <c>L8B2_P11_BODIES</c> names a folder, the bodies this server sent are kept there.</summary>
    private static void Keep(string who, string body)
    {
        var folder = Environment.GetEnvironmentVariable("L8B2_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, $"{who}.json"), body);
        }
    }

    private async Task<Guid> OwnerAdoptsAsync(Guid plot, Guid cycle, Guid template, string? referenceDate = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["scheduleTemplateId"] = template,
            ["actorUserId"] = Owner,
        };
        if (referenceDate is not null)
        {
            payload["referenceDate"] = referenceDate;
        }

        var result = await PushAsync(Owner, "adopt_schedule", $"l8b2-adopt-{Guid.NewGuid():N}", payload);
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return (await SubscriptionsAsync()).Single(r => r.Plot == plot && r.State == 0).Id;
    }

    [Fact]
    public async Task Second_phone_receives_the_adopted_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Two library rows: with rows, the library lists rows only, and only what is listed can be adopted.
        var first = await SeedTemplateRowAsync("Grapes - L8b-2 first");
        var second = await SeedTemplateRowAsync("Grapes - L8b-2 second");

        // Before any choice the key is present and empty (a phone reads "no choice yet" from it, never an absent key).
        var (_, before) = await PullAsync(CoOwner);
        before.TryGetProperty("scheduleSubscriptions", out var key).Should().BeTrue("the server sends the key");
        key.GetArrayLength().Should().Be(0);

        var subscription = await OwnerAdoptsAsync(PlotA, CycleA, first, "2026-09-15");

        // The सहमालक's phone, a clean install (cursor 0): the owner's choice for the plot, with its day 0.
        var (body, coOwner) = await PullAsync(CoOwner);
        Keep("co-owner-since-zero", body);
        var row = Of(coOwner, PlotA);
        row.GetProperty("id").GetGuid().Should().Be(subscription);
        row.GetProperty("farmId").GetGuid().Should().Be(FarmA);
        row.GetProperty("cropCycleId").GetGuid().Should().Be(CycleA);
        row.GetProperty("scheduleTemplateId").GetGuid().Should().Be(first);
        row.GetProperty("referenceDate").GetString().Should().Be("2026-09-15");
        row.GetProperty("state").GetString().Should().Be("Active");
        // The owner's own second phone (another install) receives it too; the other farm's owner does not.
        Subscriptions((await PullAsync(Owner)).Root).Should().ContainSingle(s => s.GetProperty("plotId").GetGuid() == PlotA);
        Subscriptions((await PullAsync(OwnerB)).Root).Should().BeEmpty("another farm's choice never reaches him");

        // An incremental pull from a cursor past the choice (the phone's whole-second cursor, a second on): nothing new.
        await NextWholeSecondAsync();
        var cursor = DateTime.UtcNow;
        await NextWholeSecondAsync();
        var (_, quiet) = await PullAsync(CoOwner, cursor);
        Subscriptions(quiet).Should().BeEmpty("a choice the cursor has passed is not sent again");

        // The owner SWITCHES the plot: the phone sees both rows, the old one Migrated and the new one Active.
        var switched = await PushAsync(Owner, "migrate_schedule", "l8b2-switch", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["newScheduleTemplateId"] = second,
            ["reason"] = "Other",
            ["actorUserId"] = Owner,
        });
        switched.Status.Should().Be("applied", $"{switched.ErrorCode}: {switched.ErrorMessage}");
        var (afterBody, after) = await PullAsync(CoOwner, cursor);
        Keep("co-owner-after-switch", afterBody);
        Of(after, PlotA, "Migrated").GetProperty("id").GetGuid().Should().Be(subscription);
        var current = Of(after, PlotA);
        current.GetProperty("scheduleTemplateId").GetGuid().Should().Be(second);
        current.GetProperty("migratedFromSubscriptionId").GetGuid().Should().Be(subscription);
        after.GetProperty("nextCursorUtc").GetDateTime().Should().BeAfter(cursor, "the cursor passes the switch");
    }

    [Fact]
    public async Task Own_records_worker_seat_receives_no_subscriptions()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await OwnerAdoptsAsync(PlotA, CycleA, BuiltInGrapes);

        // Not vacuous: a seat that reads the farm overview receives it.
        Subscriptions((await PullAsync(Mukadam)).Root).Should().ContainSingle(s => s.GetProperty("plotId").GetGuid() == PlotA);
        Subscriptions((await PullAsync(CoOwner)).Root).Should().ContainSingle();

        // A कामगार reads his own records only: no overview, so no schedule choices (the planned-work rule).
        var (body, worker) = await PullAsync(Worker);
        Subscriptions(worker).Should().BeEmpty("an own-records seat does not read the farm overview");
        var subscriptionId = (await SubscriptionsAsync()).Single(r => r.Plot == PlotA).Id;
        body.Should().NotContain(subscriptionId.ToString(), "not even the id of the choice reaches him");
        (await PullAsync(Worker2)).Root.GetProperty("scheduleSubscriptions").GetArrayLength().Should().Be(0);
        // …and a seat that is paused, though every power is stored on it, is told nothing.
        Subscriptions((await PullAsync(Paused)).Root).Should().BeEmpty();
    }

    [Fact]
    public async Task Chosen_plots_seat_receives_only_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var (plot3, cycle3) = await SeedSeasonAsync("Grapes");
        await OwnerAdoptsAsync(PlotA, CycleA, BuiltInGrapes);
        await OwnerAdoptsAsync(plot2, cycle2, BuiltInGrapes);
        await OwnerAdoptsAsync(plot3, cycle3, BuiltInGrapes);
        await SetChosenPlotsAsync(Mukadam, plot2);

        var (body, mukadam) = await PullAsync(Mukadam);
        Subscriptions(mukadam).Select(s => s.GetProperty("plotId").GetGuid()).Should().Equal([plot2], "only the plot he covers");
        body.Should().NotContain(PlotA.ToString()).And.NotContain(plot3.ToString(), "no other plot is even named");

        // The सहमालक covers every plot and receives all three.
        Subscriptions((await PullAsync(CoOwner)).Root).Select(s => s.GetProperty("plotId").GetGuid())
            .Should().BeEquivalentTo([PlotA, plot2, plot3]);
        // The owner of farm B is on another farm: none.
        Subscriptions((await PullAsync(OwnerB)).Root).Should().BeEmpty();
    }

    [Fact]
    public async Task Override_on_an_unchanged_older_cycle_reaches_the_next_pull()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");

        // The phone's cursor is taken a whole second after everything the farm was seeded with: the SEASON of the step
        // does not change after it, only the step does.
        await NextWholeSecondAsync();
        var cursor = DateTime.UtcNow;
        await NextWholeSecondAsync();

        var moved = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/planned-activities/{Planned}/override", Owner,
            new { farmId = FarmA, newPlannedDate = "2026-12-24", reason = "पाऊस" });
        moved.Status.Should().Be(HttpStatusCode.OK, moved.Body);

        var (body, owner) = await PullAsync(Owner, cursor);
        Keep("owner-planned-on-older-cycle", body);
        IdsOf(owner, "cropCycles").Should().NotContain(CycleA, "the season itself did not change after the cursor (the precondition of F96)");
        var step = ArrayOf(owner, "plannedActivities").Should().ContainSingle(a => a.GetProperty("id").GetGuid() == Planned).Subject;
        step.GetProperty("plannedDate").GetString().Should().StartWith("2026-12-24", "the moved step reaches the next pull");

        // The same rule for the seats that read the overview, narrowed by plot: a chosen-plots seat who does not cover the
        // step's plot never receives it (the plot rule is kept, not widened).
        await SetChosenPlotsAsync(Mukadam, plot2);
        IdsOf((await PullAsync(Mukadam, cursor)).Root, "plannedActivities").Should().NotContain(Planned);
        IdsOf((await PullAsync(CoOwner, cursor)).Root, "plannedActivities").Should().Contain(Planned);
        // An own-records seat gets no planned work at all, as before.
        IdsOf((await PullAsync(Worker, cursor)).Root, "plannedActivities").Should().BeEmpty();
        // And a person of another farm is told nothing of it.
        IdsOf((await PullAsync(OwnerB, cursor)).Root, "plannedActivities").Should().NotContain(Planned);
    }

    [Fact]
    public async Task Release_1_0_17_pull_reader_parses_the_new_pull()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await OwnerAdoptsAsync(PlotA, CycleA, BuiltInGrapes, "2026-09-15");

        // A 1.0.17 phone: it names its version, sends no `farms=`, and starts from the beginning.
        using var response = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00%3A00%3A00Z", Owner, null, "1.0.17");
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        Keep("owner-1.0.17", body);
        var root = JsonDocument.Parse(body).RootElement;

        // Every key 1.0.17 reads is still there with the kind it expects (lists stay lists, the cursor stays a time).
        foreach (var list in new[]
                 {
                     "farms", "plots", "cropCycles", "dailyLogs", "attachments", "costEntries", "financeCorrections", "dayLedgers",
                     "priceConfigs", "plannedActivities", "auditEvents", "operators", "scheduleTemplates", "cropTypes",
                     "activityCategories", "costCategories", "testInstances", "testRecommendations", "complianceSignals",
                     "jobCards", "attendanceMarks",
                 })
        {
            root.TryGetProperty(list, out var value).Should().BeTrue($"1.0.17 reads '{list}'");
            value.ValueKind.Should().Be(JsonValueKind.Array, $"'{list}' is a list");
        }

        root.GetProperty("serverTimeUtc").ValueKind.Should().Be(JsonValueKind.String);
        root.GetProperty("nextCursorUtc").GetDateTime().Should().BeAfter(DateTime.UnixEpoch);
        root.GetProperty("referenceDataVersionHash").ValueKind.Should().Be(JsonValueKind.String);

        // The new key is ADDITIVE: 1.0.17's own DTO already names `scheduleSubscriptions` as an optional list and nothing in
        // the phone reads it; its rows are the fields of that DTO, in the kinds it declares, plus one optional extra.
        var row = Subscriptions(root).Should().ContainSingle().Subject;
        foreach (var text in new[] { "id", "farmId", "plotId", "cropCycleId", "cropKey", "scheduleTemplateId", "scheduleVersionTag", "adoptedAtUtc", "state" })
        {
            row.GetProperty(text).ValueKind.Should().Be(JsonValueKind.String, $"'{text}' is the string 1.0.17's DTO declares");
        }

        new[] { "Active", "Migrated", "Abandoned", "Completed" }.Should().Contain(row.GetProperty("state").GetString());
        // Optional fields are strings or null (never a number or an object): 1.0.17 declares them `string | undefined`.
        foreach (var optional in new[] { "migratedFromSubscriptionId", "migratedToSubscriptionId", "migrationReason", "stateChangedAtUtc", "referenceDate" })
        {
            row.TryGetProperty(optional, out var value).Should().BeTrue();
            value.ValueKind.Should().BeOneOf(JsonValueKind.String, JsonValueKind.Null);
        }

        // Nothing else on the wire changed shape: the top-level keys are the earlier ones plus the one new key.
        var names = root.EnumerateObject().Select(p => p.Name).ToList();
        names.Should().Contain("scheduleSubscriptions");
        names.Where(n => n != "scheduleSubscriptions").Should().OnlyHaveUniqueItems();
    }
}
