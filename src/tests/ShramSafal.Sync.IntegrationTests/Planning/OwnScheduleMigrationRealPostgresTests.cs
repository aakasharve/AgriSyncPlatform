// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 1 (founder D-74, D-82 = 3; register R30, R32; doctrine E8).
//
// Migration 20261109120000_AddScheduleTemplateOwnFarm gives ssf.schedule_templates a NULLABLE own_farm_id (a farm's own schedule names its farm),
// a foreign key to ssf.farms (ON DELETE RESTRICT), and RE-KEYS the one-copy index: ix_schedule_templates_derived_version keeps its NAME (the
// currently deployed binary catches that name) but now covers only rows that name no farm; ix_schedule_templates_derived_own_farm allows one own copy
// of a source PER FARM. Down() refuses while any row names a farm. Real Postgres as agrisync_app (E3 first), the migration chain really run both ways.
using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Migrations;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class OwnScheduleMigrationRealPostgresTests(ITestOutputHelper output) : OwnScheduleLane(output)
{
    private const string ThisMigration = "20261109120000_AddScheduleTemplateOwnFarm";
    private const string MigrationBefore = "20261109090000_AllowThreePlusOneSchedulesPerPlot";

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

    private async Task<string?> IndexDefAsync(string name)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT indexdef FROM pg_indexes WHERE schemaname = 'ssf' AND tablename = 'schedule_templates' AND indexname = @n";
        cmd.Parameters.AddWithValue("n", name);
        return (string?)await cmd.ExecuteScalarAsync();
    }

    private Task<long> ColumnCountAsync() => CountAsync(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_templates' AND column_name = 'own_farm_id'");

    private Task<long> AppliedAsync() => CountAsync(
        "SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration));

    /// <summary>A raw INSERT of a schedule row (superuser): the exception it raised, or null. <paramref name="ownFarm"/> null = what the old binary writes.</summary>
    private async Task<PostgresException?> InsertRowAsync(Guid id, Guid? derivedFrom, int version, Guid? ownFarm, bool hasOwnFarmColumn = true)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = hasOwnFarmColumn
            ? """
              INSERT INTO ssf.schedule_templates ("Id", name, stage, created_at_utc, version, tenant_scope, derived_from_template_id, own_farm_id)
              VALUES (@id, 'SCH-OWN row', '', NOW(), @version, 1, @derived, @own)
              """
            : """
              INSERT INTO ssf.schedule_templates ("Id", name, stage, created_at_utc, version, tenant_scope, derived_from_template_id)
              VALUES (@id, 'SCH-OWN row', '', NOW(), @version, 1, @derived)
              """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("version", version);
        cmd.Parameters.AddWithValue("derived", (object?)derivedFrom ?? DBNull.Value);
        if (hasOwnFarmColumn)
        {
            cmd.Parameters.AddWithValue("own", NpgsqlTypes.NpgsqlDbType.Uuid, (object?)ownFarm ?? DBNull.Value);
        }

        try
        {
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex;
        }
    }

    [Fact]
    public async Task The_head_schema_has_the_column_the_foreign_key_and_the_re_keyed_indexes()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await ColumnCountAsync()).Should().Be(1);
        (await CountAsync("""
            SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'ssf' AND t.relname = 'schedule_templates' AND c.conname = 'fk_schedule_templates_own_farm'
              AND c.contype = 'f' AND c.confdeltype = 'r' AND c.confrelid = 'ssf.farms'::regclass
            """)).Should().Be(1, "a foreign key to ssf.farms, ON DELETE RESTRICT");
        var plain = await IndexDefAsync("ix_schedule_templates_derived_version");
        plain.Should().Contain("UNIQUE").And.Contain("(derived_from_template_id, version)").And.Contain("own_farm_id IS NULL", "same name, narrower rows");
        var perFarm = await IndexDefAsync("ix_schedule_templates_derived_own_farm");
        perFarm.Should().Contain("UNIQUE").And.Contain("(derived_from_template_id, own_farm_id)").And.Contain("own_farm_id IS NOT NULL");
        (await IndexDefAsync("ix_schedule_templates_own_farm_id")).Should().NotBeNull();
    }

    [Fact]
    public async Task The_database_itself_holds_one_plain_copy_per_source_and_one_own_copy_per_source_and_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await SeedTemplateRowAsync("Grapes - a public source");

        // What the OLD binary does (no own_farm_id): the second plain copy of a source and version meets the same-named index it catches.
        (await InsertRowAsync(Guid.NewGuid(), source, 1, null)).Should().BeNull();
        var second = await InsertRowAsync(Guid.NewGuid(), source, 1, null, hasOwnFarmColumn: false);
        second.Should().NotBeNull();
        second!.SqlState.Should().Be("23505");
        second.ConstraintName.Should().Be("ix_schedule_templates_derived_version", "the deployed binary catches this exact name (E8)");

        // Own copies: one per (source, farm). Two farms may each have one; the same farm twice may not; a plain copy and an own copy do not clash.
        (await InsertRowAsync(Guid.NewGuid(), source, 1, FarmA)).Should().BeNull("an own copy does not meet the plain-copy index");
        (await InsertRowAsync(Guid.NewGuid(), source, 1, FarmB)).Should().BeNull("another farm's own copy of the same source and version");
        var again = await InsertRowAsync(Guid.NewGuid(), source, 1, FarmA);
        again.Should().NotBeNull();
        again!.ConstraintName.Should().Be("ix_schedule_templates_derived_own_farm");
        again.SqlState.Should().Be("23505");

        // A row that names a farm names a real one, and a farm that has such a row cannot be deleted from under it.
        var nobody = await InsertRowAsync(Guid.NewGuid(), null, 1, Guid.NewGuid());
        nobody.Should().NotBeNull();
        nobody!.SqlState.Should().Be("23503");
        nobody.ConstraintName.Should().Be("fk_schedule_templates_own_farm");
        var lonely = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@f, 'SCH-OWN lonely farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """, ("f", lonely), ("owner", Owner), ("account", AccountA));
        (await InsertRowAsync(Guid.NewGuid(), null, 1, lonely)).Should().BeNull();
        var deleteFarm = async () => await ExecOnSuperuserAsync("DELETE FROM ssf.farms WHERE \"Id\" = @f", ("f", lonely));
        var refused = (await deleteFarm.Should().ThrowAsync<PostgresException>()).Which;
        refused.SqlState.Should().Be("23503");
        refused.ConstraintName.Should().Be("fk_schedule_templates_own_farm", "ON DELETE RESTRICT: a farm with its own schedule cannot be deleted from under it");
    }

    [Fact]
    public async Task Down_refuses_while_an_own_farm_row_exists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedOwnEmptyAsync(FarmA, Owner);

        var down = async () => await MigrateAsync(MigrationBefore);

        (await down.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("Down refused: 1 schedule rows are a farm's own schedule");
        (await AppliedAsync()).Should().Be(1, "the migration stays applied");
        (await ColumnCountAsync()).Should().Be(1);
        (await RowAsync(own))!.OwnFarm.Should().Be(FarmA, "nothing changed");
        (await IndexDefAsync("ix_schedule_templates_derived_own_farm")).Should().NotBeNull();

        // The refusal is plain SQL on a table with no row policy: the app role (non-super, non-bypass) raises it too.
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText = AddScheduleTemplateOwnFarm.DownRefusalSql;
        var asApp = async () => await cmd.ExecuteNonQueryAsync();
        (await asApp.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Contain("Down refused");
    }

    [Fact]
    public async Task Down_succeeds_with_no_own_row_restores_the_old_index_and_Up_changes_no_existing_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await SeedTemplateRowAsync("Grapes - a public source");
        var copy = Guid.NewGuid();
        (await InsertRowAsync(copy, source, 1, null)).Should().BeNull();
        var rowsBefore = await TemplateRowCountAsync();

        await MigrateAsync(MigrationBefore);

        (await AppliedAsync()).Should().Be(0);
        (await ColumnCountAsync()).Should().Be(0);
        (await IndexDefAsync("ix_schedule_templates_derived_own_farm")).Should().BeNull();
        (await IndexDefAsync("ix_schedule_templates_own_farm_id")).Should().BeNull();
        var old = await IndexDefAsync("ix_schedule_templates_derived_version");
        old.Should().Contain("UNIQUE").And.Contain("(derived_from_template_id, version)").And.NotContain("own_farm_id", "the index is as 20260420211528 made it");
        (await CountAsync("SELECT count(*) FROM pg_constraint WHERE conname = 'fk_schedule_templates_own_farm'")).Should().Be(0);
        (await TemplateRowCountAsync()).Should().Be(rowsBefore, "Down() keeps every row");

        await MigrateAsync(null);

        (await AppliedAsync()).Should().Be(1);
        (await ColumnCountAsync()).Should().Be(1);
        (await TemplateRowCountAsync()).Should().Be(rowsBefore, "Up() on a database with rows keeps every row");
        (await RowAsync(copy))!.OwnFarm.Should().BeNull("no existing row is a farm's own schedule");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE own_farm_id IS NOT NULL")).Should().Be(0);
        (await IndexDefAsync("ix_schedule_templates_derived_version")).Should().Contain("own_farm_id IS NULL");
        await MigrateAsync(null); // a second boot of the chain is a no-op
        (await AppliedAsync()).Should().Be(1);
    }

    [Fact]
    public async Task The_old_one_copy_rule_still_holds_for_a_plain_copy_after_Up()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var shared = await SeedTemplateRowAsync("Grapes - shared");

        var first = await ClonePlainAsync(Owner, shared, FarmA, Guid.NewGuid());
        var second = await ClonePlainAsync(OwnerB, shared, FarmB, Guid.NewGuid());

        first.Status.Should().Be(System.Net.HttpStatusCode.Created, first.Body);
        second.Status.Should().Be(System.Net.HttpStatusCode.Conflict, "D3: non-own copies keep the global one-copy rule: " + second.Body);
        ErrorCode(second.Body).Should().Be("ShramSafal.ScheduleCopy.Conflict");
    }
}
