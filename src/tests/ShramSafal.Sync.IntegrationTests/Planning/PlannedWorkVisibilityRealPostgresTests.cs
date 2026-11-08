// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 2 (founder D-24e1, D-26, D-79; MU design §11.6; E3, E4).
//
// Who sees a task, on the pull AND on the REST reads, on a real Postgres as agrisync_app (E3 first, in every fact), through the
// real host and the real push handler: the owner and the assignee see it; an unrelated worker gets nothing by either road; a
// सहमालक without SeeAllTasks sees only what he made, with it everything; a reminder is seen by its maker and the primary owner
// (D-79); a chosen-plots seat sees only his plots' rows; another farm's task id answers like a made-up id; the app role cannot
// delete; and the audit trail of a task follows the task's readers and holds no words.
using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkVisibilityRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    [Fact]
    public async Task Owner_and_assignee_see_the_task_on_pull_and_REST()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);

        PlannedIds((await PullAsync(Owner)).Root).Should().Contain(task);
        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(task, "he is the assignee");
        foreach (var user in new[] { Owner, Mukadam })
        {
            var (status, body) = await GetAsync(user, TaskUrl(task));
            status.Should().Be(HttpStatusCode.OK, body);
            JsonDocument.Parse(body).RootElement.GetProperty("id").GetGuid().Should().Be(task);
            var (listStatus, list) = await GetAsync(user, $"/shramsafal/farms/{FarmA}/planned-work");
            listStatus.Should().Be(HttpStatusCode.OK, list);
            JsonDocument.Parse(list).RootElement.EnumerateArray().Select(t => t.GetProperty("id").GetGuid()).Should().Contain(task);
        }

        var row = TasksOf((await PullAsync(Mukadam)).Root).Single(t => t.GetProperty("id").GetGuid() == task);
        row.GetProperty("status").GetString().Should().Be("Assigned");
        row.GetProperty("assigneeUserId").GetGuid().Should().Be(Mukadam);
        row.GetProperty("createdByUserId").GetGuid().Should().Be(Owner);
        row.GetProperty("plots").EnumerateArray().Select(p => p.GetProperty("plotId").GetGuid()).Should().Equal(PlotA);
    }

    [Fact]
    public async Task An_unrelated_worker_gets_0_rows_by_pull_AND_by_direct_REST()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);

        // Not vacuous: a seat that may see it does.
        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(task);

        var (body, worker) = await PullAsync(Worker);
        TasksOf(worker).Should().BeEmpty();
        body.Should().NotContain(task.ToString(), "not even its id reaches him");

        var (byId, byIdBody) = await GetAsync(Worker, TaskUrl(task));
        byId.Should().Be(HttpStatusCode.NotFound);
        byIdBody.Should().NotContain("द्राक्षाला", "none of its words");
        var (listStatus, list) = await GetAsync(Worker, $"/shramsafal/farms/{FarmA}/planned-work");
        listStatus.Should().Be(HttpStatusCode.OK);
        JsonDocument.Parse(list).RootElement.GetArrayLength().Should().Be(0);
        list.Should().NotContain(task.ToString());

        // A crew headcount gives no other worker access.
        var crew = Guid.NewGuid();
        await MadeAsync(Owner, crew, assignee: Mukadam, crew: "मुकादम आणि ५ बायका", headcount: 6);
        PlannedIds((await PullAsync(Worker2)).Root).Should().BeEmpty();
        (await GetAsync(Worker2, TaskUrl(crew))).Status.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_co_owner_without_SeeAllTasks_sees_only_his_own_and_with_it_all()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ownersTask = Guid.NewGuid();
        var coOwnersReminder = Guid.NewGuid();
        await MadeAsync(Owner, ownersTask, assignee: Mukadam);
        await MadeAsync(CoOwner, coOwnersReminder);

        var before = PlannedIds((await PullAsync(CoOwner)).Root);
        before.Should().Equal([coOwnersReminder], "only the one he made");
        (await GetAsync(CoOwner, TaskUrl(ownersTask))).Status.Should().Be(HttpStatusCode.NotFound);

        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks);

        PlannedIds((await PullAsync(CoOwner)).Root).Should().BeEquivalentTo([ownersTask, coOwnersReminder]);
        (await GetAsync(CoOwner, TaskUrl(ownersTask))).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_reminder_is_seen_by_its_maker_and_the_primary_owner_only_D79()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var reminder = Guid.NewGuid();
        await MadeAsync(Mukadam, reminder); // no assignee: a personal reminder, any Active member may make one

        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(reminder);
        PlannedIds((await PullAsync(Owner)).Root).Should().Contain(reminder);
        PlannedIds((await PullAsync(CoOwner)).Root).Should().BeEmpty("a सहमालक without the grant");
        PlannedIds((await PullAsync(Worker)).Root).Should().BeEmpty();
        (await GetAsync(CoOwner, TaskUrl(reminder))).Status.Should().Be(HttpStatusCode.NotFound);
        (await GetAsync(Owner, TaskUrl(reminder))).Status.Should().Be(HttpStatusCode.OK);

        // By the same rule, a holder of SeeAllTasks sees it.
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks);
        PlannedIds((await PullAsync(CoOwner)).Root).Should().Contain(reminder);
    }

    [Fact]
    public async Task A_chosen_plots_seat_sees_only_his_plots_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks);
        await SetChosenPlotsAsync(CoOwner, plot2);

        var both = Guid.NewGuid();
        var onlyA = Guid.NewGuid();
        var farmWide = Guid.NewGuid();
        await MadeAsync(Owner, both, plots: [PlotA, plot2], scope: "MultiPlot");
        await MadeAsync(Owner, onlyA, plots: [PlotA]);
        await MadeAsync(Owner, farmWide, scope: "Farm");

        var (body, coOwner) = await PullAsync(CoOwner);
        PlannedIds(coOwner).Should().Equal([both], "a plot task only with one of his plots; a Farm task only as maker or assignee");
        TasksOf(coOwner).Single().GetProperty("plots").EnumerateArray().Select(p => p.GetProperty("plotId").GetGuid())
            .Should().Equal([plot2], "only his plots' rows");
        body.Should().NotContain(PlotA.ToString(), "no other plot is even named");

        var (status, rest) = await GetAsync(CoOwner, TaskUrl(both));
        status.Should().Be(HttpStatusCode.OK);
        rest.Should().NotContain(PlotA.ToString());
        (await GetAsync(CoOwner, TaskUrl(onlyA))).Status.Should().Be(HttpStatusCode.NotFound);
        (await GetAsync(CoOwner, TaskUrl(farmWide))).Status.Should().Be(HttpStatusCode.NotFound);

        // The owner still sees all three with every row.
        PlannedIds((await PullAsync(Owner)).Root).Should().BeEquivalentTo([both, onlyA, farmWide]);
    }

    [Fact]
    public async Task Another_farms_task_id_answers_like_a_made_up_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);
        var madeUp = Guid.NewGuid();

        // Farm B's owner asks farm B about farm A's task, and about an id that never existed: the same answer.
        var real = await GetAsync(OwnerB, TaskUrl(task, FarmB));
        var fake = await GetAsync(OwnerB, TaskUrl(madeUp, FarmB));
        real.Status.Should().Be(HttpStatusCode.NotFound);
        real.Status.Should().Be(fake.Status);
        JsonDocument.Parse(real.Body).RootElement.GetProperty("error").GetString()
            .Should().Be(JsonDocument.Parse(fake.Body).RootElement.GetProperty("error").GetString());

        // Naming farm A (not his): refused exactly as for a made-up id there.
        var refusedReal = await GetAsync(OwnerB, TaskUrl(task, FarmA));
        var refusedFake = await GetAsync(OwnerB, TaskUrl(madeUp, FarmA));
        refusedReal.Status.Should().Be(refusedFake.Status);
        refusedReal.Status.Should().Be(HttpStatusCode.Forbidden);

        PlannedIds((await PullAsync(OwnerB)).Root).Should().BeEmpty();
        (await PullAsync(OwnerB)).Body.Should().NotContain(task.ToString());
    }

    [Fact]
    public async Task No_DELETE_privilege_and_the_audit_payload_holds_no_title_words_or_assignee()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam, crew: "मुकादम आणि ५ बायका", headcount: 6);
        (await StepAsync(Mukadam, "accept", task)).Status.Should().Be("applied");

        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            foreach (var table in new[] { "ssf.planned_work", "ssf.planned_work_plots" })
            {
                foreach (var privilege in new[] { "DELETE", "TRUNCATE" })
                {
                    await using var cmd = app.CreateCommand();
                    cmd.CommandText = $"SELECT has_table_privilege('agrisync_app', '{table}', '{privilege}')";
                    ((bool)(await cmd.ExecuteScalarAsync())!).Should().BeFalse($"{table} {privilege}");
                }

                await using var update = app.CreateCommand();
                update.CommandText = $"SELECT has_table_privilege('agrisync_app', '{table}', 'UPDATE')";
                ((bool)(await update.ExecuteScalarAsync())!).Should().BeTrue($"{table} UPDATE (a state changes, a row is never removed)");
            }

            await using var delete = app.CreateCommand();
            delete.CommandText = "DELETE FROM ssf.planned_work";
            var attempt = async () => await delete.ExecuteNonQueryAsync();
            (await attempt.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        }

        (await TaskCountAsync()).Should().Be(1);

        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using var audit = raw.CreateCommand();
        audit.CommandText = "SELECT action, payload::text FROM ssf.audit_events WHERE entity_type = 'PlannedWork' AND entity_id = @id ORDER BY occurred_at_utc";
        audit.Parameters.AddWithValue("id", task);
        await using var reader = await audit.ExecuteReaderAsync();
        var rows = new System.Collections.Generic.List<(string Action, string Payload)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetString(1)));
        }

        rows.Select(r => r.Action).Should().Equal("PlannedWorkCreated", "PlannedWorkAccepted");
        foreach (var (_, payload) in rows)
        {
            JsonDocument.Parse(payload).RootElement.EnumerateObject().Select(p => p.Name.ToLowerInvariant())
                .Should().BeEquivalentTo(["plannedworkid", "farmid", "status", "step"], "exactly these four, nothing more");
            payload.Should().NotContain("द्राक्षाला").And.NotContain("मुकादम").And.NotContain(Mukadam.ToString(), "no title, no words, no assignee");
        }
    }

    [Fact]
    public async Task The_audit_trail_of_a_hidden_task_answers_exactly_like_a_made_up_id_L004()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = 1 | 2 | 256 WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", CoOwner));
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);

        var hidden = await GetAsync(CoOwner, $"/shramsafal/audit?entityType=PlannedWork&entityId={task}&farmId={FarmA}");
        var madeUp = await GetAsync(CoOwner, $"/shramsafal/audit?entityType=PlannedWork&entityId={Guid.NewGuid()}&farmId={FarmA}");
        hidden.Status.Should().Be(madeUp.Status);
        hidden.Body.Should().Be(madeUp.Body);
        hidden.Body.Should().NotContain(task.ToString());
        // Not vacuous: a reader who may see the task gets its row.
        JsonDocument.Parse((await GetAsync(Owner, $"/shramsafal/audit?entityType=PlannedWork&entityId={task}&farmId={FarmA}")).Body)
            .RootElement.GetArrayLength().Should().Be(1);
    }

    [Fact]
    public async Task The_audit_trail_of_a_task_is_hidden_from_a_member_who_cannot_see_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The सहमालक may read the farm's whole trail (money rights, every plot) but holds no SeeAllTasks.
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = 1 | 2 | 256 WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", CoOwner));
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);

        var owner = await GetAsync(Owner, $"/shramsafal/audit?entityType=PlannedWork&entityId={task}&farmId={FarmA}");
        owner.Status.Should().Be(HttpStatusCode.OK, owner.Body);
        JsonDocument.Parse(owner.Body).RootElement.GetArrayLength().Should().Be(1, "the owner sees the task's trail");

        var coOwnerTrail = await GetAsync(CoOwner, $"/shramsafal/audit?entityType=PlannedWork&entityId={task}&farmId={FarmA}");
        coOwnerTrail.Status.Should().Be(HttpStatusCode.OK, "fix round 1 (L004): a hidden task answers like a made-up id");
        JsonDocument.Parse(coOwnerTrail.Body).RootElement.GetArrayLength().Should().Be(0, "none of its rows");

        var farmStream = await GetAsync(CoOwner, $"/shramsafal/audit?farmId={FarmA}");
        farmStream.Status.Should().Be(HttpStatusCode.OK, farmStream.Body);
        JsonDocument.Parse(farmStream.Body).RootElement.EnumerateArray()
            .Where(e => e.GetProperty("entityType").GetString() == "PlannedWork").Should().BeEmpty("no task row reaches him");
        var ownerStream = await GetAsync(Owner, $"/shramsafal/audit?farmId={FarmA}");
        JsonDocument.Parse(ownerStream.Body).RootElement.EnumerateArray()
            .Count(e => e.GetProperty("entityType").GetString() == "PlannedWork").Should().Be(1, "not vacuous: the owner's stream has it");

        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        (await GetAsync(CoOwner, $"/shramsafal/audit?entityType=PlannedWork&entityId={task}&farmId={FarmA}")).Status
            .Should().Be(HttpStatusCode.OK, "with SeeAllTasks he sees the task, so its trail");
    }
}
