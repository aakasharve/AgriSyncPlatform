// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2) - the government village list (LGD) on a REAL Postgres.
//
// The migration AddLgdPlaceList loads the embedded list (44,930 villages, 358 talukas, 35 districts) with its provenance; the boot check loads a
// version only once, says so, and THROWS when the tables do not hold the file's counts; the app role reads the list and cannot change it; the
// server's reader answers by code from the current version only; Down() and Up() again work (E8). Run on the gate cluster only
// (REQUIRES_POSTGRES_ROOT_CONN), as agrisync_app wherever the app's own access is the subject (E3 asserted first).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Sync.IntegrationTests.Labour;
using ShramSafal.Sync.IntegrationTests.TrialSafety;
using User.Application.Ports;
using User.Infrastructure;
using User.Infrastructure.Persistence;
using User.Infrastructure.Places;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Identity;

[Trait("Category", "RequiresPostgres")]
public sealed class LgdPlaceListRealPostgresTests(TrialSafetyDatabase db) : IClassFixture<TrialSafetyDatabase>
{
    private const string Version = "lgd-mh-2026-11-26";

    [Fact]
    public async Task The_migration_loaded_the_list_once_with_its_counts_and_its_provenance()
    {
        (await CountAsync($"SELECT count(*) FROM public.lgd_villages WHERE list_version = '{Version}'")).Should().Be(44930);
        (await CountAsync($"SELECT count(*) FROM public.lgd_talukas WHERE list_version = '{Version}'")).Should().Be(358);
        (await CountAsync($"SELECT count(*) FROM public.lgd_districts WHERE list_version = '{Version}'")).Should().Be(35);

        var record = await RowsAsync(
            $"SELECT village_count, taluka_count, district_count, source, provenance FROM public.lgd_list_versions WHERE version = '{Version}'");
        record.Should().ContainSingle();
        record[0].Should().Equal(44930, 358, 35, "LGD mirror 2026-11-26 (villages + pincode_villages parquet)", "Secondary source; not independently verified");

        var pandharpur = await RowsAsync(
            "SELECT v.name_mr, v.name_en, v.pin, v.status, t.code, t.name_en, t.name_mr, d.code, d.name_en, d.name_mr FROM public.lgd_villages v "
            + "JOIN public.lgd_talukas t ON t.code = v.taluka_code JOIN public.lgd_districts d ON d.code = t.district_code WHERE v.code = 944182");
        pandharpur.Single().Should().Equal("पंढरपूर", "Pandharpur", "413304", (short)1, 4249, "Pandharpur", null, 496, "Solapur", "सोलापूर");
        (await CountAsync("SELECT count(*) FROM public.lgd_talukas WHERE name_mr IS NOT NULL")).Should().Be(0, "founder question 8 is open: no taluka name is invented");
        (await CountAsync("SELECT count(*) FROM public.lgd_villages WHERE name_mr IS NULL")).Should().Be(42);
        (await CountAsync("SELECT count(*) FROM public.lgd_villages WHERE pin IS NULL")).Should().Be(125);
    }

