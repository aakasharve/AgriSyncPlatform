// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers")
// The migration AddScheduleTaskFormat, on a real Postgres, in both directions (doctrine E8: rollback is a tested path):
//   * additive: every existing schedule, stage and activity survives Down() and Up(), and only the task format goes;
//   * Down() REFUSES (and changes nothing) while any task, challenge or stage sign exists, and works once none does;
//   * Up() after a Down() puts the rules back: FORCE row security, the two policies, the trigger, and no UPDATE / DELETE for the application role.
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;
using static ShramSafal.Sync.IntegrationTests.Planning.ScheduleTaskDb;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleTaskMigrationRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    /// <summary>The ShramSafal migration this one follows (the head before slice 2).</summary>
    private const string PreviousMigration = "20261121032701_AddDfesQuestionContext";

    private readonly ScheduleTaskDb _db = new();

    public Task InitializeAsync() => _db.InitializeAsync();

    public Task DisposeAsync() => _db.DisposeAsync();

    private async Task MigrateSsfToAsync(string? target)
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_db.SuperuserConn).Options;
        await using var ssf = new ShramSafalDbContext(options);
        await ssf.Database.GetService<IMigrator>().MigrateAsync(target);
    }

    private Task<long> TableCountAsync() => _db.SuperCountAsync(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name IN ('schedule_tasks', 'schedule_challenges')");

    private Task<long> SignColumnCountAsync() => _db.SuperCountAsync(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_template_stages' AND column_name IN ('start_sign', 'end_sign')");

    [Fact]
    public async Task Down_refuses_while_a_task_exists_and_changes_nothing()
    {
        await _db.AssertAppRoleIsNotVacuousAsync(output);
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_tasks")).Should().Be(4);

        var down = async () => await MigrateSsfToAsync(PreviousMigration);

        (await down.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("Down refused");
        (await TableCountAsync()).Should().Be(2, "nothing was dropped");
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_tasks")).Should().Be(4);
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_challenges")).Should().Be(4);
        (await SignColumnCountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Down_refuses_for_a_stage_sign_alone()
    {
        await using (var raw = new NpgsqlConnection(_db.SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, "DELETE FROM ssf.schedule_tasks; DELETE FROM ssf.schedule_challenges;");
            await ExecAsync(raw, """UPDATE ssf.schedule_template_stages SET end_sign = 'काढणी' WHERE schedule_template_id = @id""", ("id", LibraryId));
        }

        var down = async () => await MigrateSsfToAsync(PreviousMigration);

        (await down.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("1 stage sign(s)");
        (await SignColumnCountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Down_then_Up_keeps_every_schedule_and_puts_the_rules_back()
    {
        await _db.AssertAppRoleIsNotVacuousAsync(output);
        var templatesBefore = await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_templates");
        var activitiesBefore = await _db.SuperCountAsync("SELECT count(*) FROM ssf.template_activities");
        var stagesBefore = await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_template_stages");
        await using (var raw = new NpgsqlConnection(_db.SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, "DELETE FROM ssf.schedule_tasks; DELETE FROM ssf.schedule_challenges;");
        }

        await MigrateSsfToAsync(PreviousMigration);

        (await TableCountAsync()).Should().Be(0, "Down() drops the two tables");
        (await SignColumnCountAsync()).Should().Be(0, "...and the two sign columns");
        (await _db.SuperCountAsync("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'ssf' AND p.proname = 'enforce_schedule_row_tenant'"))
            .Should().Be(0, "...and the trigger function");
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(templatesBefore, "every schedule survives Down()");
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.template_activities")).Should().Be(activitiesBefore);
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_template_stages")).Should().Be(stagesBefore);

        await MigrateSsfToAsync(null);

        (await TableCountAsync()).Should().Be(2);
        (await SignColumnCountAsync()).Should().Be(2);
        (await _db.SuperCountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(templatesBefore);
        (await _db.SuperCountAsync(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname IN ('schedule_tasks', 'schedule_challenges') AND c.relrowsecurity AND c.relforcerowsecurity"))
            .Should().Be(2, "Up() puts both tables back under FORCE row security");
        (await _db.SuperCountAsync("SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename IN ('schedule_tasks', 'schedule_challenges')"))
            .Should().Be(4, "a read policy and an insert policy each");
        (await _db.SuperCountAsync("SELECT count(*) FROM pg_trigger WHERE tgname IN ('tr_schedule_tasks_tenant', 'tr_schedule_challenges_tenant') AND NOT tgisinternal"))
            .Should().Be(2);

        // The rules work again as the application role: the owner writes onto his own version, another person is refused, nobody changes a row.
        (await _db.TryInsertTaskAsync(Owner1, Farm1, Team1Id, 1, Owner1, "after-up")).Should().BeNull();
        (await _db.TryInsertTaskAsync(Owner2, Farm2, Team1Id, 1, Owner2, "after-up-2")).Should().Be("42501");
        (await _db.VisibleKeysAsync(Worker1, Farm1)).Should().BeEmpty("no task was left in the tables after the rollback");
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }
}
