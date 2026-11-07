// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT1c (D-107 B, D-108 3).
//
// Migration 20261107080000_AddInputLibrary creates the five ssf.input_library_* tables, seeds source 1 (297 products) from the
// embedded catalog.json, and puts them under ENABLE + FORCE RLS in the cost_categories shape: a global read policy
// (SELECT USING true) and a deny-write policy for agrisync_app (FOR ALL TO agrisync_app USING false WITH CHECK false).
// Proven here as agrisync_app, E3 first (neither superuser nor BYPASSRLS):
//   1. reads work with no farm scope, under a farm's scope and under a user's scope, and see every row;
//   2. insert is refused (42501) and update / delete touch nothing, on all five tables, under every scope;
//   3. every table is ENABLEd + FORCEd and carries both policies;
//   4. source 1 is seeded: 1 source, 297 published products, a ref each, the meta row at version 1, and the rows give back
//      catalog.json field for field when read as agrisync_app;
//   5. the intake, written through the ADMIN connection (a superuser here), reaches a farm only once published: a draft is
//      invisible to agrisync_app's published read, publish is refused while a conflict is open, and the settled difference
//      then reads back with both values.
// The merge owner runs this class (it needs the throwaway cluster the other RealPostgres suites use).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Domain.Inputs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.InputLibrary;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class InputLibraryRlsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly string[] Tables =
    [
        "input_library_sources", "input_library_products", "input_library_source_refs",
        "input_library_conflicts", "input_library_meta",
    ];

    private const string SecondSource = "company-list-it1c";

    [Fact]
    public async Task Every_scope_reads_the_library_and_agrisync_app_can_write_none_of_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The seed has no conflict; one is added (as the admin connection) so that table's read is not an empty proof.
        await InsertAConflictAsAdminAsync();

        var scopes = new (Guid? Farm, Guid? User, string Name)[]
        {
            (null, null, "no scope"),
            (FarmA, Owner, "farm A's scope"),
            (FarmB, OwnerB, "farm B's scope"),
            (null, Owner, "a user's scope"),
            (null, Paused, "a paused seat's user scope"),
        };

        foreach (var table in Tables)
        {
            var rows = await CountAsync($"SELECT count(*) FROM ssf.{table}");
            rows.Should().BeGreaterThan(0, "{0} holds rows (else the proof is vacuous)", table);

            foreach (var (farm, user, name) in scopes)
            {
                (await CountAsAppAsync(farm, user, table)).Should().Be(rows, "{0} is read in full under {1}", table, name);

                var insert = async () => await ExecAsAppAsync(farm, user, InsertRow(table));
                (await insert.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501", "{0}: insert under {1}", table, name);
                (await ExecAsAppAsync(farm, user, $"UPDATE ssf.{table} SET {SetClause(table)}")).Should().Be(0, "{0}: update under {1} touches nothing", table, name);
                (await ExecAsAppAsync(farm, user, $"DELETE FROM ssf.{table}")).Should().Be(0, "{0}: delete under {1} touches nothing", table, name);
            }

            (await CountAsync($"SELECT count(*) FROM ssf.{table}")).Should().Be(rows, "{0} is unchanged after every refused write", table);
        }
    }

    [Fact]
    public async Task Every_library_table_is_enabled_and_forced_and_carries_both_policies()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var table in Tables)
        {
            (await CountAsync($"""
                SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ssf' AND c.relname = '{table}' AND c.relrowsecurity AND c.relforcerowsecurity
                """)).Should().Be(1, "{0} is ENABLEd and FORCEd", table);
            (await CountAsync($"SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = '{table}' AND policyname = 'p_global_{table}_read' AND cmd = 'SELECT'"))
                .Should().Be(1, "{0} has its global read policy", table);
            (await CountAsync($"SELECT count(*) FROM pg_policies WHERE schemaname = 'ssf' AND tablename = '{table}' AND policyname = 'p_global_{table}_deny_write' AND cmd = 'ALL' AND 'agrisync_app' = ANY (roles)"))
                .Should().Be(1, "{0} has its deny-write policy for agrisync_app", table);

            // HONEST SCOPE OF THESE TWO LINES. This harness is a ONE-role cluster: the app role also receives full default
            // privileges on every table, so these assertions pass whether or not the migration's explicit GRANT SELECT ran. They do
            // NOT prove the GRANT. They only guard against a role split in the harness (a role that has SELECT today losing it) and
            // check that a read works under the app role. Proving the GRANT needs a cluster where the app role has no default
            // privileges (the schema owner and the app role are different roles): that is a DEPLOY check, not this suite's.
            (await CountAsync($"SELECT CASE WHEN has_table_privilege('agrisync_app', 'ssf.{table}', 'SELECT') THEN 1 ELSE 0 END"))
                .Should().Be(1, "{0}: agrisync_app is granted SELECT", table);
            (await CountAsAppAsync(null, null, table)).Should().BeGreaterThanOrEqualTo(0, "{0} reads under the app role", table);
        }
    }

    [Fact]
    public async Task Source_one_is_seeded_with_297_published_products_and_reads_back_as_catalog_json_as_agrisync_app()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await CountAsAppAsync(null, null, "input_library_sources")).Should().Be(1);
        (await CountAsAppAsync(null, null, "input_library_products")).Should().Be(297);
        (await CountAsAppAsync(null, null, "input_library_products", "status = 'published'")).Should().Be(297, "the seeded source 1 has 297 published products");
        (await CountAsAppAsync(null, null, "input_library_source_refs")).Should().Be(297);
        (await CountAsAppAsync(null, null, "input_library_conflicts")).Should().Be(0);
        (await CountAsAppAsync(null, null, "input_library_meta", "published_version = 1 AND shape_version = 'inputs-2'")).Should().Be(1);

        // The rows give back catalog.json field for field (the version string is the one member that is the server's own).
        await using var app = NewAppContext();
        var published = (await InputLibraryRows.LoadPublishedAsync(app, default))!.BuildPublished();
        var served = JsonNode.Parse(published.Json)!.AsObject();
        var embedded = JsonNode.Parse(File.ReadAllText(CatalogPath()))!.AsObject();
        published.Version.Should().Be("inputs-2.1");
        embedded["version"] = served["version"]!.GetValue<string>();
        JsonNode.DeepEquals(embedded, served).Should().BeTrue("the seeded rows must equal catalog.json field for field");
        served["products"]!.AsArray().Select(p => p!["id"]!.GetValue<string>())
            .Should().Equal(embedded["products"]!.AsArray().Select(p => p!["id"]!.GetValue<string>()), "in catalogue order");
    }

    [Fact]
    public async Task A_draft_source_is_invisible_to_the_published_read_until_every_conflict_is_settled_and_it_is_published()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var file = SourceFile();

        // The intake writes through the ADMIN connection (a superuser in this cluster), never agrisync_app.
        Guid conflictId;
        await using (var admin = NewSuperuserContext())
        {
            var workspace = (await InputLibraryRows.LoadAllAsync(admin, default))!;
            var report = InputLibraryIntake.Load(workspace, file);
            await InputLibraryRows.SaveAsync(admin, workspace, default);
            report.Conflicts.Should().ContainSingle();
            conflictId = report.Conflicts[0].Id;
        }

        // A farm's published read sees nothing of the draft: not the source, the new product, the ref or the difference.
        await AssertPublishedLibraryIsUntouchedAsync("inputs-2.1");
        (await CountAsAppAsync(null, null, "input_library_sources", $"id = '{SecondSource}'")).Should().Be(1, "the draft row exists (the library tables are readable) ...");

        // Publish is refused while the conflict is open; nothing changes.
        await using (var admin = NewSuperuserContext())
        {
            var workspace = (await InputLibraryRows.LoadAllAsync(admin, default))!;
            var outcome = InputLibraryIntake.Publish(workspace);
            outcome.Published.Should().BeFalse();
            outcome.OpenConflicts.Should().Be(1);
        }

        await AssertPublishedLibraryIsUntouchedAsync("inputs-2.1");

        // Settled as a real difference and published: the version moves, both values are kept, the new product is served.
        await using (var admin = NewSuperuserContext())
        {
            var workspace = (await InputLibraryRows.LoadAllAsync(admin, default))!;
            InputLibraryIntake.Decide(workspace, conflictId, InputLibraryConflictStatus.RealDifference, "agronomist", DateTime.UtcNow);
            InputLibraryIntake.Publish(workspace).Published.Should().BeTrue();
            await InputLibraryRows.SaveAsync(admin, workspace, default);
        }

        await using var app = NewAppContext();
        var copy = (await InputLibraryRows.LoadPublishedAsync(app, default))!.BuildPublished();
        copy.Version.Should().Be("inputs-2.2");
        var served = JsonNode.Parse(copy.Json)!.AsObject();
        served["sources"]!.AsArray().Should().HaveCount(2);
        served["products"]!.AsArray().Should().HaveCount(298);
        var abamectin = served["products"]!.AsArray().Select(p => p!.AsObject()).Single(p => p["id"]!.GetValue<string>() == "p-abamectin-1-9-ec");
        abamectin["differingUses"]!.AsArray().Should().HaveCount(2);
        abamectin["differingUses"]![1]!["labelMr"]!.GetValue<string>().Should().Be("स्रोत 2");
        abamectin["sourceRefs"]!.AsArray().Should().HaveCount(2);

        // The same conflict cannot be re-ruled once published, and the app role still cannot touch the rows.
        (await ExecAsAppAsync(null, null, $"UPDATE ssf.input_library_conflicts SET status = 'error' WHERE id = '{conflictId}'")).Should().Be(0);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────

    private ShramSafalDbContext NewAppContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);

    private async Task AssertPublishedLibraryIsUntouchedAsync(string version)
    {
        await using var app = NewAppContext();
        var copy = (await InputLibraryRows.LoadPublishedAsync(app, default))!.BuildPublished();
        copy.Version.Should().Be(version);
        var served = JsonNode.Parse(copy.Json)!.AsObject();
        served["sources"]!.AsArray().Should().HaveCount(1, "a draft source is never served");
        served["products"]!.AsArray().Should().HaveCount(297, "a draft product is never served");
        copy.Json.Should().NotBeEmpty();
        System.Text.Encoding.UTF8.GetString(copy.Json).Should().NotContain("zzpest").And.NotContain(SecondSource);
    }

    /// <summary>A second source: one product that is a library product with a different target list, and one new product.</summary>
    private static JsonObject SourceFile()
    {
        var catalog = JsonNode.Parse(File.ReadAllText(CatalogPath()))!.AsObject();
        JsonObject Copy(string id, string newId, Action<JsonObject> change)
        {
            var copy = catalog["products"]!.AsArray().First(p => p!["id"]!.GetValue<string>() == id)!.DeepClone().AsObject();
            copy["id"] = newId;
            copy["sourceRefs"] = new JsonArray(new JsonObject { ["source"] = SecondSource, ["ref"] = "page 7", ["entry"] = "c-1" });
            change(copy);
            return copy;
        }

        return new JsonObject
        {
            ["source"] = new JsonObject
            {
                ["id"] = SecondSource,
                ["title"] = "Company list (test)",
                ["kind"] = "company-list",
                ["receivedOn"] = "2026-11-08",
                ["checkedBy"] = null,
            },
            ["products"] = new JsonArray(
                Copy("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p["targets"] = new JsonArray("mites", "zzpest")),
                Copy("p-abamectin-1-9-ec", "p-abamectin-3-ec", p =>
                {
                    p["activeIngredients"] = new JsonArray(new JsonObject { ["en"] = "Abamectin", ["mr"] = null, ["pct"] = "3%" });
                })),
        };
    }

    private static string CatalogPath()
    {
        var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "sync-contract", "reference", "inputs", "catalog.json");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            dir = dir.Parent;
        }

        throw new FileNotFoundException("sync-contract/reference/inputs/catalog.json not found above " + System.AppContext.BaseDirectory);
    }

    private async Task InsertAConflictAsAdminAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.input_library_sources (id, title, kind, received_on, status, position)
            VALUES ('rls-proof-source', 'proof', 'guide', '2026-11-08', 'draft', 2) ON CONFLICT DO NOTHING;
            INSERT INTO ssf.input_library_conflicts (id, product_id, field, existing_value, incoming_source_id, incoming_value, status)
            VALUES ('3d030000-0000-4000-8000-0000000009c1', 'p-abamectin-1-9-ec', 'targets', '["mites"]', 'rls-proof-source', '["thrips"]', 'open')
            ON CONFLICT DO NOTHING;
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>A row for each table that is valid in every other way (keys exist, checks hold), so only row-level security can refuse it.</summary>
    private static string InsertRow(string table) => table switch
    {
        "input_library_sources" =>
            "INSERT INTO ssf.input_library_sources (id, title, kind, received_on, status, position) VALUES ('rls-attempt', 't', 'guide', '2026-11-08', 'draft', 90)",
        "input_library_products" =>
            "INSERT INTO ssf.input_library_products (id, category, facts, match_key, status, ordinal) VALUES ('p-rls-attempt', 'fungicide', '{}'::jsonb, 'k', 'draft', 9000)",
        "input_library_source_refs" =>
            "INSERT INTO ssf.input_library_source_refs (product_id, source_id, \"ref\") VALUES ('p-abamectin-1-9-ec', 'agro-dosage-guide-en', 'line 99999')",
        "input_library_conflicts" =>
            "INSERT INTO ssf.input_library_conflicts (id, product_id, field, existing_value, incoming_source_id, incoming_value, status) "
            + "VALUES ('3d030000-0000-4000-8000-0000000009c2', 'p-abamectin-1-9-ec', 'modes', '[]', 'agro-dosage-guide-en', '[]', 'open')",
        "input_library_meta" =>
            "INSERT INTO ssf.input_library_meta (id, shape_version, published_version, non_matching_words) VALUES (1, 'x', 99, '[]'::jsonb)",
        _ => throw new ArgumentOutOfRangeException(nameof(table), table, null),
    };

    private static string SetClause(string table) => table switch
    {
        "input_library_sources" => "title = 'changed'",
        "input_library_products" => "category = 'changed'",
        "input_library_source_refs" => "\"ref\" = 'changed'",
        "input_library_conflicts" => "status = 'error'",
        "input_library_meta" => "published_version = 99",
        _ => throw new ArgumentOutOfRangeException(nameof(table), table, null),
    };

    // ── As agrisync_app, in a transaction that is always rolled back ─────────────────────────────

    private Task<long> CountAsAppAsync(Guid? farm, Guid? user, string table, string predicate = "true") =>
        ScalarAsAppAsync(farm, user, $"SELECT count(*) FROM ssf.{table} WHERE {predicate}");

    private async Task<long> ScalarAsAppAsync(Guid? farm, Guid? user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<long> ExecAsAppAsync(Guid? farm, Guid? user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var affected = await cmd.ExecuteNonQueryAsync();
        await tx.RollbackAsync();
        return affected;
    }

    /// <summary>The scope exactly as the doors set it: the farm (or the all-zeros sentinel) and the user (or empty).</summary>
    private static async Task SetScopeAsync(NpgsqlConnection db, Guid? farm, Guid? user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @farm, true), set_config('agrisync.user_id', @user, true)";
        cmd.Parameters.AddWithValue("farm", farm?.ToString() ?? Guid.Empty.ToString());
        cmd.Parameters.AddWithValue("user", user?.ToString() ?? string.Empty);
        await cmd.ExecuteNonQueryAsync();
    }

    // ── As superuser ────────────────────────────────────────────────────────────────────────────

    private async Task<long> CountAsync(string sql)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }
}
