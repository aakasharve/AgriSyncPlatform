// spec: voice-instant-phase-a-2026-11-23 (S6) / voice-india-only-sarvam (Task 3) - the data migration that makes the
// voice provider row say Sarvam and Sarvam.
//
// No database is touched: the tests read the migration's SQL text and the operations it emits. (The CTO runs the real-
// Postgres projects, where the SQL itself is executed.) Authored from the acceptance criteria only.
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Migrations;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class SetVoiceProvidersToSarvamMigrationTests
{
    private const string Previous = "20260825130000_SetTranscriberProviderToSarvam";

    private static string SourceDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "AgriSync.sln")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return dir!.FullName;
    }

    private static string Normalised(string sql) => Regex.Replace(sql, @"\s+", " ").Trim();

    private static (string Set, string Where) Split(string sql)
    {
        var normalised = Normalised(sql);
        var at = normalised.IndexOf(" WHERE ", StringComparison.OrdinalIgnoreCase);
        Assert.True(at > 0, "the statement must have a WHERE: " + normalised);
        return (normalised[..at], normalised[(at + " WHERE ".Length)..]);
    }

    // ---- identity ----

    [Fact]
    public void The_migration_id_constant_equals_the_id_in_its_file_name_and_the_migration_attribute()
    {
        const string expected = "20261124090000_SetVoiceProvidersToSarvam";

        Assert.Equal(expected, SetVoiceProvidersToSarvam.MigrationId);
        var file = Path.Combine(
            SourceDirectory(), "apps", "ShramSafal", "ShramSafal.Infrastructure", "Persistence", "Migrations",
            SetVoiceProvidersToSarvam.MigrationId + ".cs");
        Assert.True(File.Exists(file), $"no migration file is named after its id: {file}");
        var attribute = typeof(SetVoiceProvidersToSarvam).GetCustomAttribute<MigrationAttribute>();
        Assert.NotNull(attribute);
        Assert.Equal(SetVoiceProvidersToSarvam.MigrationId, attribute!.Id);
        Assert.Equal(typeof(ShramSafalDbContext), typeof(SetVoiceProvidersToSarvam).GetCustomAttribute<DbContextAttribute>()?.ContextType);
    }

    [Fact]
    public void The_migration_is_found_by_the_context_and_runs_after_the_one_it_replaces()
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql("Host=localhost;Database=never_opened;Username=u;Password=p") // never connected to: only reads the assembly
            .Options;
        using var db = new ShramSafalDbContext(options);

        var ids = db.Database.GetMigrations().ToList();

        Assert.Contains(SetVoiceProvidersToSarvam.MigrationId, ids);
        Assert.Contains(Previous, ids);
        Assert.True(
            string.CompareOrdinal(SetVoiceProvidersToSarvam.MigrationId, Previous) > 0,
            "EF runs migrations in id order: this one must come after the one that set the transcriber");
        Assert.Equal(ids.OrderBy(i => i, StringComparer.Ordinal).ToList(), ids);
    }

    // ---- Up: Gemini / Gemini (or any mix) becomes Sarvam / Sarvam ----

    [Fact]
    public void UpSql_sets_both_halves_of_the_pair_to_Sarvam_on_the_provider_config_table()
    {
        var (set, where) = Split(SetVoiceProvidersToSarvam.UpSql);

        Assert.StartsWith("UPDATE ssf.ai_provider_configs SET", set, StringComparison.OrdinalIgnoreCase);
        Assert.Matches(@"transcriber_provider\s*=\s*'Sarvam'", set);
        Assert.Matches(@"structurer_provider\s*=\s*'Sarvam'", set);
        Assert.DoesNotContain("Gemini", set, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(where));
    }

    [Fact]
    public void UpSql_only_touches_rows_that_are_not_already_Sarvam_and_Sarvam_so_a_second_run_changes_nothing()
    {
        var (_, where) = Split(SetVoiceProvidersToSarvam.UpSql);

        // Either column not Sarvam selects the row (Gemini/Gemini, Sarvam/Gemini and Gemini/Sarvam are all rewritten) ...
        Assert.Matches(@"transcriber_provider\s*(IS DISTINCT FROM|<>|!=)\s*'Sarvam'", where);
        Assert.Matches(@"structurer_provider\s*(IS DISTINCT FROM|<>|!=)\s*'Sarvam'", where);
        Assert.Matches(@"\bOR\b", where);
        // ... and a row that is already Sarvam/Sarvam is not matched: the WHERE never says "= 'Sarvam'" for selection.
        Assert.DoesNotMatch(@"provider\s*=\s*'Sarvam'", where);
    }

    [Fact]
    public void UpSql_is_data_only_no_schema_change_no_delete()
    {
        var sql = Normalised(SetVoiceProvidersToSarvam.UpSql);

        foreach (var forbidden in new[] { "DROP ", "DELETE ", "TRUNCATE ", "ALTER ", "CREATE ", "INSERT " })
        {
            Assert.DoesNotContain(forbidden, sql, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Single(Regex.Matches(sql, "UPDATE ", RegexOptions.IgnoreCase));
    }

    [Fact]
    public void UpSql_bumps_modified_at_so_the_most_recently_modified_row_is_the_one_that_is_read()
    {
        Assert.Matches(@"modified_at_utc\s*=\s*NOW\(\)", Split(SetVoiceProvidersToSarvam.UpSql).Set);
    }

    // ---- Down: Sarvam / Sarvam becomes Sarvam / Gemini ----

    [Fact]
    public void DownSql_turns_Sarvam_and_Sarvam_back_into_Sarvam_and_Gemini_and_nothing_else()
    {
        var (set, where) = Split(SetVoiceProvidersToSarvam.DownSql);

        Assert.StartsWith("UPDATE ssf.ai_provider_configs SET", set, StringComparison.OrdinalIgnoreCase);
        Assert.Matches(@"structurer_provider\s*=\s*'Gemini'", set);
        Assert.DoesNotMatch(@"transcriber_provider\s*=\s*'Gemini'", set); // the transcriber stays Sarvam
        Assert.Matches(@"transcriber_provider\s*=\s*'Sarvam'", where);
        Assert.Matches(@"structurer_provider\s*=\s*'Sarvam'", where);
        Assert.Matches(@"\bAND\b", where);
    }

    [Fact]
    public void DownSql_only_rewinds_a_row_that_is_still_Sarvam_and_Sarvam()
    {
        var (_, where) = Split(SetVoiceProvidersToSarvam.DownSql);

        // A pair somebody chose differently afterwards is not silently reverted: the WHERE selects Sarvam/Sarvam only.
        Assert.DoesNotMatch(@"(IS DISTINCT FROM|<>|!=)", where);
        Assert.DoesNotMatch(@"\bOR\b", where);
    }

    [Fact]
    public void DownSql_is_data_only_too()
    {
        var sql = Normalised(SetVoiceProvidersToSarvam.DownSql);

        foreach (var forbidden in new[] { "DROP ", "DELETE ", "TRUNCATE ", "ALTER ", "CREATE ", "INSERT " })
        {
            Assert.DoesNotContain(forbidden, sql, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Single(Regex.Matches(sql, "UPDATE ", RegexOptions.IgnoreCase));
    }

    // ---- what EF will really run ----

    [Fact]
    public void Up_emits_exactly_the_up_sql_and_Down_exactly_the_down_sql()
    {
        var migration = new SetVoiceProvidersToSarvam { ActiveProvider = "Npgsql.EntityFrameworkCore.PostgreSQL" };

        var up = Assert.Single(migration.UpOperations);
        var down = Assert.Single(migration.DownOperations);

        Assert.Equal(SetVoiceProvidersToSarvam.UpSql, Assert.IsType<SqlOperation>(up).Sql);
        Assert.Equal(SetVoiceProvidersToSarvam.DownSql, Assert.IsType<SqlOperation>(down).Sql);
    }

    [Fact]
    public void The_two_statements_are_not_the_same_statement()
    {
        Assert.NotEqual(Normalised(SetVoiceProvidersToSarvam.UpSql), Normalised(SetVoiceProvidersToSarvam.DownSql));
    }
}
