// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-A Task 1 ("store the days").
//
// The library used to INVENT a row's stage days (an equal split), its repeat and its category (from the activity's NAME), and
// kept no stages at all. A row that STORES its days is now listed exactly as stored (R3: nothing a schedule invented ever carries
// ShramSafal's name); every other row is listed as before and reads NotChecked (P11). The migration's Down() refuses while a
// check exists (E8). Real Postgres as agrisync_app (E3 first), through the real host.
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
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleStoredDaysRealPostgresTests(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    private const string ThisMigration = "20261108120000_AddScheduleCheckAndStoredDays";
    private const string MigrationBefore = "20261108090000_AddInputIdentityAssertions";

    [Fact]
    public async Task Library_lists_a_rows_own_stage_days_not_an_equal_split()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var row = await SeedStoredRowAsync();

        var listed = RowOf(await LibraryAsync(Owner), row.Id);

        listed.Should().NotBeNull("a Public row is in every farmer's library");
        var dto = listed!.Value;
        var stages = dto.GetProperty("stages").EnumerateArray()
            .Select(s => (s.GetProperty("name").GetString()!, s.GetProperty("startDay").GetInt32(), s.GetProperty("endDay").GetInt32()))
            .ToList();
        // The stages are the stored ones (unequal on purpose), never an equal split of 60 days.
        stages.Should().Equal(new[] { ("Post Pruning", 0, 12), ("Canopy Build", 13, 40), ("Berry Development", 41, 99) });
        dto.GetProperty("totalDays").GetInt32().Should().Be(100);
        dto.GetProperty("hasStoredDays").GetBoolean().Should().BeTrue();
        dto.GetProperty("cropType").GetString().Should().Be("Grapes", "a stored row lists the same crop-type name the thin rows use (S006)");
        dto.GetProperty("ownerType").GetString().Should().Be("INSTITUTION");
        dto.GetProperty("sourceLabel").GetString().Should().Be("Test University recommendation");
        dto.GetProperty("rowVersionTag").GetString().Should().Be("v1");

        var spray = dto.GetProperty("activities").EnumerateArray().Single(a => a.GetProperty("name").GetString() == "बुरशीनाशक फवारणी");
        spray.GetProperty("startDay").GetInt32().Should().Be(18);
        spray.GetProperty("endDay").GetInt32().Should().Be(40, "the stored end day, not the start day");
        spray.GetProperty("stageName").GetString().Should().Be("Canopy Build", "the stage that holds its first day");
    }

    [Fact]
    public async Task Library_lists_a_rows_own_repeat_not_one_guessed_from_its_name()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // By NAME, "Pruning" reads one_time and a "Foliar Spray" every 14 days. Stored is the opposite.
        var row = await SeedStoredRowAsync("Grapes - repeat test", activities:
        [
            new ImportedActivity("a", "Pruning", 0, 12, FrequencyMode.EveryNDays, 9),
            new ImportedActivity("b", "Foliar Spray", 13, 14, FrequencyMode.OneTime, 1),
            new ImportedActivity("c", "Irrigation", 41, 99, FrequencyMode.PerWeek, 3),
        ]);

        var dto = RowOf(await LibraryAsync(Owner), row.Id)!.Value;
        var byName = dto.GetProperty("activities").EnumerateArray().ToDictionary(a => a.GetProperty("name").GetString()!);

        byName["Pruning"].GetProperty("frequencyMode").GetString().Should().Be("every_n_days");
        byName["Pruning"].GetProperty("intervalDays").GetInt32().Should().Be(9);
        byName["Pruning"].GetProperty("storedFrequencyMode").GetString().Should().Be("EveryNDays");
        byName["Foliar Spray"].GetProperty("frequencyMode").GetString().Should().Be("one_time");
        byName["Foliar Spray"].GetProperty("intervalDays").ValueKind.Should().Be(JsonValueKind.Null);
        byName["Irrigation"].GetProperty("frequencyMode").GetString().Should().Be("per_week");
        byName["Irrigation"].GetProperty("intervalDays").GetInt32().Should().Be(3);
        byName["Irrigation"].GetProperty("id").GetGuid().Should().NotBeEmpty("a stored row's activities carry their ids");
    }

    [Fact]
    public async Task Old_row_without_days_is_listed_as_today_and_NotChecked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var thin = await SeedTemplateRowAsync("Grapes - old thin row", author: PlatformOwner);

        var dto = RowOf(await LibraryAsync(Owner), thin)!.Value;

        // As before the lane: the stage is the row's one stage, the days are the activity's offset, the repeat is the name's guess.
        dto.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("name").GetString())
            .Should().Equal("Pruning");
        dto.GetProperty("cropType").GetString().Should().Be("Grapes");
        var drip = dto.GetProperty("activities").EnumerateArray().Single(a => a.GetProperty("name").GetString() == "Drip Irrigation");
        drip.GetProperty("frequencyMode").GetString().Should().Be("every_n_days");
        drip.GetProperty("intervalDays").GetInt32().Should().Be(3, "the old name-based guess for irrigation, kept for rows that store nothing (P11)");
        drip.GetProperty("endDay").GetInt32().Should().Be(drip.GetProperty("startDay").GetInt32());

        // Never checkable: it reads NotChecked, says it stores no days, and its new activity fields are null.
        dto.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
        dto.GetProperty("hasStoredDays").GetBoolean().Should().BeFalse();
        drip.GetProperty("id").ValueKind.Should().Be(JsonValueKind.Null);
        drip.GetProperty("storedFrequencyMode").ValueKind.Should().Be(JsonValueKind.Null, "a thin row never claims a stored repeat");
        drip.GetProperty("role").ValueKind.Should().Be(JsonValueKind.Null);

        // ... and the server refuses to check it, whoever asks (R3).
        await SeedReviewSeatsAsync();
        var refused = await CheckAsync(PlatformOwner, thin, "Approved", ticked: []);
        refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Body);
        ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleCheckDaysNotStored");
        (await ChecksAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task Release_1_0_17_parses_the_library_with_the_new_fields()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var thin = await SeedTemplateRowAsync("Grapes - old thin row", author: PlatformOwner);
        var stored = await SeedStoredRowAsync();
        (await CheckAsync(PlatformOwner, stored.Id, "Approved", ActivityIdsOf(stored))).Status.Should().Be(HttpStatusCode.OK);

        var (status, body) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/reference/schedule-templates", Owner, null);
        status.Should().Be(HttpStatusCode.OK, body);
        KeepP11Body("library-with-new-fields", body);

        // Every field release 1.0.17 reads is still there, with the same name and type; everything else is ADDED at the end and
        // optional, so a reader that ignores unknown names (1.0.17 parses the JSON with no schema) reads the same library.
        string[] oldTemplate = ["id", "name", "cropType", "totalDays", "stages", "activities", "versionHash"];
        string[] oldActivity = ["name", "category", "stageName", "startDay", "endDay", "frequencyMode", "intervalDays"];
        string[] newTemplate = ["ownerType", "sourceLabel", "check", "rowVersionTag", "hasStoredDays"];
        string[] newActivity = ["operationKey", "id", "part", "role", "nutrientKey", "afterActivityId", "storedFrequencyMode"];

        var library = JsonDocument.Parse(body).RootElement;
        library.GetArrayLength().Should().Be(2);
        foreach (var template in library.EnumerateArray())
        {
            var names = template.EnumerateObject().Select(p => p.Name).ToList();
            names.Take(oldTemplate.Length).Should().Equal(oldTemplate, "the old fields keep their names and order");
            names.Skip(oldTemplate.Length).Should().Equal(newTemplate, "the new fields are appended at the END");
            template.GetProperty("versionHash").GetString().Should().NotBeNullOrEmpty();
            template.GetProperty("totalDays").ValueKind.Should().Be(JsonValueKind.Number);
            foreach (var activity in template.GetProperty("activities").EnumerateArray())
            {
                var activityNames = activity.EnumerateObject().Select(p => p.Name).ToList();
                activityNames.Take(oldActivity.Length).Should().Equal(oldActivity);
                activityNames.Skip(oldActivity.Length).Should().Equal(newActivity);
                activity.GetProperty("startDay").ValueKind.Should().Be(JsonValueKind.Number);
                activity.GetProperty("frequencyMode").ValueKind.Should().Be(JsonValueKind.String);
            }
        }

        // The checked row says so (state, who, when), the thin row says NotChecked.
        RowOf(library.EnumerateArray().ToList(), stored.Id)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        RowOf(library.EnumerateArray().ToList(), thin)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
    }

    [Fact]
    public async Task The_library_hash_of_a_library_without_a_decision_is_unchanged_by_the_new_fields()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await SeedTemplateRowAsync("Grapes - A thin row");
        var before = RowOf(await LibraryAsync(Owner), first)!.Value.GetProperty("versionHash").GetString();

        // A stored row changes the list (it IS a new row); the same thin row, listed again, hashes the same.
        var again = RowOf(await LibraryAsync(Owner), first)!.Value.GetProperty("versionHash").GetString();
        again.Should().Be(before);

        await SeedReviewSeatsAsync();
        var stored = await SeedStoredRowAsync();
        var undecided = RowOf(await LibraryAsync(Owner), stored.Id)!.Value.GetProperty("versionHash").GetString();
        (await CheckAsync(PlatformOwner, stored.Id, "Approved", ActivityIdsOf(stored))).Status.Should().Be(HttpStatusCode.OK);
        var decided = RowOf(await LibraryAsync(Owner), stored.Id)!.Value.GetProperty("versionHash").GetString();

        decided.Should().NotBe(undecided, "a check changes what the library says, so a phone that compares the list hash re-reads it");
    }

    [Fact]
    public async Task Down_refuses_while_a_check_exists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var stored = await SeedStoredRowAsync();
        (await CheckAsync(PlatformOwner, stored.Id, "Approved", ActivityIdsOf(stored))).Status.Should().Be(HttpStatusCode.OK);
        (await ChecksAsync(stored.Id)).Should().HaveCount(1);

        var refused = async () => await MigrateAsync(MigrationBefore);

        var failure = await refused.Should().ThrowAsync<Exception>();
        Flatten(failure.Which).Should().Contain("Down refused", "E8: a rollback must not silently erase ShramSafal's checks");

        // Nothing was rolled back: the check, the stored days and the new tables are all still there.
        (await ChecksAsync(stored.Id)).Should().HaveCount(1);
        (await CountAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name IN ('schedule_checks', 'schedule_template_stages')"))
            .Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t AND part IS NOT NULL", ("t", stored.Id)))
            .Should().Be(stored.Activities.Count);
    }

    [Fact]
    public async Task Down_then_Up_without_checks_keeps_every_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var thin = await SeedTemplateRowAsync("Grapes - thin kept");
        var stored = await SeedStoredRowAsync("Grapes - stored kept");
        var rowsBefore = await CountAsync("SELECT count(*) FROM ssf.schedule_templates");
        var activitiesBefore = await CountAsync("SELECT count(*) FROM ssf.template_activities");
        rowsBefore.Should().BeGreaterThanOrEqualTo(2);

        await MigrateAsync(MigrationBefore);

        // Down drops what Up added - and only that.
        (await CountAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name IN ('schedule_checks', 'schedule_template_stages')"))
            .Should().Be(0);
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'template_activities' AND column_name IN ('end_day', 'frequency_mode', 'interval_days', 'part', 'operation_key', 'after_activity_id', 'role', 'nutrient_key')"))
            .Should().Be(0);
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_templates' AND column_name IN ('owner_type', 'source_label', 'crop_key')"))
            .Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(rowsBefore, "every schedule survives the rollback");
        (await CountAsync("SELECT count(*) FROM ssf.template_activities")).Should().Be(activitiesBefore, "every activity survives the rollback");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" IN (@a, @b)", ("a", thin), ("b", stored.Id))).Should().Be(2);

        await MigrateAsync(null);

        (await CountAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ssf' AND table_name IN ('schedule_checks', 'schedule_template_stages')"))
            .Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(rowsBefore);
        (await CountAsync("SELECT count(*) FROM ssf.template_activities")).Should().Be(activitiesBefore);
        // The rows come back as rows whose days are not stored (the lost columns), never as invented days.
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE part IS NOT NULL OR end_day IS NOT NULL")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_template_stages")).Should().Be(0);

        // Re-Up re-asserts the append-only grant.
        (await CountAsync("SELECT count(*) FROM ssf.schedule_checks")).Should().Be(0);
        (await ScalarBoolAsync("SELECT has_table_privilege('agrisync_app', 'ssf.schedule_checks', 'UPDATE') OR has_table_privilege('agrisync_app', 'ssf.schedule_checks', 'DELETE') OR has_table_privilege('agrisync_app', 'ssf.schedule_checks', 'TRUNCATE')"))
            .Should().BeFalse();
        (await ScalarBoolAsync("SELECT has_table_privilege('agrisync_app', 'ssf.schedule_checks', 'SELECT') AND has_table_privilege('agrisync_app', 'ssf.schedule_checks', 'INSERT')"))
            .Should().BeTrue();
    }

    [Fact]
    public async Task Migration_runs_twice_on_fresh_databases()
    {
        // "Booted twice" (Global Constraints, Data-prod): the full set on this scratch database (the fixture's first boot),
        // then Down and Up again here and, from nothing, a SECOND fresh database through the same chain.
        await AssertAppRoleIsNotVacuousAsync();
        (await HistoryHasAsync(ThisMigration)).Should().BeTrue("the fixture booted the full migration set on a fresh database");
        await MigrateAsync(MigrationBefore);
        (await HistoryHasAsync(ThisMigration)).Should().BeFalse();
        await MigrateAsync(null);
        (await HistoryHasAsync(ThisMigration)).Should().BeTrue();

        var second = $"ssf_scha_{Guid.NewGuid():N}";
        var root = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        await using (var admin = new NpgsqlConnection(root))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{second}\"");
        }

        try
        {
            var conn = new NpgsqlConnectionStringBuilder(root) { Database = second }.ConnectionString;
            await IntegrationMigrationChain.ApplyAsync(conn);
            await using var db = new NpgsqlConnection(conn);
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = '{ThisMigration}'";
            Convert.ToInt64(await cmd.ExecuteScalarAsync()).Should().Be(1);
        }
        finally
        {
            await using var admin = new NpgsqlConnection(root);
            await admin.OpenAsync();
            await ExecAsync(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", ("db", second));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{second}\"");
        }
    }

    // ── helpers ──

    private async Task MigrateAsync(string? target)
    {
        // The fixture's chain (IntegrationMigrationChain) records history in the DEFAULT table, so the same options are used here.
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

    private async Task<bool> HistoryHasAsync(string migrationId) =>
        await CountAsync("SELECT count(*) FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @id", ("id", migrationId)) == 1;

    private async Task<bool> ScalarBoolAsync(string sql)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    private static string Flatten(Exception ex)
    {
        var text = string.Empty;
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            text += e.Message + " | ";
            if (e.InnerException is null)
            {
                break;
            }
        }

        return text;
    }
}
