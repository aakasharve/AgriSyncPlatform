// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 6 + the migration (founder D-24c, D-26; R19, P11).
//
// The authorities are live: the owner's switch screen can set PlanWork, AssignWork and SeeAllTasks (SeeAllTasks = 1 << 11, the next
// free bit at merge), every stored bit a seat already holds is unchanged, and the owner's /me/context-style roster lists all
// three. And the migration AddPlannedWork on a real Postgres as agrisync_app (E3 first): the grants, FORCE row security, the CHECKs,
// Down() (which destroys the two tables and nothing else) and the full chain booted twice.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkAuthoritiesRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    private const string ThisMigration = "20261108180000_AddPlannedWork";
    private const string MigrationBefore = "20261108150000_AddScheduleSubscriptionOriginAndCheck";

    private async Task<int> StoredBitsAsync(Guid user) => Convert.ToInt32(await ScalarAsync(
        "SELECT coalesce(permissions, 0) FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", user)));

    private async Task<object?> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    [Fact]
    public async Task The_owners_switch_screen_stores_PlanWork_AssignWork_and_SeeAllTasks_and_lists_them()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var bitsBefore = await StoredBitsAsync(CoOwner);
        bitsBefore.Should().Be(256, "the seat as the 2b upgrade left it: farm setup only");

        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/authorities", Owner, new
        {
            authorities = new object[]
            {
                new { name = "PlanWork", expiresAtUtc = (DateTime?)null },
                new { name = "AssignWork", expiresAtUtc = (DateTime?)null },
                new { name = "SeeAllTasks", expiresAtUtc = (DateTime?)null },
            },
        }))
        {
            var text = await set.Content.ReadAsStringAsync();
            set.StatusCode.Should().Be(HttpStatusCode.OK, text);
            JsonDocument.Parse(text).RootElement.GetProperty("authorities").EnumerateArray()
                .Select(a => a.GetProperty("name").GetString()).Should().BeEquivalentTo("PlanWork", "AssignWork", "SeeAllTasks");
        }

        (await StoredBitsAsync(Mukadam)).Should().Be(8 | 64 | (1 << 11), "PlanWork = 8, AssignWork = 64, SeeAllTasks = 1 << 11");

        // The roster the owner's switch screen reads lists all three for him, and the seats nobody touched are unchanged.
        using var roster = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/labour-permissions", Owner);
        var members = JsonDocument.Parse(await roster.Content.ReadAsStringAsync()).RootElement.EnumerateArray()
            .ToDictionary(m => m.GetProperty("userId").GetGuid());
        members[Mukadam].GetProperty("authorities").EnumerateArray().Select(a => a.GetProperty("name").GetString())
            .Should().Contain(["PlanWork", "AssignWork", "SeeAllTasks"]);
        members[Mukadam].GetProperty("permissions").EnumerateArray().Select(a => a.GetString())
            .Should().Contain("SeeAllTasks");
        (await StoredBitsAsync(CoOwner)).Should().Be(bitsBefore, "the existing stored bits are unchanged");
        (await StoredBitsAsync(Worker)).Should().Be(0);

        // The gates follow the stored bits, now: he gives work, and he sees all.
        (await MakeAsync(Mukadam, Guid.NewGuid(), assignee: Worker)).Status.Should().Be("applied");
        var ownersTask = Guid.NewGuid();
        await MadeAsync(Owner, ownersTask, assignee: Worker2);
        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(ownersTask);
    }

    [Fact]
    public async Task An_ended_grant_stops_holding_and_a_made_up_name_is_still_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/authorities", Owner, new
        {
            authorities = new object[] { new { name = "SeeAllTasks", expiresAtUtc = (DateTime?)DateTime.UtcNow.AddMinutes(30) } },
        }))
        {
            (await set.Content.ReadAsStringAsync()).Should().NotBeNullOrEmpty();
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var ownersTask = Guid.NewGuid();
        await MadeAsync(Owner, ownersTask, assignee: Worker2);
        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(ownersTask, "held until its end");

        // Past its end, the same stored bit holds nothing.
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET authority_expires_at = jsonb_build_object('2048', to_char((NOW() - INTERVAL '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", Mukadam));
        PlannedIds((await PullAsync(Mukadam)).Root).Should().NotContain(ownersTask, "an ended grant holds nothing");

        using var made = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/authorities", Owner, new
        {
            authorities = new object[] { new { name = "SeeEverything", expiresAtUtc = (DateTime?)null } },
        });
        made.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private static bool? ScopeSeeAllTasks(System.Text.Json.JsonElement root, Guid farm) =>
        ArrayOf(root, "accessScopes").Single(s => s.GetProperty("farmId").GetGuid() == farm)
            .TryGetProperty("seeAllTasks", out var v) && v.ValueKind != JsonValueKind.Null ? v.GetBoolean() : null;

    [Fact]
    public async Task The_pulled_scope_carries_SeeAllTasks_live_expired_and_switched_off_L001()
    {
        await AssertAppRoleIsNotVacuousAsync();
        ScopeSeeAllTasks((await PullAsync(Owner)).Root, FarmA).Should().BeTrue("the primary owner holds every authority");
        ScopeSeeAllTasks((await PullAsync(Mukadam)).Root, FarmA).Should().BeFalse("nothing stored");

        await GrantAsync(Mukadam, FarmAuthority.SeeAllTasks);
        ScopeSeeAllTasks((await PullAsync(Mukadam)).Root, FarmA).Should().BeTrue("while the grant is live");

        // A कामगार with the grant: the SAME value the task rule uses (one source), not narrowed by the label.
        await GrantAsync(Worker, FarmAuthority.SeeAllTasks);
        ScopeSeeAllTasks((await PullAsync(Worker)).Root, FarmA).Should().BeTrue();
        var ownersTask = Guid.NewGuid();
        await MadeAsync(Owner, ownersTask, assignee: Worker2);
        PlannedIds((await PullAsync(Worker)).Root).Should().Contain(ownersTask, "the scope flag and the rows agree");

        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET authority_expires_at = jsonb_build_object('2048', to_char((NOW() - INTERVAL '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", Mukadam));
        ScopeSeeAllTasks((await PullAsync(Mukadam)).Root, FarmA).Should().BeFalse("an ended grant arrives as false");

        await GrantAsync(Worker);
        ScopeSeeAllTasks((await PullAsync(Worker)).Root, FarmA).Should().BeFalse("switched off by the owner");
    }

    // ── the migration ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_tables_are_force_row_security_with_their_checks_and_the_app_role_holds_no_delete()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var table in new[] { "planned_work", "planned_work_plots" })
        {
            (await CountAsync("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = @t AND c.relrowsecurity AND c.relforcerowsecurity", ("t", table)))
                .Should().Be(1, $"{table} is ENABLE + FORCE row security");
            (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t AND policyname IN ('p_tenant_' || @t, 'p_user_select_' || @t)", ("t", table)))
                .Should().Be(2);
        }

        // A row the checks forbid never gets in, whoever writes it (the CHECKs are the table's own).
        foreach (var (what, columns, values) in new[]
        {
            ("a date and a loose word", "scope, planned_date, loose_when", "'Farm', DATE '2026-12-01', 'Week'"),
            ("a time without a date", "scope, planned_time", "'Farm', TIME '07:30'"),
            ("crew words without a person", "scope, crew_text", "'Farm', 'crew'"),
            ("a headcount of 0", "scope, assignee_user_id, expected_headcount", "'Farm', gen_random_uuid(), 0"),
            ("an unknown scope", "scope", "'Everywhere'"),
        })
        {
            var write = async () => await ExecOnSuperuserAsync($"""
                INSERT INTO ssf.planned_work (id, farm_id, title, status, source, recorded_on, linked_daily_log_ids, created_by_user_id,
                                              created_at_utc, modified_at_utc, former_assignee_user_ids, {columns})
                VALUES (gen_random_uuid(), @f, 'x', 'Open', 'Planning', DATE '2026-11-08', ARRAY[]::uuid[], gen_random_uuid(), NOW(), NOW(), ARRAY[]::uuid[], {values});
                """, ("f", FarmA));
            (await write.Should().ThrowAsync<PostgresException>(what)).Which.SqlState.Should().Be("23514", what);
        }

        // Not vacuous: the same insert without the fault is accepted.
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.planned_work (id, farm_id, title, status, source, recorded_on, linked_daily_log_ids, created_by_user_id,
                                          created_at_utc, modified_at_utc, former_assignee_user_ids, scope)
            VALUES (gen_random_uuid(), @f, 'x', 'Open', 'Planning', DATE '2026-11-08', '{}', gen_random_uuid(), NOW(), NOW(), '{}', 'Farm');
            """, ("f", FarmA));
    }

    [Fact]
    public async Task Down_drops_only_the_two_tables_and_Up_brings_them_back_and_the_chain_boots_twice()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var task = Guid.NewGuid();
        await MadeAsync(Owner, task, assignee: Mukadam);
        (await TaskCountAsync()).Should().Be(1);
        var membershipsBefore = await CountAsync("SELECT count(*) FROM ssf.farm_memberships");
        var plotsBefore = await CountAsync("SELECT count(*) FROM ssf.plots");

        await MigrateAsync(MigrationBefore);

        (await CountAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name IN ('planned_work', 'planned_work_plots')"))
            .Should().Be(0, "Down drops what Up created (and every task with it)");
        (await CountAsync("SELECT count(*) FROM ssf.farm_memberships")).Should().Be(membershipsBefore, "nothing else is touched");
        (await CountAsync("SELECT count(*) FROM ssf.plots")).Should().Be(plotsBefore);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'PlannedWork'")).Should().BeGreaterThan(0, "the audit trail is not Down's to remove");
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename LIKE 'planned_work%'")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(0);

        await MigrateAsync(null);

        (await CountAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name IN ('planned_work', 'planned_work_plots')")).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration))).Should().Be(1);
        (await TaskCountAsync()).Should().Be(0, "the tasks were lost with Down");
        // The grants came back with Up: the app role writes a task again, and still cannot delete.
        (await MakeAsync(Owner, Guid.NewGuid())).Status.Should().Be("applied");
        (await CountAsync("SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'agrisync_app' AND table_schema = 'ssf' AND table_name = 'planned_work' AND privilege_type = 'DELETE'"))
            .Should().Be(0);
    }

    private async Task MigrateAsync(string? target)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);
        var migrator = db.Database.GetService<IMigrator>();
        if (target is null)
        {
            await migrator.MigrateAsync();
        }
        else
        {
            await migrator.MigrateAsync(target);
        }
    }
}