    [Fact]
    public async Task A_second_boot_writes_nothing_and_says_the_list_is_loaded()
    {
        var before = await RowsAsync($"SELECT loaded_at_utc FROM public.lgd_list_versions WHERE version = '{Version}'");

        string first, second;
        await using (var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn)))
        {
            first = await LgdPlaceListLoader.EnsureLoadedAsync(context, CancellationToken.None);
            second = await LgdPlaceListLoader.EnsureLoadedAsync(context, CancellationToken.None);
        }

        first.Should().Be(
            "Place list lgd-mh-2026-11-26 is loaded: 44930 villages, 358 talukas, 35 districts (Secondary source; not independently verified). Nothing was written.");
        second.Should().Be(first);
        (await RowsAsync($"SELECT loaded_at_utc FROM public.lgd_list_versions WHERE version = '{Version}'")).Single()
            .Should().Equal(before.Single(), "the version row is never rewritten");
        (await CountAsync($"SELECT count(*) FROM public.lgd_villages WHERE list_version = '{Version}'")).Should().Be(44930);
    }

    [Fact]
    public async Task A_version_not_yet_recorded_is_loaded_once_and_then_left_alone()
    {
        var list = TestList("ident-test-a", 999000001, 999000002);

        await using var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn));
        var loaded = await LgdPlaceListLoader.EnsureLoadedAsync(context, list, CancellationToken.None);
        var again = await LgdPlaceListLoader.EnsureLoadedAsync(context, list, CancellationToken.None);

        loaded.Should().Be("Place list ident-test-a loaded now: 2 villages, 1 talukas, 1 districts (Secondary source; not independently verified).");
        again.Should().Be("Place list ident-test-a is loaded: 2 villages, 1 talukas, 1 districts (Secondary source; not independently verified). Nothing was written.");
        (await CountAsync("SELECT count(*) FROM public.lgd_villages WHERE list_version = 'ident-test-a'")).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM public.lgd_list_versions WHERE version = 'ident-test-a'")).Should().Be(1);
        (await CountAsync($"SELECT count(*) FROM public.lgd_villages WHERE list_version = '{Version}'")).Should().Be(44930, "another version's rows are untouched");
    }

    [Fact]
    public async Task A_recorded_version_whose_tables_hold_other_counts_stops_the_boot_with_the_numbers()
    {
        var list = TestList("ident-test-b", 999000011, 999000012);
        await using var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn));
        await LgdPlaceListLoader.EnsureLoadedAsync(context, list, CancellationToken.None);
        await ExecAsync("DELETE FROM public.lgd_villages WHERE code = 999000012");

        var act = () => LgdPlaceListLoader.EnsureLoadedAsync(context, list, CancellationToken.None);

        (await act.Should().ThrowAsync<InvalidOperationException>()).WithMessage(
            "Place list ident-test-b: the database holds 1 villages, 1 talukas and 1 districts (recorded: 2,1,1); the list holds 2, 1 and 1. "
            + "Refusing to start on a list that does not match.");
    }

    [Fact]
    public async Task The_load_itself_raises_and_writes_nothing_when_the_tables_end_with_other_counts()
    {
        // A stray village row already tagged with the version: after the load the tables hold 3, the file says 2.
        var list = TestList("ident-test-c", 999000021, 999000022);
        await ExecAsync("""
            INSERT INTO public.lgd_districts (code, name_en, name_mr, list_version) VALUES (99021, 'Stray district', NULL, 'ident-test-stray') ON CONFLICT DO NOTHING;
            INSERT INTO public.lgd_talukas (code, district_code, name_en, name_mr, list_version) VALUES (99022, 99021, 'Stray taluka', NULL, 'ident-test-stray') ON CONFLICT DO NOTHING;
            INSERT INTO public.lgd_villages (code, taluka_code, name_en, name_mr, pin, status, list_version) VALUES (999000029, 99022, 'Stray', NULL, NULL, 1, 'ident-test-c');
            """);
        await using var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn));

        var act = () => LgdPlaceListLoader.EnsureLoadedAsync(context, list, CancellationToken.None);

        (await act.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Be(
            "Place list ident-test-c: the tables hold 3 villages, 1 talukas and 1 districts; the list holds 2, 1 and 1. Nothing was loaded.");
        (await CountAsync("SELECT count(*) FROM public.lgd_list_versions WHERE version = 'ident-test-c'")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM public.lgd_villages WHERE code IN (999000021, 999000022)")).Should().Be(0, "the load rolled back whole");
    }

    [Fact]
    public async Task The_app_role_reads_the_list_and_cannot_change_it()
    {
        await db.AssertAppRoleIsNotVacuousAsync();

        (await AppScalarAsync($"SELECT count(*) FROM public.lgd_villages WHERE list_version = '{Version}'")).Should().Be(44930L);

        var insert = await AppErrorAsync("INSERT INTO public.lgd_villages (code, taluka_code, name_en, status, list_version) VALUES (999000099, 4249, 'Fake', 1, 'x')");
        insert.Should().NotBeNull();
        insert!.SqlState.Should().Be("42501", "no write policy admits the app role");
        (await AppAffectedAsync("UPDATE public.lgd_villages SET name_en = 'Changed' WHERE code = 944182")).Should().Be(0);
        (await AppAffectedAsync("DELETE FROM public.lgd_villages WHERE code = 944182")).Should().Be(0);
        foreach (var table in new[] { "lgd_villages", "lgd_talukas", "lgd_districts", "lgd_list_versions" })
        {
            (await AppErrorAsync($"TRUNCATE public.{table}"))!.SqlState.Should().Be("42501", $"TRUNCATE {table} is revoked from the app role");
        }

        (await RowsAsync("SELECT name_en FROM public.lgd_villages WHERE code = 944182")).Single().Should().Equal("Pandharpur");
    }

    [Fact]
    public async Task The_reader_answers_by_code_from_the_current_version_only()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        await using (var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn)))
        {
            await LgdPlaceListLoader.EnsureLoadedAsync(context, TestList("ident-test-d", 999000031, 999000032), CancellationToken.None);
        }

        await using var provider = AppProvider();
        await using var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<AgriSync.BuildingBlocks.Persistence.TenantContext>().ElevateToAdminCrossTenant();
        var reader = scope.ServiceProvider.GetRequiredService<IPlaceListReader>();

        reader.Version.Should().Be(Version);
        var village = await reader.FindVillageAsync(944182);
        village.Should().BeEquivalentTo(new ListedVillage(944182, "Pandharpur", "पंढरपूर", "413304",
            new ListedTaluka(4249, "Pandharpur", null, new ListedDistrict(496, "Solapur", "सोलापूर"))));
        (await reader.FindTalukaAsync(4249))!.District.NameMr.Should().Be("सोलापूर");
        (await reader.FindDistrictAsync(496))!.NameEn.Should().Be("Solapur");
        (await reader.FindVillageAsync(1)).Should().BeNull("no village has that code");
        (await reader.FindVillageAsync(999000031)).Should().BeNull("a row of another list version is not this server's list");
        (await reader.FindVillageAsync(0)).Should().BeNull();
    }

    [Fact]
    public async Task Down_drops_the_four_tables_and_Up_loads_the_list_again()
    {
        await using (var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn)))
        {
            var before = (await context.Database.GetAppliedMigrationsAsync()).ToList();
            before.Should().Contain("20261127040000_AddLgdPlaceList");
            var later = before.Where(m => string.CompareOrdinal(m, "20261127040000_AddLgdPlaceList") > 0).ToList();
            later.Should().BeSubsetOf(["20261127041000_AddPersonIdentityProfile"], "only the lane's own later migration is reverted with it");

            await context.Database.GetService<IMigrator>().MigrateAsync("20261107061500_AddNewPhoneQuestion");
        }

        (await CountAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'lgd\\_%'")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM public.users")).Should().BeGreaterThanOrEqualTo(0, "the login tables are untouched");

        await using (var context = new UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn)))
        {
            await context.Database.MigrateAsync();
        }

        await PurveshDemoReseedHarness.GrantAppRoleAsync(db.SuperuserConn);
        (await CountAsync($"SELECT count(*) FROM public.lgd_villages WHERE list_version = '{Version}'")).Should().Be(44930);
        (await CountAsync($"SELECT count(*) FROM public.lgd_list_versions WHERE version = '{Version}'")).Should().Be(1);
    }

    // ── harness ───────────────────────────────────────────────────────────────────────────────────

    /// <summary>A two-village list of its own version (codes far outside the real list), parsed by the server's own parser.</summary>
    private static LgdPlaceList TestList(string version, int first, int second)
    {
        var district = 90000 + (first % 1000);
        var taluka = 80000 + (first % 1000);
        var tsv = $"#{version}\tsource=test\tprovenance=Secondary source; not independently verified\tvillages=2\ttalukas=1\tdistricts=1\n"
            + "code\ttaluka\tmr\ten\tpin\tstatus\n"
            + $"{first}\t{taluka}\tचाचणी एक\tTest One\t413304\tI\n"
            + $"{second}\t{taluka}\t\tTest Two\t\tU\n";
        var areas = $$"""
            {"version":"{{version}}","districts":[{"code":{{district}},"en":"Test District","mr":"चाचणी जिल्हा"}],"talukas":[{"code":{{taluka}},"district":{{district}},"en":"Test Taluka"}]}
            """;
        return LgdPlaceList.Parse(version, new StringReader(tsv), new StringReader(areas));
    }

    private ServiceProvider AppProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:UserDb"] = db.AppConn })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddUserInfrastructure(config);
        return services.BuildServiceProvider();
    }

    private Task<long> CountAsync(string sql) => PurveshDemoReseedHarness.CountAsync(db.SuperuserConn, sql);

    private Task<List<object?[]>> RowsAsync(string sql) => PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn, sql);

    private Task ExecAsync(string sql) => PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, sql);

    private async Task<object?> AppScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(db.AppConn);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync();
    }

    private async Task<int> AppAffectedAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(db.AppConn);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteNonQueryAsync();
    }

    private async Task<PostgresException?> AppErrorAsync(string sql)
    {
        try
        {
            await AppAffectedAsync(sql);
            return null;
        }
        catch (PostgresException ex)
        {
            return ex;
        }
    }
}
