// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146; E3, E4, E8, P6)
//
// ssf.pictures on a REAL Postgres, as the real application role (agrisync_app): row security (a person cannot write another person's row), the
// check constraints, the one-current-row-per-subject index, the migration's own Down() and Up(), and the privacy workers (erasure deletes his
// rows and files and leaves institution rows; the export holds only his picture; a second erasure changes nothing).
//
// WRITTEN BY LANE SCH-ID-S AND NOT RUN BY IT (the lane may touch no database): the orchestrator's gate runs this class on its own cluster.
// RequiresPostgres, fail-loud: every fact builds its own scratch database from the full migration chain and drops it afterwards.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Pictures;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Migrations;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Pictures;

[Trait("Category", "RequiresPostgres")]
public sealed class PicturesRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string MigrationId = "20261117041736_AddPictures";
    private const string MigrationBefore = "20261113120000_AddLogPracticeReasons";
    private const string RoleVacuityGuardSql = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid Anna = Guid.Parse("b0b00000-1111-4111-8111-000000000001");
    private static readonly Guid Ben = Guid.Parse("b0b00000-2222-4222-8222-000000000002");
    private static readonly Guid Staff1 = Guid.Parse("b0b00000-3333-4333-8333-000000000003");
    private static readonly Guid Staff2 = Guid.Parse("b0b00000-4444-4444-8444-000000000004");
    private static readonly Guid AnnaSchedule = Guid.Parse("b0b00000-5555-4555-8555-000000000005");
    private static readonly Guid BenSchedule = Guid.Parse("b0b00000-6666-4666-8666-000000000006");
    private static readonly Guid OutsideSchedule = Guid.Parse("b0b00000-7777-4777-8777-000000000007");
    private static readonly Guid InstitutionSetByAnna = Guid.Parse("b0b00000-8888-4888-8888-000000000008");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_pictures_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch database is harmless.
        }
    }

    // ---- row security, as the real application role -------------------------------------------------------------------------

    [Fact]
    public async Task The_table_is_force_row_secured_with_four_policies_and_the_app_role_is_not_a_superuser()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var flags = await SuperuserScalarAsync<string>(
            "SELECT relrowsecurity::text || ',' || relforcerowsecurity::text FROM pg_class WHERE oid = 'ssf.pictures'::regclass");
        flags.Should().Be("true,true", "ENABLED and FORCED: the table owner is bound too");

        var policies = await SuperuserListAsync("SELECT policyname FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'pictures' ORDER BY 1");
        policies.Should().Equal("p_delete_pictures", "p_insert_pictures", "p_read_pictures", "p_update_pictures");

        (await AppHasPrivilegeAsync("TRUNCATE")).Should().BeFalse("TRUNCATE is not a row operation: no policy would see it");
        (await AppHasPrivilegeAsync("DELETE")).Should().BeTrue("a removed or replaced picture deletes or updates its row");
    }

    [Fact]
    public async Task A_person_writes_his_own_picture_under_his_own_scope()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var written = await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'a'));

        written.Error.Should().BeNull();
        written.Affected.Should().Be(1);
        (await CountAsSuperuserAsync("kind = 'PERSON' AND subject_id = @s", ("s", Anna))).Should().Be(1);
    }

    [Fact]
    public async Task RLS_blocks_writing_another_persons_row_as_the_app_role_not_a_superuser()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Ben's scope, Anna's id as the subject of a PERSON row: refused whoever set_by names (E4: no foreign key carries this check)
        var asAnnaSubject = await AppAsync(Ben, InsertSql(PictureKind.Person, Anna, Ben, 'b'));
        asAnnaSubject.Error.Should().NotBeNull();
        asAnnaSubject.Error!.SqlState.Should().Be("42501", "the WITH CHECK refused the new row");

        // Ben's scope claiming Anna set it: refused
        var claimsAnna = await AppAsync(Ben, InsertSql(PictureKind.Person, Anna, Anna, 'c'));
        claimsAnna.Error!.SqlState.Should().Be("42501");
        var claimsAnnaSchedule = await AppAsync(Ben, InsertSql(PictureKind.Schedule, AnnaSchedule, Anna, 'd'));
        claimsAnnaSchedule.Error!.SqlState.Should().Be("42501");

        // no scope at all (agrisync.user_id unset): refused for every kind
        foreach (var kind in Enum.GetValues<PictureKind>())
        {
            var noScope = await AppAsync(null, InsertSql(kind, Guid.NewGuid(), Anna, 'e'));
            noScope.Error!.SqlState.Should().Be("42501", $"{kind} with no user scope");
        }

        (await CountAsSuperuserAsync("true")).Should().Be(0, "nothing was written");
    }

    [Fact]
    public async Task One_person_cannot_update_or_delete_another_persons_row_and_the_row_is_unchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'a'));
        await AppAsync(Anna, InsertSql(PictureKind.Schedule, AnnaSchedule, Anna, 'b'));
        var before = await SuperuserListAsync("SELECT sha256 FROM ssf.pictures WHERE set_by_user_id = '" + Anna + "' ORDER BY kind");

        foreach (var table in new[] { "kind = 'PERSON' AND subject_id = @s", "kind = 'SCHEDULE' AND subject_id = @t" })
        {
            var update = await AppAsync(Ben, "UPDATE ssf.pictures SET sha256 = repeat('f', 64), set_by_user_id = @ben WHERE " + table, ("s", Anna), ("t", AnnaSchedule), ("ben", Ben));
            update.Error.Should().BeNull();
            update.Affected.Should().Be(0, "his scope sees the row but the USING half of the policy does not admit it");

            var delete = await AppAsync(Ben, "DELETE FROM ssf.pictures WHERE " + table, ("s", Anna), ("t", AnnaSchedule));
            delete.Affected.Should().Be(0);
        }

        // and he cannot hand the row to himself by updating its owner column
        var steal = await AppAsync(Ben, "UPDATE ssf.pictures SET subject_id = @ben WHERE kind = 'PERSON' AND subject_id = @anna", ("ben", Ben), ("anna", Anna));
        steal.Affected.Should().Be(0);

        var after = await SuperuserListAsync("SELECT sha256 FROM ssf.pictures WHERE set_by_user_id = '" + Anna + "' ORDER BY kind");
        after.Should().Equal(before);
        (await CountAsSuperuserAsync("true")).Should().Be(2);
    }

    [Fact]
    public async Task The_setter_updates_and_deletes_his_own_row_but_cannot_turn_it_into_another_persons_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'a'));

        var replace = await AppAsync(Anna, "UPDATE ssf.pictures SET sha256 = repeat('b', 64) WHERE kind = 'PERSON' AND subject_id = @a", ("a", Anna));
        replace.Affected.Should().Be(1);

        var toBen = await AppAsync(Anna, "UPDATE ssf.pictures SET subject_id = @ben WHERE kind = 'PERSON' AND subject_id = @a", ("ben", Ben), ("a", Anna));
        toBen.Error!.SqlState.Should().Be("42501", "a PERSON row's subject must stay the person who sets it");

        var remove = await AppAsync(Anna, "DELETE FROM ssf.pictures WHERE kind = 'PERSON' AND subject_id = @a", ("a", Anna));
        remove.Affected.Should().Be(1);
        (await CountAsSuperuserAsync("true")).Should().Be(0);
    }

    [Fact]
    public async Task Reads_cross_users_by_design_and_the_application_gate_decides_who_sees_which()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'a'));

        var asBen = await AppScalarAsync<long>(Ben, "SELECT count(*) FROM ssf.pictures");
        var asNobody = await AppScalarAsync<long>(null, "SELECT count(*) FROM ssf.pictures");

        asBen.Should().Be(1, "another person's scope reads the row: PictureViewer (not the database) decides whether he is told of it");
        asNobody.Should().Be(1, "RECORDED LIMIT: the read policy is open to every scope; no door serves a row without asking PictureViewer");
    }

    [Fact]
    public async Task An_institution_logo_can_be_replaced_by_other_staff_the_one_place_the_database_defends_less()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AppAsync(Staff1, InsertSql(PictureKind.Institution, OutsideSchedule, Staff1, 'a'));

        var replace = await AppAsync(Staff2, "UPDATE ssf.pictures SET sha256 = repeat('b', 64), set_by_user_id = @s2 WHERE kind = 'INSTITUTION' AND subject_id = @o", ("s2", Staff2), ("o", OutsideSchedule));
        replace.Affected.Should().Be(1);

        var noScope = await AppAsync(null, "DELETE FROM ssf.pictures WHERE kind = 'INSTITUTION'");
        noScope.Affected.Should().Be(0, "no user scope, no write");
    }

    [Fact]
    public async Task The_check_constraints_and_the_one_row_per_subject_index_hold()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'a'))).Error.Should().BeNull();
        var twice = await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'b'));
        twice.Error!.SqlState.Should().Be("23505", "one current picture per (kind, subject)");

        var badKind = await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'c').Replace("'PERSON'", "'TEAM'"));
        badKind.Error!.SqlState.Should().Be("23514");

        var tooBig = await AppAsync(Anna, InsertSql(PictureKind.Schedule, AnnaSchedule, Anna, 'd').Replace("1000", "524289"));
        tooBig.Error!.SqlState.Should().Be("23514", "the hard cap is also in the table");
    }

    // ---- the migration's own Down() and Up() -----------------------------------------------------------------------------------

    [Fact]
    public async Task Down_refuses_while_a_picture_exists_and_then_down_and_up_again_work_with_the_table_empty()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'a'));

        // Down() runs DownRefusalSql first: with a row it raises and the table stays
        var refusal = await Assert.ThrowsAnyAsync<Exception>(() => MigrateShramSafalToAsync(MigrationBefore));
        FindPostgres(refusal)!.MessageText.Should().Contain("Down refused").And.Contain("1 picture row");
        (await SuperuserScalarAsync<bool>("SELECT to_regclass('ssf.pictures') IS NOT NULL")).Should().BeTrue("a refused Down changes nothing");
        (await CountAsSuperuserAsync("true")).Should().Be(1);

        await AppAsync(Anna, "DELETE FROM ssf.pictures WHERE kind = 'PERSON' AND subject_id = @a", ("a", Anna));
        await MigrateShramSafalToAsync(MigrationBefore);
        (await SuperuserScalarAsync<bool>("SELECT to_regclass('ssf.pictures') IS NULL")).Should().BeTrue("Down dropped the table");
        (await SuperuserListAsync("SELECT policyname FROM pg_policies WHERE tablename = 'pictures'")).Should().BeEmpty();

        await MigrateShramSafalToAsync(MigrationId);
        (await SuperuserScalarAsync<string>("SELECT relrowsecurity::text || ',' || relforcerowsecurity::text FROM pg_class WHERE oid = 'ssf.pictures'::regclass"))
            .Should().Be("true,true");
        (await SuperuserListAsync("SELECT policyname FROM pg_policies WHERE tablename = 'pictures' ORDER BY 1")).Should().HaveCount(4);
        (await AppAsync(Anna, InsertSql(PictureKind.Person, Anna, Anna, 'z'))).Error.Should().BeNull("the app role can write again after Up()");
    }

    // ---- erasure ----------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Erasure_deletes_his_rows_and_files_leaves_institution_rows_and_other_peoples_and_a_second_run_changes_nothing()
    {
        var storage = new FakeStorage();
        await SeedEverythingAsync(storage);
        var before = await SuperuserListAsync("SELECT kind || ':' || subject_id FROM ssf.pictures ORDER BY 1");
        before.Should().HaveCount(6);

        await using (var db = SuperuserContext())
        {
            var first = await ErasureWorker.DeletePicturesOfUserAsync(db, storage, Anna, NullLogger.Instance, CancellationToken.None);
            first.Rows.Should().Be(2, "his PERSON row and the SCHEDULE row he set");
            first.FilesLeft.Should().Be(0);
        }

        var after = await SuperuserListAsync("SELECT kind || ':' || subject_id FROM ssf.pictures ORDER BY 1");
        after.Should().BeEquivalentTo(
            new[]
            {
                "PERSON:" + Ben,
                "SCHEDULE:" + BenSchedule,
                "INSTITUTION:" + OutsideSchedule,
                "INSTITUTION:" + InstitutionSetByAnna,
            },
            "exactly his two rows are gone; the other person's rows and both institution rows remain");
        (await CountAsSuperuserAsync("(kind = 'PERSON' AND subject_id = @a) OR (kind = 'SCHEDULE' AND set_by_user_id = @a)", ("a", Anna))).Should().Be(0);
        (await CountAsSuperuserAsync("kind = 'INSTITUTION'")).Should().Be(2, "institution rows stay, including the one set by the erased person (not a person's data)");
        (await CountAsSuperuserAsync("kind = 'PERSON' AND subject_id = @b", ("b", Ben))).Should().Be(1);
        (await CountAsSuperuserAsync("kind = 'SCHEDULE' AND subject_id = @b", ("b", BenSchedule))).Should().Be(1);

        storage.Deleted.Should().HaveCount(2);
        storage.Files.Keys.Should().NotContain(k => k.Contains(Anna.ToString("N")), "his person file is gone");
        storage.Files.Should().HaveCount(4, "the other four files are untouched");

        // a second run changes nothing
        var snapshot = await SuperuserListAsync("SELECT id::text || sha256 FROM ssf.pictures ORDER BY 1");
        var deletedBefore = storage.Deleted.Count;
        await using (var db = SuperuserContext())
        {
            var second = await ErasureWorker.DeletePicturesOfUserAsync(db, storage, Anna, NullLogger.Instance, CancellationToken.None);
            second.Should().Be((0, 0));
        }

        (await SuperuserListAsync("SELECT id::text || sha256 FROM ssf.pictures ORDER BY 1")).Should().Equal(snapshot);
        storage.Deleted.Count.Should().Be(deletedBefore);
    }

    [Fact]
    public async Task Erasure_counts_a_file_the_storage_refused_to_delete_and_still_removes_the_rows()
    {
        var storage = new FakeStorage { Fail = true };
        await SeedEverythingAsync(storage);

        await using var db = SuperuserContext();
        var result = await ErasureWorker.DeletePicturesOfUserAsync(db, storage, Anna, NullLogger.Instance, CancellationToken.None);

        result.Rows.Should().Be(2);
        result.FilesLeft.Should().Be(2, "reported, never hidden: a file is a face");
        (await CountAsSuperuserAsync("(kind = 'PERSON' AND subject_id = @a) OR (kind = 'SCHEDULE' AND set_by_user_id = @a)", ("a", Anna))).Should().Be(0);
    }

    [Fact]
    public async Task Erasure_with_no_picture_deletes_nothing_and_touches_no_storage()
    {
        var storage = new FakeStorage();
        await using var db = SuperuserContext();

        var result = await ErasureWorker.DeletePicturesOfUserAsync(db, storage, Anna, NullLogger.Instance, CancellationToken.None);

        result.Should().Be((0, 0));
        storage.Deleted.Should().BeEmpty();
    }

    // ---- export -----------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_export_holds_only_his_pictures_with_a_line_of_metadata_each_never_anyone_elses_or_a_logo()
    {
        var storage = new FakeStorage();
        await SeedEverythingAsync(storage);
        var annaSha = new string('a', 64);
        var benSha = new string('b', 64);

        using var buffer = new MemoryStream();
        await using (var db = SuperuserContext())
        {
            using var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true);
            await ExportWorker.WritePicturesAsync(zip, db, storage, Anna, CancellationToken.None);
        }

        buffer.Position = 0;
        using var read = new ZipArchive(buffer, ZipArchiveMode.Read);
        var names = read.Entries.Select(e => e.FullName).ToList();
        names.Should().Contain("pictures/metadata.json");
        names.Where(n => n != "pictures/metadata.json").Should().HaveCount(2, "his own picture and the schedule picture he set");

        using var metadata = JsonDocument.Parse(new StreamReader(read.GetEntry("pictures/metadata.json")!.Open()).ReadToEnd());
        var lines = metadata.RootElement.EnumerateArray().ToList();
        lines.Should().HaveCount(2);
        lines.Select(l => l.GetProperty("kind").GetString()).Should().BeEquivalentTo("PERSON", "SCHEDULE");
        lines.Should().OnlyContain(l => l.GetProperty("fileIncluded").GetBoolean());
        lines.Select(l => l.GetProperty("sha256").GetString()).Should().OnlyContain(s => s != benSha);
        lines.Select(l => l.GetProperty("sha256").GetString()).Should().Contain(annaSha);

        // nothing of anyone else, in the metadata or in any file: read every entry back
        foreach (var entry in read.Entries)
        {
            using var reader = new StreamReader(entry.Open());
            var text = reader.ReadToEnd();
            text.Should().NotContain(Ben.ToString(), entry.FullName).And.NotContain(benSha, entry.FullName);
        }
    }

    [Fact]
    public async Task The_export_of_a_person_with_no_picture_has_an_empty_metadata_file()
    {
        var storage = new FakeStorage();
        using var buffer = new MemoryStream();
        await using (var db = SuperuserContext())
        {
            using var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true);
            await ExportWorker.WritePicturesAsync(zip, db, storage, Anna, CancellationToken.None);
        }

        buffer.Position = 0;
        using var read = new ZipArchive(buffer, ZipArchiveMode.Read);
        read.Entries.Select(e => e.FullName).Should().Equal("pictures/metadata.json");
        new StreamReader(read.GetEntry("pictures/metadata.json")!.Open()).ReadToEnd().Replace(" ", string.Empty).Replace("\n", string.Empty).Replace("\r", string.Empty)
            .Should().Be("[]");
    }

    // ---- harness ------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// Anna: her PERSON row, a SCHEDULE row she set, and an INSTITUTION row she (as a staff member) set. Ben: his PERSON row and his SCHEDULE row.
    /// One more INSTITUTION row set by staff. Six rows, one file each (the key is the row's storage key).
    /// </summary>
    private async Task SeedEverythingAsync(FakeStorage storage)
    {
        var rows = new (PictureKind Kind, Guid Subject, Guid SetBy, char Fill)[]
        {
            (PictureKind.Person, Anna, Anna, 'a'),
            (PictureKind.Schedule, AnnaSchedule, Anna, 'a'),
            (PictureKind.Institution, InstitutionSetByAnna, Anna, 'c'),
            (PictureKind.Person, Ben, Ben, 'b'),
            (PictureKind.Schedule, BenSchedule, Ben, 'b'),
            (PictureKind.Institution, OutsideSchedule, Staff1, 'd'),
        };
        foreach (var (kind, subject, setBy, fill) in rows)
        {
            var sha = new string(fill, 64);
            var key = PictureRules.StorageKeyFor(kind, subject, sha);
            storage.Files[key] = Encoding.ASCII.GetBytes("jpeg-" + sha);
            await ExecuteAsSuperuserAsync(
                "INSERT INTO ssf.pictures (\"Id\", kind, subject_id, storage_key, content_type, bytes, sha256, set_by_user_id, set_at_utc) "
                + "VALUES (@id, @kind, @subject, @key, 'image/jpeg', 1000, @sha, @by, NOW())",
                ("id", Guid.NewGuid()), ("kind", PictureKinds.ToWire(kind)), ("subject", subject), ("key", key), ("sha", sha), ("by", setBy));
        }
    }

    private static string InsertSql(PictureKind kind, Guid subject, Guid setBy, char fill) =>
        "INSERT INTO ssf.pictures (\"Id\", kind, subject_id, storage_key, content_type, bytes, sha256, set_by_user_id, set_at_utc) VALUES ('"
        + Guid.NewGuid() + "', '" + PictureKinds.ToWire(kind) + "', '" + subject + "', 'pictures/x/" + fill + ".webp', 'image/jpeg', 1000, '"
        + new string(fill, 64) + "', '" + setBy + "', NOW())";

    private ShramSafalDbContext SuperuserContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);

    private async Task MigrateShramSafalToAsync(string target)
    {
        await using var ctx = SuperuserContext();
        await ctx.Database.GetService<IMigrator>().MigrateAsync(target);
    }

    private static PostgresException? FindPostgres(Exception? ex)
    {
        while (ex is not null)
        {
            if (ex is PostgresException pg)
            {
                return pg;
            }

            ex = ex.InnerException;
        }

        return null;
    }

    /// <summary>Runs one statement as agrisync_app inside a transaction with the given user scope (null = none), then ROLLS BACK the transaction unless it committed a change the next fact reads: here every write is committed so later facts see it.</summary>
    private async Task<(int Affected, PostgresException? Error)> AppAsync(Guid? scope, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        try
        {
            if (scope is { } user)
            {
                await using var guc = db.CreateCommand();
                guc.Transaction = tx;
                guc.CommandText = "SELECT set_config('agrisync.user_id', @u, true)";
                guc.Parameters.AddWithValue("u", user.ToString());
                await guc.ExecuteNonQueryAsync();
            }

            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            foreach (var (name, value) in args)
            {
                cmd.Parameters.AddWithValue(name, value);
            }

            var affected = await cmd.ExecuteNonQueryAsync();
            await tx.CommitAsync();
            return (affected, null);
        }
        catch (PostgresException ex)
        {
            await tx.RollbackAsync();
            return (0, ex);
        }
    }

    private Task<(int Affected, PostgresException? Error)> AppAsync(Guid scope, string sql, params (string Name, object Value)[] args) =>
        AppAsync((Guid?)scope, sql, args);

    private async Task<T> AppScalarAsync<T>(Guid? scope, string sql)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        if (scope is { } user)
        {
            await using var guc = db.CreateCommand();
            guc.Transaction = tx;
            guc.CommandText = "SELECT set_config('agrisync.user_id', @u, true)";
            guc.Parameters.AddWithValue("u", user.ToString());
            await guc.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        var value = (T)Convert.ChangeType((await cmd.ExecuteScalarAsync())!, typeof(T));
        await tx.RollbackAsync();
        return value;
    }

    private async Task<bool> AppHasPrivilegeAsync(string privilege)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT has_table_privilege(current_user, 'ssf.pictures', '{privilege}')";
        return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT current_user";
        var role = Convert.ToString(await cmd.ExecuteScalarAsync());
        cmd.CommandText = RoleVacuityGuardSql;
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());

        role.Should().Be(AppRoleUser, "the proofs must run as the role the API actually connects as");
        superOrBypass.Should().BeFalse("doctrine E3 - an RLS proof taken as a superuser or BYPASSRLS role passes for the wrong reason");
        output.WriteLine($"[EVIDENCE] role guard: current_user='{role}' rolsuper OR rolbypassrls={superOrBypass} (required False)");
    }

    private async Task ExecuteAsSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<T> SuperuserScalarAsync<T>(string sql)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return (T)Convert.ChangeType((await cmd.ExecuteScalarAsync())!, typeof(T));
    }

    private async Task<List<string>> SuperuserListAsync(string sql)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(reader.GetString(0));
        }

        return list;
    }

    private async Task<long> CountAsSuperuserAsync(string where, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.pictures WHERE " + where;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>An in-memory picture storage: keys to bytes, a delete log, and a switch that makes every delete fail.</summary>
    private sealed class FakeStorage : IAttachmentStorageService
    {
        public Dictionary<string, byte[]> Files { get; } = [];
        public List<string> Deleted { get; } = [];
        public bool Fail { get; set; }

        public Task<long> SaveAsync(string relativePath, Stream content, string? contentType = null, CancellationToken ct = default)
        {
            using var copy = new MemoryStream();
            content.CopyTo(copy);
            Files[relativePath] = copy.ToArray();
            return Task.FromResult((long)copy.Length);
        }

        public Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default) =>
            Task.FromResult<Stream?>(Files.TryGetValue(relativePath, out var bytes) ? new MemoryStream(bytes) : null);

        public Task DeleteAsync(string relativePath, CancellationToken ct = default)
        {
            if (Fail)
            {
                throw new IOException("storage refused the delete");
            }

            Deleted.Add(relativePath);
            Files.Remove(relativePath);
            return Task.CompletedTask;
        }
    }
}
