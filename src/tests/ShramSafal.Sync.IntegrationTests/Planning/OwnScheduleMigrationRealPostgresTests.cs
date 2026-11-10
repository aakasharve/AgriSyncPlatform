// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-133 withdrawn, D-136, D-137; register F218, F220, F222; doctrine E8).
//
// Migration 20261110120000_ScheduleTemplateOwnerAndMadeFor: ssf.schedule_templates gets a NULLABLE owner_user_id (a PERSON's own schedule names its owner,
// the owner of the farm it was made on) and four nullable made-for tag columns; SOWN-a's own-farm rows are CONVERTED to their farm's owner, then SOWN-a's
// own-farm column (named below only to prove it is gone), its foreign key and its index are DROPPED; the one-copy index ix_schedule_templates_derived_version keeps its NAME (the deployed binary
// catches it) and now covers rows with no owner; ix_schedule_templates_derived_owner allows one own copy of a source PER PERSON. No foreign key on
// owner_user_id (public.users is another context's; the gate is the defence, E4). Down() refuses while any row has an owner or a tag; else it rebuilds
// SOWN-a's shape. Real Postgres as agrisync_app (E3 first), the migration chain really run both ways.
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
    private const string ThisMigration = "20261110120000_ScheduleTemplateOwnerAndMadeFor";
    private const string MigrationBefore = "20261109120000_AddScheduleTemplateOwnFarm";

    private static readonly string[] NewColumns = ["owner_user_id", "variety", "soil_type", "region_code", "climate"];

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

    private Task<long> ColumnCountAsync(string column) => CountAsync(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_templates' AND column_name = @c", ("c", column));

    private async Task<(string Type, int? Width)> ColumnTypeAsync(string column)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_templates' AND column_name = @c";
        cmd.Parameters.AddWithValue("c", column);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue($"column {column} exists");
        return (reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetInt32(1));
    }

    private Task<long> AppliedAsync() => CountAsync(
        "SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", ThisMigration));

    private Task<long> OwnFarmForeignKeyCountAsync() => CountAsync("""
        SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'ssf' AND t.relname = 'schedule_templates' AND c.conname = 'fk_schedule_templates_own_farm'
          AND c.contype = 'f' AND c.confdeltype = 'r' AND c.confrelid = 'ssf.farms'::regclass
        """);

    /// <summary>A raw INSERT on the HEAD shape (superuser): the exception it raised, or null. <paramref name="owner"/> null = what the pre-SCH-OWN binary writes.</summary>
    private async Task<PostgresException?> InsertRowAsync(Guid id, Guid? derivedFrom, int version, Guid? owner, bool namesOwnerColumn = true, string? climate = null)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = namesOwnerColumn
            ? """
              INSERT INTO ssf.schedule_templates ("Id", name, stage, created_at_utc, version, tenant_scope, derived_from_template_id, owner_user_id, climate)
              VALUES (@id, 'SCH-OWN-c row', '', NOW(), @version, 1, @derived, @owner, @climate)
              """
            : """
              INSERT INTO ssf.schedule_templates ("Id", name, stage, created_at_utc, version, tenant_scope, derived_from_template_id)
              VALUES (@id, 'SCH-OWN-c row', '', NOW(), @version, 1, @derived)
              """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("version", version);
        cmd.Parameters.AddWithValue("derived", (object?)derivedFrom ?? DBNull.Value);
        if (namesOwnerColumn)
        {
            cmd.Parameters.AddWithValue("owner", NpgsqlTypes.NpgsqlDbType.Uuid, (object?)owner ?? DBNull.Value);
            cmd.Parameters.AddWithValue("climate", NpgsqlTypes.NpgsqlDbType.Varchar, (object?)climate ?? DBNull.Value);
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

    /// <summary>A raw INSERT on SOWN-a's shape (own_farm_id; only valid while the database is at <see cref="MigrationBefore"/>).</summary>
    private Task InsertOldShapeRowAsync(Guid id, Guid? derivedFrom, int version, Guid? ownFarm) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.schedule_templates ("Id", name, stage, created_at_utc, version, tenant_scope, derived_from_template_id, own_farm_id)
        VALUES (@id, 'SOWN-a row', '', NOW(), @version, 1, @derived, @own)
        """, ("id", id), ("version", version), ("derived", (object?)derivedFrom ?? DBNull.Value), ("own", (object?)ownFarm ?? DBNull.Value));

    private async Task AssertHeadShapeAsync()
    {
        foreach (var column in NewColumns)
        {
            (await ColumnCountAsync(column)).Should().Be(1, column);
        }

        (await ColumnTypeAsync("owner_user_id")).Type.Should().Be("uuid");
        foreach (var tag in new[] { "variety", "soil_type", "region_code", "climate" })
        {
            (await ColumnTypeAsync(tag)).Should().Be(("character varying", (int?)40), tag);
        }

        (await ColumnCountAsync("own_farm_id")).Should().Be(0, "own_farm_id is gone (R-c1)");
        (await OwnFarmForeignKeyCountAsync()).Should().Be(0, "and so is its foreign key");
        (await CountAsync("SELECT count(*) FROM pg_constraint WHERE conname = 'fk_schedule_templates_own_farm'")).Should().Be(0);
        (await IndexDefAsync("ix_schedule_templates_own_farm_id")).Should().BeNull();
        (await IndexDefAsync("ix_schedule_templates_derived_own_farm")).Should().BeNull();
        var plain = await IndexDefAsync("ix_schedule_templates_derived_version");
        plain.Should().Contain("UNIQUE").And.Contain("(derived_from_template_id, version)").And.Contain("owner_user_id IS NULL", "same name, rows with no owner");
        var perOwner = await IndexDefAsync("ix_schedule_templates_derived_owner");
        perOwner.Should().Contain("UNIQUE").And.Contain("(derived_from_template_id, owner_user_id)").And.Contain("owner_user_id IS NOT NULL");
        (await IndexDefAsync("ix_schedule_templates_owner_user_id")).Should().NotBeNull().And.Contain("owner_user_id IS NOT NULL");
        (await CountAsync("""
            SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'ssf' AND t.relname = 'schedule_templates' AND c.contype = 'f' AND c.confrelid = 'public.users'::regclass
            """)).Should().Be(0, "no foreign key to public.users (R-c3): the gate is the defence");
    }

    [Fact]
    public async Task The_head_schema_has_the_owner_and_made_for_columns_the_re_keyed_indexes_and_no_own_farm_column_or_foreign_key()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await AppliedAsync()).Should().Be(1);
        await AssertHeadShapeAsync();
    }

    [Fact]
    public async Task The_database_itself_holds_one_plain_copy_per_source_and_one_own_copy_per_source_and_owner()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await SeedTemplateRowAsync("Grapes - a public source");

        // What the pre-SCH-OWN binary does (it names no owner column): the second plain copy of a source and version meets the same-named index it catches.
        (await InsertRowAsync(Guid.NewGuid(), source, 1, null)).Should().BeNull();
        var second = await InsertRowAsync(Guid.NewGuid(), source, 1, null, namesOwnerColumn: false);
        second.Should().NotBeNull();
        second!.SqlState.Should().Be("23505");
        second.ConstraintName.Should().Be("ix_schedule_templates_derived_version", "the deployed binary catches this exact name (E8)");

        // Own copies: one per (source, OWNER). Two owners may each have one; the same owner twice may not; a plain copy and an own copy do not clash.
        (await InsertRowAsync(Guid.NewGuid(), source, 1, Owner)).Should().BeNull("an own copy does not meet the plain-copy index");
        (await InsertRowAsync(Guid.NewGuid(), source, 1, OwnerB)).Should().BeNull("another owner's own copy of the same source and version");
        var again = await InsertRowAsync(Guid.NewGuid(), source, 1, Owner);
        again.Should().NotBeNull();
        again!.ConstraintName.Should().Be("ix_schedule_templates_derived_owner");
        again.SqlState.Should().Be("23505");

        // No foreign key on owner_user_id (R-c3): a made-up owner uuid is ACCEPTED by the database. The gate is the defence (E4): the id is only ever copied
        // from a farm row the gate trusted, and nothing deletes a user row.
        (await InsertRowAsync(Guid.NewGuid(), null, 1, Guid.NewGuid())).Should().BeNull("no foreign key to public.users: a made-up owner is accepted by the database (R-c3)");
    }

    [Fact]
    public async Task Up_converts_a_farm_own_row_to_its_farms_owner_and_keeps_every_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var rowsBefore = await TemplateRowCountAsync();

        await MigrateAsync(MigrationBefore);
        (await AppliedAsync()).Should().Be(0);
        (await ColumnCountAsync("own_farm_id")).Should().Be(1, "SOWN-a's shape is back");
        var farmOwn = Guid.NewGuid();
        var plain = Guid.NewGuid();
        await InsertOldShapeRowAsync(farmOwn, null, 1, FarmA);
        await InsertOldShapeRowAsync(plain, null, 1, null);

        await MigrateAsync(null);

        (await AppliedAsync()).Should().Be(1);
        (await TemplateRowCountAsync()).Should().Be(rowsBefore + 2, "Up() keeps every row");
        (await RowAsync(farmOwn))!.OwnerUser.Should().Be(Owner, "a farm's own became its OWNER's own (exactly the new meaning)");
        (await RowAsync(plain))!.OwnerUser.Should().BeNull("a row that named no farm names no owner");
        (await ColumnCountAsync("own_farm_id")).Should().Be(0);
        await AssertHeadShapeAsync();

        await MigrateAsync(null); // a second boot of the chain is a no-op
        (await AppliedAsync()).Should().Be(1);
        (await TemplateRowCountAsync()).Should().Be(rowsBefore + 2);
    }

    [Fact]
    public async Task Up_refuses_on_purpose_with_words_when_one_owner_holds_two_own_copies_of_one_source_on_two_farms_and_converts_nothing()
    {
        // Fix round 1 (review P002): SOWN-a allowed one own copy PER FARM, so an owner of farms A and C could hold (S, farm A) and (S, farm C). After the
        // conversion both would be (S, owner) and the one-own-copy-per-person index could not be built (23505, an unexplained failure of the whole chain).
        // Production holds no such row (F220); a lane database may. Up() looks first and refuses with words, changing nothing.
        await AssertAppRoleIsNotVacuousAsync();
        await SeedSecondFarmOfOwnerAsync();
        await MigrateAsync(MigrationBefore);
        (await AppliedAsync()).Should().Be(0);
        var source = Guid.NewGuid();
        var onFarmA = Guid.NewGuid();
        var onFarmC = Guid.NewGuid();
        await InsertOldShapeRowAsync(source, null, 1, null);
        await InsertOldShapeRowAsync(onFarmA, source, 1, FarmA);
        await InsertOldShapeRowAsync(onFarmC, source, 1, FarmC); // SOWN-a's index (derived_from_template_id, own_farm_id) allowed this

        var up = async () => await MigrateAsync(null);

        var refused = (await up.Should().ThrowAsync<Exception>()).Which.ToString();
        refused.Should().Contain("Up refused").And.Contain("more than one own copy of the same schedule").And.Contain("Keep one", "it says what to do")
            .And.NotContain("23505", "a planned refusal, not an index failure");
        (await AppliedAsync()).Should().Be(0, "the migration is not recorded");
        (await ColumnCountAsync("own_farm_id")).Should().Be(1, "nothing was dropped");
        (await ColumnCountAsync("owner_user_id")).Should().Be(0, "nothing was added or converted");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE own_farm_id IS NOT NULL AND \"Id\" IN (@a, @c)", ("a", onFarmA), ("c", onFarmC)))
            .Should().Be(2, "both rows are exactly as they were");

        // The words work: keep one, remove the other, run the migration again - it succeeds and converts the one that is kept.
        await ExecOnSuperuserAsync("DELETE FROM ssf.schedule_templates WHERE \"Id\" = @id", ("id", onFarmC));
        await MigrateAsync(null);
        (await AppliedAsync()).Should().Be(1);
        (await RowAsync(onFarmA))!.OwnerUser.Should().Be(Owner);
        await AssertHeadShapeAsync();
    }

    [Fact]
    public async Task Down_refuses_while_an_owned_or_tagged_row_exists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedOwnEmptyAsync(Owner, Owner);

        var down = async () => await MigrateAsync(MigrationBefore);

        (await down.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("Down refused: 1 schedule rows");
        (await AppliedAsync()).Should().Be(1, "the migration stays applied");
        await AssertHeadShapeAsync();
        (await RowAsync(own))!.OwnerUser.Should().Be(Owner, "nothing changed");

        // A tag alone refuses it too: a NULL-owner row that says what it was made for.
        await ExecOnSuperuserAsync("DELETE FROM ssf.schedule_templates WHERE \"Id\" = @id", ("id", own));
        var tagged = Guid.NewGuid();
        (await InsertRowAsync(tagged, null, 1, null, climate: "dry")).Should().BeNull();
        (await down.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain("Down refused: 1 schedule rows");
        (await AppliedAsync()).Should().Be(1);
        (await RowAsync(tagged))!.Climate.Should().Be("dry", "nothing changed");

        // The refusal is plain SQL on a table with no row policy: the app role (non-super, non-bypass) raises it too.
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText = ScheduleTemplateOwnerAndMadeFor.DownRefusalSql;
        var asApp = async () => await cmd.ExecuteNonQueryAsync();
        (await asApp.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Contain("Down refused");
    }

    [Fact]
    public async Task Down_succeeds_with_no_owned_row_rebuilds_SOWN_a_shape_and_Up_again_changes_no_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await SeedTemplateRowAsync("Grapes - a public source");
        var copy = Guid.NewGuid();
        (await InsertRowAsync(copy, source, 1, null)).Should().BeNull();
        var rowsBefore = await TemplateRowCountAsync();

        await MigrateAsync(MigrationBefore);

        (await AppliedAsync()).Should().Be(0);
        foreach (var column in NewColumns)
        {
            (await ColumnCountAsync(column)).Should().Be(0, column);
        }

        (await ColumnCountAsync("own_farm_id")).Should().Be(1, "SOWN-a's column is back");
        (await OwnFarmForeignKeyCountAsync()).Should().Be(1, "and its foreign key to ssf.farms, ON DELETE RESTRICT (reused text, never a copy)");
        (await IndexDefAsync("ix_schedule_templates_own_farm_id")).Should().NotBeNull();
        var old = await IndexDefAsync("ix_schedule_templates_derived_version");
        old.Should().Contain("UNIQUE").And.Contain("(derived_from_template_id, version)").And.Contain("own_farm_id IS NULL", "the index is as SOWN-a made it");
        (await IndexDefAsync("ix_schedule_templates_derived_own_farm")).Should().NotBeNull().And.Contain("(derived_from_template_id, own_farm_id)");
        (await IndexDefAsync("ix_schedule_templates_derived_owner")).Should().BeNull();
        (await IndexDefAsync("ix_schedule_templates_owner_user_id")).Should().BeNull();
        (await TemplateRowCountAsync()).Should().Be(rowsBefore, "Down() keeps every row");

        await MigrateAsync(null);

        (await AppliedAsync()).Should().Be(1);
        (await TemplateRowCountAsync()).Should().Be(rowsBefore, "Up() on a database with rows keeps every row");
        (await RowAsync(copy))!.OwnerUser.Should().BeNull("no existing row is anybody's own schedule");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE owner_user_id IS NOT NULL")).Should().Be(0);
        await AssertHeadShapeAsync();
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
