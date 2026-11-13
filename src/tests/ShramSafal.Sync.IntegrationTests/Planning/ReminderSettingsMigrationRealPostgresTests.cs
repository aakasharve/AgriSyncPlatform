// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-84 = 1; doctrine E3, E8).
//
// Migration 20261111090000_AddReminderSettings, really run both ways on a real Postgres: it ADDS ssf.farm_reminder_settings and
// ssf.reminder_always_show (FORCE-RLS on farm_id, SELECT / INSERT / UPDATE / DELETE to agrisync_app, the D-79 defaults, three CHECKs) and one
// nullable column on ssf.planned_work; nothing existing changes. Down() drops exactly those and the existing tasks are untouched (the farm falls
// back to the D-79 base). Proofs connect as agrisync_app, asserting first that it is neither superuser nor BYPASSRLS.
using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReminderSettingsMigrationRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    private const string ThisMigration = "20261111090000_AddReminderSettings";
    private const string MigrationBefore = "20261110120000_ScheduleTemplateOwnerAndMadeFor";

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

    private Task<long> TableCountAsync(string table) => CountAsync(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name = @t", ("t", table));

    private Task<long> ColumnCountAsync(string table, string column) => CountAsync(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = @t AND column_name = @c", ("t", table), ("c", column));

    private Task<long> PolicyCountAsync(string table) => CountAsync(
        "SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t", ("t", table));

    private Task<long> AppliedAsync() => CountAsync(
        "SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration));

    private async Task<bool> ForceRlsAsync(string table)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = @t";
        cmd.Parameters.AddWithValue("t", table);
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<bool> AppRoleMayAsync(string table, string privilege)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT has_table_privilege('{AppRoleUser}', 'ssf.{table}', '{privilege}')";
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task AssertHeadAsync()
    {
        (await AppliedAsync()).Should().Be(1);
        foreach (var table in new[] { "farm_reminder_settings", "reminder_always_show" })
        {
            (await TableCountAsync(table)).Should().Be(1, table);
            (await ForceRlsAsync(table)).Should().BeTrue($"{table}: row-level security is on and FORCED");
            (await PolicyCountAsync(table)).Should().Be(2, $"{table}: the tenant policy and the member read policy");
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE" })
            {
                (await AppRoleMayAsync(table, privilege)).Should().BeTrue($"{table}: agrisync_app {privilege} (current state, not a ledger)");
            }
        }

        (await ColumnCountAsync("planned_work", "reminder_audience_changed_at_utc")).Should().Be(1);
    }

    [Fact]
    public async Task Up_adds_exactly_the_two_tables_and_the_column_with_the_D79_defaults_the_checks_and_the_farm_wall()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AssertHeadAsync();

        // The defaults: a row naming only its farm reads MakerAndOwner / MakerAndOwner / PlotTeam.
        await ExecOnSuperuserAsync("INSERT INTO ssf.farm_reminder_settings (farm_id) VALUES (@f)", ("f", FarmA));
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT log_reminders_audience, own_reminders_audience, schedule_reminders_audience, updated_by_user_id, updated_at_utc FROM ssf.farm_reminder_settings WHERE farm_id = @f";
            cmd.Parameters.AddWithValue("f", FarmA);
            await using var reader = await cmd.ExecuteReaderAsync();
            (await reader.ReadAsync()).Should().BeTrue();
            (reader.GetString(0), reader.GetString(1), reader.GetString(2)).Should().Be(("MakerAndOwner", "MakerAndOwner", "PlotTeam"));
            reader.IsDBNull(3).Should().BeTrue();
            reader.IsDBNull(4).Should().BeTrue();
        }

        // The checks: each column keeps its own list.
        foreach (var bad in new[]
                 {
                     "UPDATE ssf.farm_reminder_settings SET log_reminders_audience = 'Planners' WHERE farm_id = @f",
                     "UPDATE ssf.farm_reminder_settings SET own_reminders_audience = 'Planners' WHERE farm_id = @f",
                     "UPDATE ssf.farm_reminder_settings SET schedule_reminders_audience = 'MakerAndOwner' WHERE farm_id = @f",
                     "UPDATE ssf.farm_reminder_settings SET log_reminders_audience = 'Everyone' WHERE farm_id = @f",
                 })
        {
            var act = async () => await ExecOnSuperuserAsync(bad, ("f", FarmA));
            (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("23514", bad);
        }

        // The farm wall, as agrisync_app: no farm in scope = no row; farm A's scope = farm A's row only; a write for another farm is refused.
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        await using (var tx = await app.BeginTransactionAsync())
        {
            (await ScalarAsync(app, tx, "SELECT count(*) FROM ssf.farm_reminder_settings")).Should().Be(0, "no farm in scope: nothing is visible (FORCE RLS)");
            await ScalarAsync(app, tx, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)::text IS NULL");
            (await ScalarAsync(app, tx, "SELECT count(*) FROM ssf.farm_reminder_settings")).Should().Be(1, "farm A's scope sees farm A's row");
            var foreign = async () => await ScalarAsync(app, tx, $"INSERT INTO ssf.farm_reminder_settings (farm_id) VALUES ('{FarmB}') RETURNING 1");
            (await foreign.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501", "a row of another farm is refused by the policy's WITH CHECK");
        }

        await using (var tx = await app.BeginTransactionAsync())
        {
            await ScalarAsync(app, tx, $"SELECT set_config('agrisync.farm_id', '{FarmB}', true)::text IS NULL");
            (await ScalarAsync(app, tx, "SELECT count(*) FROM ssf.farm_reminder_settings")).Should().Be(0, "farm B's scope cannot see farm A's settings");
        }
    }

    private static async Task<long> ScalarAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        var value = await cmd.ExecuteScalarAsync();
        return value is bool b ? (b ? 1 : 0) : Convert.ToInt64(value);
    }

    [Fact]
    public async Task Down_drops_exactly_what_Up_added_loses_only_the_settings_and_Up_runs_again()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Something to lose, and a reminder that must survive.
        var (_, reminder) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await MarkAsync(Owner, Worker)).Status.Should().Be(System.Net.HttpStatusCode.OK);
        (await CountAsync("SELECT count(*) FROM ssf.farm_reminder_settings")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.reminder_always_show")).Should().Be(1);
        var rowsBefore = await CountAsync("SELECT count(*) FROM ssf.planned_work");

        await MigrateAsync(MigrationBefore);

        (await AppliedAsync()).Should().Be(0);
        (await TableCountAsync("farm_reminder_settings")).Should().Be(0);
        (await TableCountAsync("reminder_always_show")).Should().Be(0);
        (await ColumnCountAsync("planned_work", "reminder_audience_changed_at_utc")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND policyname IN ('p_tenant_farm_reminder_settings', 'p_user_select_farm_reminder_settings', 'p_tenant_reminder_always_show', 'p_user_select_reminder_always_show')"))
            .Should().Be(0, "the four policies go with the tables");
        (await CountAsync("SELECT count(*) FROM ssf.planned_work")).Should().Be(rowsBefore, "no reminder or task is touched");
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE id = @id", ("id", reminder))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ReminderSettings'")).Should().BeGreaterThan(0, "the audit history is never touched (P3)");

        await MigrateAsync(null);
        await AssertHeadAsync();
        (await CountAsync("SELECT count(*) FROM ssf.farm_reminder_settings")).Should().Be(0, "the owner's settings were lost by Down(), as the migration says; every reminder is back on the D-79 base");
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE id = @id", ("id", reminder))).Should().Be(1);
    }
}
