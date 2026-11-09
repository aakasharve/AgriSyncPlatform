// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-GATE-a Task 2 (founder D-76, D-83 = 1, R9; Review Focus 8).
//
// The pull carries `plotPlanningState`: per plot the reader may see, whether the farm is in its trial, whether the plot follows a
// schedule it may, whether there is something to choose, today's trial stage, and whether he must choose first. FULL on every pull
// (the trial ends with no row changing). Same filter as plotMainSchedules: the farms whose overview he reads, his plots.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and the real pull; the owner account and its
// subscription are arranged as superuser and read back through ssf.subscription_projections. Fake phone numbers only.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlotPlanningStatePullRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private async Task PaidFarmAsync()
    {
        await SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));
    }

    private static Guid[] PlotsOf(JsonElement root) =>
        ArrayOf(root, "plotPlanningState").Select(s => s.GetProperty("plotId").GetGuid()).OrderBy(g => g).ToArray();

    private async Task SetChosenPlotsAsync(Guid person, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
    }

    [Fact]
    public async Task Pull_carries_plotPlanningState_for_visible_plots_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidFarmAsync();
        var uni = await CheckedInstitutionAsync();
        var (plot2, cycle2) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-10));
        var (plot3, _) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-10));

        // The owner sees every plot of his farm, each with its season; PlotA follows nothing and a checked schedule exists for grapes.
        var (ownerBody, owner) = await PullAsync(Owner);
        PlotsOf(owner).Should().Equal(new[] { PlotA, plot2, plot3 }.OrderBy(g => g), "one row per plot he may see");
        var plotA = StateOf(owner, PlotA)!.Value;
        plotA.GetProperty("cropCycleId").GetGuid().Should().Be(CycleA);
        plotA.GetProperty("inTrial").GetBoolean().Should().BeFalse("a paid farm is after the trial");
        plotA.GetProperty("followsAllowed").GetBoolean().Should().BeFalse();
        plotA.GetProperty("canFollowSomething").GetBoolean().Should().BeTrue("a checked schedule exists for grapes");
        plotA.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();
        plotA.GetProperty("trialStage").ValueKind.Should().Be(JsonValueKind.Null);

        // A plot that follows a schedule asks nothing.
        await PushAdoptAsync(Owner, plot2, cycle2, uni.Id);
        StateOf((await PullAsync(Owner)).Root, plot2)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeFalse();
        StateOf((await PullAsync(Owner)).Root, plot2)!.Value.GetProperty("followsAllowed").GetBoolean().Should().BeTrue();

        // The सहमालक covers every plot; the pull sends them all.
        PlotsOf((await PullAsync(CoOwner)).Root).Should().Equal(new[] { PlotA, plot2, plot3 }.OrderBy(g => g));

        // A chosen-plots seat gets only his plot, and no other plot is even named.
        await SetChosenPlotsAsync(Mukadam, plot2);
        var (mukadamBody, mukadam) = await PullAsync(Mukadam);
        PlotsOf(mukadam).Should().Equal([plot2], "only the plot he covers");
        mukadamBody.Should().NotContain(PlotA.ToString()).And.NotContain(plot3.ToString());

        // Another farm's owner gets his own plot only: nothing of farm A.
        var (otherBody, other) = await PullAsync(OwnerB);
        PlotsOf(other).Should().Equal([PlotB]);
        otherBody.Should().NotContain(PlotA.ToString()).And.NotContain(plot2.ToString()).And.NotContain(plot3.ToString());

        // A कामगार (own records only) reads no farm overview: the key is there and empty, so his phone never asks. A paused seat too.
        var (workerBody, worker) = await PullAsync(Worker);
        worker.TryGetProperty("plotPlanningState", out var key).Should().BeTrue("the server sends the key");
        key.GetArrayLength().Should().Be(0);
        workerBody.Should().Contain("\"plotPlanningState\":[]", "he reads the farm's plots to log on any of them, but is told nothing about planning");
        PlotsOf((await PullAsync(Paused)).Root).Should().BeEmpty();
        ownerBody.Should().Contain("plotPlanningState");
    }

    [Fact]
    public async Task Release_1_0_17_pull_reader_parses_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var uni = await CheckedInstitutionAsync();
        var (followed, followedCycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        await PushAdoptAsync(Owner, followed, followedCycle, uni.Id);
        var (plot3, cycle3) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-30));
        await SeedFollowedRowAsync(plot3, cycle3, uni.Id, "Outside", 1, referenceDate: TodayIst().AddDays(-20).ToString("yyyy-MM-dd"));

        // Three moments of the SAME farm: in its trial (the followed plot has a trial stage), after the trial (PlotA must choose first),
        // and paid. Each is pulled as a 1.0.17 phone would, and the bodies are kept for the P11 run of release 1.0.17's own reader.
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(5), DateTime.UtcNow.AddDays(5));
        await Pull1017Async("owner-in-trial");
        await SetStandingAsync(AccountA, Owner, Expired, DateTime.UtcNow.AddDays(-3), DateTime.UtcNow.AddDays(-3));
        var afterTrial = await Pull1017Async("owner-after-trial");
        StateOf(afterTrial, PlotA)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();
        await SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));
        await Pull1017Async("owner-paid");

        // The chosen-plots seat and another farm's owner.
        await SetChosenPlotsAsync(Mukadam, followed);
        await Pull1017Async("chosen-plots-seat", Mukadam);
        await Pull1017Async("other-farm-owner", OwnerB);
        await Pull1017Async("worker-seat", Worker);
    }

    private async Task<JsonElement> Pull1017Async(string who, Guid? user = null)
    {
        // A 1.0.17 phone: it names its version, sends no `farms=`, and starts from the beginning.
        using var response = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00%3A00%3A00Z", user ?? Owner, null, "1.0.17");
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        KeepGateBody(who, body);
        var root = JsonDocument.Parse(body).RootElement.Clone();

        // Every key 1.0.17 reads is still there with the kind it expects.
        foreach (var list in new[]
                 {
                     "farms", "plots", "cropCycles", "dailyLogs", "attachments", "costEntries", "financeCorrections", "dayLedgers",
                     "priceConfigs", "plannedActivities", "auditEvents", "operators", "scheduleTemplates", "cropTypes",
                     "activityCategories", "costCategories", "testInstances", "testRecommendations", "complianceSignals",
                     "jobCards", "attendanceMarks", "scheduleSubscriptions", "plotMainSchedules",
                 })
        {
            root.TryGetProperty(list, out var value).Should().BeTrue($"1.0.17 reads '{list}'");
            value.ValueKind.Should().Be(JsonValueKind.Array, $"'{list}' is a list");
        }

        root.GetProperty("serverTimeUtc").ValueKind.Should().Be(JsonValueKind.String);
        root.GetProperty("nextCursorUtc").GetDateTime().Should().BeAfter(DateTime.UnixEpoch);

        // The new key is ADDITIVE and LAST-ish: a list of objects with exactly the kinds the phone's later reader declares.
        root.TryGetProperty("plotPlanningState", out var states).Should().BeTrue();
        states.ValueKind.Should().Be(JsonValueKind.Array);
        foreach (var state in states.EnumerateArray())
        {
            state.GetProperty("plotId").ValueKind.Should().Be(JsonValueKind.String);
            state.GetProperty("cropCycleId").ValueKind.Should().BeOneOf(JsonValueKind.String, JsonValueKind.Null);
            foreach (var flag in new[] { "inTrial", "followsAllowed", "canFollowSomething", "needsSchedule" })
            {
                state.GetProperty(flag).ValueKind.Should().BeOneOf(new[] { JsonValueKind.True, JsonValueKind.False }, "'{0}' is a boolean", flag);
            }

            var stage = state.GetProperty("trialStage");
            stage.ValueKind.Should().BeOneOf(JsonValueKind.Object, JsonValueKind.Null);
            if (stage.ValueKind == JsonValueKind.Object)
            {
                stage.GetProperty("name").ValueKind.Should().Be(JsonValueKind.String);
                stage.GetProperty("startDay").ValueKind.Should().Be(JsonValueKind.Number);
                stage.GetProperty("endDay").ValueKind.Should().Be(JsonValueKind.Number);
            }
        }

        root.EnumerateObject().Select(p => p.Name).Should().OnlyHaveUniqueItems();
        return root;
    }

    [Fact]
    public async Task The_trial_ending_flips_InTrial_on_the_next_pull_with_no_row_changed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var uni = await CheckedInstitutionAsync();
        var (followed, followedCycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-15));
        await PushAdoptAsync(Owner, followed, followedCycle, uni.Id);

        // The trial ends in a few seconds; the subscription row says it was last changed an hour ago and stays Trialing.
        var seededUpdate = new DateTime(DateTime.UtcNow.AddHours(-1).Ticks - DateTime.UtcNow.AddHours(-1).Ticks % TimeSpan.TicksPerSecond, DateTimeKind.Utc);
        var endsAt = DateTime.UtcNow.AddSeconds(10);
        await SetStandingAsync(AccountA, Owner, Trialing, endsAt, endsAt, seededUpdate);

        var during = StateOf((await PullAsync(Owner)).Root, followed)!.Value;
        during.GetProperty("inTrial").GetBoolean().Should().BeTrue();
        during.GetProperty("trialStage").GetProperty("name").GetString().Should().Be("Canopy Build", "day 15 of the followed schedule");
        StateOf((await PullAsync(Owner)).Root, PlotA)!.Value.GetProperty("needsSchedule").GetBoolean()
            .Should().BeFalse("in the trial nothing asks, even with a checked schedule for the crop");

        await Task.Delay(TimeSpan.FromSeconds(11));

        var after = StateOf((await PullAsync(Owner)).Root, followed)!.Value;
        after.GetProperty("inTrial").GetBoolean().Should().BeFalse("the clock decided: the trial end has passed");
        after.GetProperty("trialStage").ValueKind.Should().Be(JsonValueKind.Null);
        StateOf((await PullAsync(Owner)).Root, PlotA)!.Value.GetProperty("needsSchedule").GetBoolean()
            .Should().BeTrue("PlotA follows nothing and a checked schedule exists: it asks on the next pull");

        // And no row changed in between: the subscription is still Trialing and still says it was last changed an hour ago.
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status, updated_at_utc FROM accounts.subscriptions WHERE owner_account_id = @a";
        cmd.Parameters.AddWithValue("a", AccountA);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        reader.GetInt32(0).Should().Be(Trialing, "the daily job has not expired it; the pull did not need it");
        reader.GetDateTime(1).Should().BeCloseTo(seededUpdate, TimeSpan.FromMilliseconds(5));
    }

    [Fact]
    public async Task An_access_extension_reads_after_the_trial()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await CheckedInstitutionAsync();

        // Control: an expired farm with NO extension is after the trial and must choose.
        await SetStandingAsync(AccountA, Owner, Expired, DateTime.UtcNow.AddDays(-3), DateTime.UtcNow.AddDays(-3));
        var control = StateOf((await PullAsync(Owner)).Root, PlotA)!.Value;
        control.GetProperty("inTrial").GetBoolean().Should().BeFalse();
        control.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();

        // A pilot access extension keeps the farm working - and still counts as AFTER the trial (R9).
        await SetExtensionAsync(AccountA, DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(30));
        var extended = StateOf((await PullAsync(Owner)).Root, PlotA)!.Value;
        extended.GetProperty("inTrial").GetBoolean().Should().BeFalse("an extension counts as after the trial");
        extended.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();

        // Even a row still Trialing with days to go is after the trial once an extension is on.
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(5), DateTime.UtcNow.AddDays(5));
        var trialingWithExtension = StateOf((await PullAsync(Owner)).Root, PlotA)!.Value;
        trialingWithExtension.GetProperty("inTrial").GetBoolean().Should().BeFalse();
        trialingWithExtension.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task A_farm_with_no_subscription_row_reads_after_the_trial_and_a_crop_with_nothing_to_follow_asks_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // No owner_accounts / subscription row at all (RoleScopedFarm seeds none): after the trial.
        var (_, none) = await PullAsync(Owner);
        var state = StateOf(none, PlotA)!.Value;
        state.GetProperty("inTrial").GetBoolean().Should().BeFalse();

        // Grapes have only built-in samples here: the sample is followable (D-91 = 1), so PlotA is asked...
        state.GetProperty("canFollowSomething").GetBoolean().Should().BeTrue();
        state.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();

        // ...but a crop no schedule is listed for asks nothing (P5).
        var (strange, strangeCycle) = await SeedSeasonStartingAsync("Dragon fruit SCH-GATE", TodayIst().AddDays(-3));
        _ = strangeCycle;
        var other = StateOf((await PullAsync(Owner)).Root, strange)!.Value;
        other.GetProperty("canFollowSomething").GetBoolean().Should().BeFalse();
        other.GetProperty("needsSchedule").GetBoolean().Should().BeFalse("nothing asks while there is nothing he could follow");
    }
}
