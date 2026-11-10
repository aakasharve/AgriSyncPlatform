// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 3 ("his own schedule", following it; founder D-74, D-82 = 3, D-83 = 1; R30, R32; P4).
//
// A plot follows the farm's OWN schedule with NO check (D-82 = 3): adopt and migrate take it exactly when it STORES its days; an empty one answers
// OwnScheduleEmpty and writes nothing (never an invented stage or day). It is stamped with no check state, never reaches the check waiting list, and
// belongs to its FARM: a plot of the same owner's OTHER farm cannot follow it, and another farm's people never receive it. Real Postgres as
// agrisync_app (E3 first), through the real host, the real push handler and the real pull.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class OwnScheduleFollowRealPostgresTests(ITestOutputHelper output) : OwnScheduleLane(output)
{
    private static Dictionary<string, object?> Adopt(Guid farm, Guid plot, Guid cycle, Guid template) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["scheduleTemplateId"] = template,
        ["actorUserId"] = Owner,
        ["subscriptionId"] = Guid.NewGuid(),
    };

    private sealed record Marks(string? Origin, string? CheckAtAdopt, short? Slot, int State, Guid Template);

    private async Task<List<Marks>> MarksOfPlotAsync(Guid plot)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT origin, check_state_at_adopt, slot, state, schedule_template_id FROM ssf.schedule_subscriptions
            WHERE plot_id = @plot ORDER BY adopted_at_utc, id
            """;
        cmd.Parameters.AddWithValue("plot", plot);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Marks>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Marks(
                reader.IsDBNull(0) ? null : reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetInt16(2), reader.GetInt32(3), reader.GetGuid(4)));
        }

        return rows;
    }

    [Fact]
    public async Task An_empty_own_schedule_cannot_be_followed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var empty = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "रिकामं")).Body, "scheduleTemplateId");
        var stagesOnly = Guid.NewGuid();
        (await EditAsync(Owner, empty, FarmA, stagesOnly, stages: SomeStages())).Status.Should().Be(HttpStatusCode.Created);
        var auditBefore = (await ScheduleAuditAsync()).Count;

        foreach (var template in new[] { empty, stagesOnly })
        {
            var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, template);
            rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
            ErrorCode(rest.Body).Should().Be("ShramSafal.OwnScheduleEmpty");
            var pushed = await PushAsync(Owner, "adopt_schedule", $"sown-empty-{template:N}", Adopt(FarmA, PlotA, CycleA, template));
            pushed.Status.Should().Be("failed");
            pushed.ErrorCode.Should().Be("ShramSafal.OwnScheduleEmpty");
        }

        (await SubscriptionsAsync()).Should().BeEmpty("nothing was written");
        (await ScheduleAuditAsync()).Count.Should().Be(auditBefore);

        // Not vacuous: the same chain with its days is followed.
        var withDays = Guid.NewGuid();
        (await EditAsync(Owner, stagesOnly, FarmA, withDays, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, withDays)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task An_own_schedule_with_stored_days_is_followed_without_any_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedOwnWithDaysAsync(FarmA, Owner);
        (await ChecksOfAsync(own)).Should().Be(0);

        var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, own);

        status.Should().Be(HttpStatusCode.OK, body);
        var dto = Json(body);
        dto.GetProperty("origin").GetString().Should().Be("Own");
        dto.GetProperty("slot").GetInt16().Should().Be(0);
        (dto.TryGetProperty("checkState", out var live) ? live.ValueKind : JsonValueKind.Null).Should().Be(JsonValueKind.Null);
        (await MarksOfPlotAsync(PlotA)).Should().ContainSingle().Which.Should().Be(new Marks("Own", null, 0, 0, own));

        // It needs no check even when the crop HAS a checked schedule (that rule is for outside schedules), and both are followed side by side.
        var outside = await CheckedGrapeScheduleAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, outside.Id)).Status.Should().Be(HttpStatusCode.OK);
        var second = await SeedOwnWithDaysAsync(FarmA, Owner, "दुसरं माझं");
        var (plotP, cycleP) = await SeedSeasonAsync("Grapes");
        var viaPush = await PushAsync(Owner, "adopt_schedule", "sown-own-push", Adopt(FarmA, plotP, cycleP, second));
        viaPush.Status.Should().Be("applied", $"{viaPush.ErrorCode}: {viaPush.ErrorMessage}");
        (await MarksOfPlotAsync(plotP)).Should().ContainSingle().Which.Should().Be(new Marks("Own", null, 0, 0, second));

        // The pull carries no check state for it either.
        var (_, root) = await PullAsync(Owner);
        var mine = ArrayOf(root, "scheduleSubscriptions").Single(s => s.GetProperty("scheduleTemplateId").GetGuid() == own);
        (mine.TryGetProperty("checkState", out var pulled) ? pulled.ValueKind : JsonValueKind.Null).Should().Be(JsonValueKind.Null);
        mine.GetProperty("origin").GetString().Should().Be("Own");
    }

    [Fact]
    public async Task It_never_reaches_the_check_waiting_list()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureReviewSeatsAsync();
        var withDays = await SeedOwnWithDaysAsync(FarmA, Owner);
        var empty = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "रिकामं")).Body, "scheduleTemplateId");
        var waiting = await SeedStoredRowAsync("Grapes - an outside row waiting for its check");

        var (status, body) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", PlatformOwner, null);

        status.Should().Be(HttpStatusCode.OK, body);
        body.Should().Contain(waiting.Id.ToString(), "not vacuous: an outside row waiting IS listed");
        body.Should().NotContain(withDays.ToString()).And.NotContain(empty.ToString());
        (await ReviewLibraryAsync()).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(new[] { withDays, empty },
            "the reviewer is no seat of the farm: its own schedule is not his to see");
        var check = await CheckAsync(PlatformOwner, withDays, "Approved", []);
        check.Status.Should().Be(HttpStatusCode.NotFound, "only a Public row can be checked");
        (await ChecksOfAsync(withDays)).Should().Be(0);
    }

    [Fact]
    public async Task Its_subscription_and_library_entry_carry_no_check_state()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedOwnWithDaysAsync(FarmA, Owner);
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, own)).Status.Should().Be(HttpStatusCode.OK);

        var (_, workerRoot) = await PullAsync(Worker);
        var (_, root) = await PullAsync(Owner);

        var entry = ArrayOf(workerRoot, "scheduleTemplates").Single(t => t.GetProperty("id").GetGuid() == own);
        entry.GetProperty("check").ValueKind.Should().Be(JsonValueKind.Null);
        entry.GetProperty("hasStoredDays").GetBoolean().Should().BeTrue();
        var subscription = ArrayOf(root, "scheduleSubscriptions").Single(s => s.GetProperty("scheduleTemplateId").GetGuid() == own);
        (subscription.TryGetProperty("checkState", out var state) ? state.ValueKind : JsonValueKind.Null).Should().Be(JsonValueKind.Null);
        (await MarksOfPlotAsync(PlotA)).Single().CheckAtAdopt.Should().BeNull();
    }

    [Fact]
    public async Task Migrate_to_his_own_follows_the_same_rule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK);
        var empty = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "रिकामं")).Body, "scheduleTemplateId");
        var withDays = await SeedOwnWithDaysAsync(FarmA, Owner);

        async Task<(HttpStatusCode Status, string Body)> SwitchAsync(Guid template) =>
            await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{PlotA}/cycles/{CycleA}/schedule/migrate", Owner,
                new { farmId = FarmA, newScheduleTemplateId = template, reason = "Other" });

        var refused = await SwitchAsync(empty);
        refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Body);
        ErrorCode(refused.Body).Should().Be("ShramSafal.OwnScheduleEmpty");
        var pushedRefusal = await PushAsync(Owner, "migrate_schedule", "sown-migrate-empty", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["newScheduleTemplateId"] = empty,
            ["reason"] = "Other",
            ["actorUserId"] = Owner,
        });
        pushedRefusal.ErrorCode.Should().Be("ShramSafal.OwnScheduleEmpty");
        (await MarksOfPlotAsync(PlotA)).Should().ContainSingle().Which.State.Should().Be(0, "the plot still follows what it followed");

        var switched = await SwitchAsync(withDays);
        switched.Status.Should().Be(HttpStatusCode.OK, switched.Body);
        var marks = await MarksOfPlotAsync(PlotA);
        marks.Should().Contain(m => m.Template == withDays && m.Origin == "Own" && m.CheckAtAdopt == null && m.Slot == 0 && m.State == 0);
        marks.Should().Contain(m => m.Template == BuiltInGrapes && m.State != 0, "the switch ended the earlier one");
    }

    [Fact]
    public async Task A_chain_of_farm_A_is_not_Own_on_a_plot_of_the_same_owners_farm_B()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedSecondFarmOfOwnerAsync();
        var ofA = await SeedOwnWithDaysAsync(FarmA, Owner);

        var onC = await AdoptAsync(Owner, FarmC, PlotC, CycleC, ofA);
        var pushedOnC = await PushAsync(Owner, "adopt_schedule", "sown-other-farm", Adopt(FarmC, PlotC, CycleC, ofA));

        onC.Status.Should().Be(HttpStatusCode.NotFound, onC.Body);
        ErrorCode(onC.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound", "answered like a made-up id (R30, E4)");
        pushedOnC.ErrorCode.Should().Be("ShramSafal.ScheduleTemplateNotFound");
        (await MarksOfPlotAsync(PlotC)).Should().BeEmpty();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, ofA)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: its own farm's plot follows it");
    }

    [Fact]
    public async Task Another_farms_seat_never_receives_this_farms_own_schedule_in_the_library_pull()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureReviewSeatsAsync();
        await SeedSecondFarmOfOwnerAsync();
        // A person who works ONLY on the owner's other farm (D2: his other farms' seats do not see farm A's own schedule).
        await SeedSeatAsync(FarmC, PlatformEmployee, "Worker", FarmAuthority.SeeMoney);
        var own = await SeedOwnWithDaysAsync(FarmA, Owner);
        var empty = await SeedOwnEmptyAsync(FarmA, Owner, "रिकामं");

        async Task<List<Guid>> PulledAsync(Guid user) =>
            IdsOf((await PullAsync(user)).Root, "scheduleTemplates").ToList();

        (await PulledAsync(Owner)).Should().Contain(new[] { own, empty }, "the farm's owner");
        (await PulledAsync(Worker)).Should().Contain(new[] { own, empty }, "the farm's own seat");
        (await PulledAsync(OwnerB)).Should().NotContain(new[] { own, empty }, "another farm's owner");
        (await PulledAsync(PlatformEmployee)).Should().NotContain(new[] { own, empty }, "a seat of the same owner's OTHER farm (D2)");
        (await LibraryAsync(OwnerB)).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(new[] { own, empty });
        (await LibraryAsync(PlatformEmployee)).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(new[] { own, empty });
    }

    [Fact]
    public async Task Release_1_0_17_receives_a_pull_that_holds_an_empty_and_a_stored_own_schedule()
    {
        // P11: the pull and the library keep every field release 1.0.17 reads; the new rows are ordinary entries of the same shapes. The bodies are kept
        // (SCHA_P11_BODIES) for the P11 run: release b3d28967's OWN reconciler on them. An EMPTY own schedule lists no stage (1.0.17 drops a template it
        // cannot place); a STORED one is listed like any schedule.
        await AssertAppRoleIsNotVacuousAsync();
        var empty = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "रिकामं")).Body, "scheduleTemplateId");
        var stored = await SeedOwnWithDaysAsync(FarmA, Owner);
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, stored)).Status.Should().Be(HttpStatusCode.OK);

        foreach (var (who, user) in new[] { ("owner-with-own-schedules", Owner), ("worker-seat-with-own-schedules", Worker), ("other-farm-owner-without-them", OwnerB) })
        {
            using var response = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}", user, null, "1.0.17", null);
            var body = await response.Content.ReadAsStringAsync();
            response.IsSuccessStatusCode.Should().BeTrue(body);
            KeepP11Body(who, body);
            var root = Json(body);
            foreach (var template in ArrayOf(root, "scheduleTemplates"))
            {
                foreach (var key in new[] { "id", "name", "cropType", "totalDays", "stages", "activities", "versionHash" })
                {
                    template.TryGetProperty(key, out _).Should().BeTrue($"{who}: the field {key} release 1.0.17 reads is still there");
                }
            }

            foreach (var crop in ArrayOf(root, "cropTypes"))
            {
                foreach (var key in new[] { "name", "stages", "defaultTemplateId" })
                {
                    crop.TryGetProperty(key, out _).Should().BeTrue($"{who}: cropTypes still carry {key}");
                }
            }

            var listed = ArrayOf(root, "scheduleTemplates").ToDictionary(t => t.GetProperty("id").GetGuid());
            if (user == OwnerB)
            {
                listed.Keys.Should().NotContain(new[] { empty, stored });
                continue;
            }

            listed[empty].GetProperty("stages").GetArrayLength().Should().Be(0, "an empty own schedule lists no stage (nothing invented)");
            listed[stored].GetProperty("stages").GetArrayLength().Should().BeGreaterThan(0);
        }
    }

    // ── fix round 1, M001 (session A's ruling): Own = a row whose own_farm_id is THE PLOT's farm, nothing else ──

    [Fact]
    public async Task A_plain_Team_copy_of_a_public_row_is_never_own_and_cannot_be_followed_or_switched_to()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureReviewSeatsAsync();
        var checkedRow = await CheckedGrapeScheduleAsync();
        var withdrawn = await SeedStoredRowAsync("Grapes - withdrawn");
        (await CheckAsync(PlatformOwner, withdrawn.Id, "Approved", ActivityIdsOf(withdrawn))).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, withdrawn.Id, "Withdrawn", note: "मागे घेतलं")).Status.Should().Be(HttpStatusCode.OK);
        var waiting = await SeedStoredRowAsync("Grapes - waiting for its check");

        var copies = new List<(string Name, Guid Copy)>();
        foreach (var (name, source) in new[] { ("checked", checkedRow.Id), ("withdrawn", withdrawn.Id), ("waiting", waiting.Id) })
        {
            // A plain clone, as a Team row, naming no farm: the global role alone passes the scope gate (ScopeRoleGate), and the copy stores its days.
            var copy = Guid.NewGuid();
            var made = await ClonePlainAsync(Owner, source, null, copy, TenantScope.Team);
            made.Status.Should().Be(HttpStatusCode.Created, $"{name}: {made.Body}");
            var row = (await RowAsync(copy))!;
            (row.OwnFarm, row.Scope, row.Activities > 0).Should().Be(((Guid?)null, (int)TenantScope.Team, true), $"{name}: a plain Team copy that stores its days, naming no farm");
            copies.Add((name, copy));
        }

        foreach (var (name, copy) in copies)
        {
            // x1 answered OwnScheduleNotOpenYet for exactly this row and it still does: it is not a farm's own schedule, and no check applies to it.
            var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, copy);
            rest.Status.Should().Be(HttpStatusCode.BadRequest, $"{name}: {rest.Body}");
            ErrorCode(rest.Body).Should().Be("ShramSafal.OwnScheduleNotOpenYet", name);
            var pushed = await PushAsync(Owner, "adopt_schedule", $"sown-m001-{name}", Adopt(FarmA, PlotA, CycleA, copy));
            pushed.Status.Should().Be("failed");
            pushed.ErrorCode.Should().Be("ShramSafal.OwnScheduleNotOpenYet", name);
        }

        (await SubscriptionsAsync()).Should().BeEmpty("nothing was written");

        // Switching to it is refused the same way and the plot keeps what it followed.
        var (plot, cycle) = await SeedSeasonAsync("Grapes");
        (await AdoptAsync(Owner, FarmA, plot, cycle, checkedRow.Id)).Status.Should().Be(HttpStatusCode.OK);
        foreach (var (name, copy) in copies)
        {
            var switched = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot}/cycles/{cycle}/schedule/migrate", Owner,
                new { farmId = FarmA, newScheduleTemplateId = copy, reason = "BetterFit" });
            switched.Status.Should().Be(HttpStatusCode.BadRequest, $"{name}: {switched.Body}");
            ErrorCode(switched.Body).Should().Be("ShramSafal.OwnScheduleNotOpenYet", name);
        }

        var marks = await MarksOfPlotAsync(plot);
        marks.Should().ContainSingle().Which.Template.Should().Be(checkedRow.Id);
        marks.Single().State.Should().Be(0);
    }

    [Fact]
    public async Task The_planning_gate_shows_a_plain_Team_copy_closed_and_a_true_own_schedule_open()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureReviewSeatsAsync();
        // A crop with no built-in sample and only a WITHDRAWN outside schedule: nothing is followable but what the farm makes its own.
        var tomato = await CheckedScheduleOfCropAsync("tomato", "Tomato - University Schedule");
        (await CheckAsync(PlatformOwner, tomato.Id, "Withdrawn", note: "मागे घेतलं")).Status.Should().Be(HttpStatusCode.OK);
        var (plot, _) = await SeedSeasonAsync("Tomato");
        var copy = Guid.NewGuid();
        (await ClonePlainAsync(Owner, tomato.Id, null, copy, TenantScope.Team)).Status.Should().Be(HttpStatusCode.Created);

        async Task<bool> CanFollowSomethingAsync()
        {
            var (_, root) = await PullAsync(Owner);
            return ArrayOf(root, "plotPlanningState").Single(s => s.GetProperty("plotId").GetGuid() == plot).GetProperty("canFollowSomething").GetBoolean();
        }

        (await CanFollowSomethingAsync()).Should().BeFalse("a plain Team copy is closed to the gate, as it is to adopt (P5)");

        // Not vacuous: the farm's own schedule of that crop that stores its days opens it.
        var own = IdOf((await CreateAsync(Owner, FarmA, "Tomato", "माझं टोमॅटो")).Body, "scheduleTemplateId");
        (await CanFollowSomethingAsync()).Should().BeFalse("an empty own schedule is closed too");
        (await EditAsync(Owner, own, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await CanFollowSomethingAsync()).Should().BeTrue();
    }
}
