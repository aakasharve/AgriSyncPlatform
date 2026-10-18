// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure;
using User.Infrastructure.Persistence;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the shared real-Postgres harness for
/// the <c>--reseed-purvesh-demo</c> proofs. Authored from the spec and the command's public
/// surface (<see cref="PurveshDemoReseedCommand.RunAsync"/>, the report records, the seeder's
/// public members) — not from the implementation.
/// </summary>
/// <remarks>
/// <para><b>Production parity, on purpose.</b> The command runs through a DI graph composed the
/// way <c>Program.cs</c> composes it (User + Accounts + ShramSafal registrations, the scoped
/// <see cref="TenantContext"/> + interceptor), connected as the NON-superuser, non-BYPASSRLS
/// <c>agrisync_app</c> role, in a <c>Production</c> host environment. The schema is migrated with
/// the APP'S OWN history tables (<c>public.__ef_migrations</c>, <c>ssf.__ef_migrations</c>,
/// <c>accounts.__accounts_migrations_history</c>, <c>analytics.__analytics_migrations_history</c>)
/// in the production 4-phase order, so the command's pending-migration check reads exactly what
/// it reads in production, and the app role is granted read on both <c>__ef_migrations</c>
/// tables plus the usual grant block.</para>
/// <para><b>Database safety.</b> Every database this harness creates is named
/// <c>ssf_reseed_*</c>, and <see cref="DropDatabaseAsync"/> refuses any other name. The root
/// connection is normalised to the <c>postgres</c> maintenance database; no existing database
/// (in particular the founder's <c>agrisync</c>) is ever opened.</para>
/// <para><b>Arrange.</b> The pre-existing demo farm is produced by the v2 startup seeder
/// (<see cref="PurveshDemoSeeder.SeedPurveshDemoAsync"/>, what <c>SEED_PURVESH_DEMO=true</c>
/// writes) — run as superuser, because arranging prior state is not the system under test.</para>
/// </remarks>
public static class PurveshDemoReseedHarness
{
    public const string DbPrefix = "ssf_reseed_";
    public const string BeginFence = "---BEGIN-PURVESH-DEMO-RESEED---";
    public const string EndFence = "---END-PURVESH-DEMO-RESEED---";

    public const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    public static readonly TimeSpan Ist = TimeSpan.FromHours(5.5);

    // ── connections ─────────────────────────────────────────────────────────

    /// <summary>
    /// The superuser maintenance connection (database <c>postgres</c>, no pooling). Fails —
    /// never skips — when the server is absent or refuses us: a proof that silently skips is
    /// indistinguishable from one that passed.
    /// </summary>
    public static async Task<string> MaintenanceConnectionAsync()
    {
        var root = IntegrationPostgres.ResolveRootConnection();
        var skip = await IntegrationPostgres.ProbeOrSkipReasonAsync(root);
        if (skip is not null)
        {
            throw new InvalidOperationException(
                "RequiresPostgres: " + skip + " These reseed proofs must FAIL, not skip, when they cannot run. "
                + "Set REQUIRES_POSTGRES_ROOT_CONN.");
        }

        return new NpgsqlConnectionStringBuilder(root) { Database = "postgres", Pooling = false }.ConnectionString;
    }

    public static string SuperuserConnFor(string maintenanceConn, string database) =>
        new NpgsqlConnectionStringBuilder(maintenanceConn) { Database = database, Pooling = false }.ConnectionString;

    public static string AppConnFor(string superuserConn) =>
        new NpgsqlConnectionStringBuilder(superuserConn)
        {
            Username = TestRoleCredentials.AppRoleUser,
            Password = TestRoleCredentials.AppRolePassword,
            Pooling = false,
        }.ConnectionString;

    public static string NewDatabaseName(string purpose) => $"{DbPrefix}{purpose}_{Guid.NewGuid():N}";

    public static async Task CreateDatabaseAsync(string maintenanceConn, string name, string? template = null)
    {
        GuardName(name);
        await using var admin = new NpgsqlConnection(maintenanceConn);
        await admin.OpenAsync();
        if (template is not null)
        {
            GuardName(template);
            await TerminateAsync(admin, template);
        }

        await using var create = admin.CreateCommand();
        create.CommandText = template is null
            ? $"CREATE DATABASE \"{name}\""
            : $"CREATE DATABASE \"{name}\" TEMPLATE \"{template}\"";
        await create.ExecuteNonQueryAsync();
    }

    public static async Task DropDatabaseAsync(string maintenanceConn, string name)
    {
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(maintenanceConn))
        {
            return;
        }

        GuardName(name);
        try
        {
            NpgsqlConnection.ClearAllPools();
            await using var admin = new NpgsqlConnection(maintenanceConn);
            await admin.OpenAsync();
            await TerminateAsync(admin, name);
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{name}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked ssf_reseed_* scratch database is harmless.
        }
    }

    private static void GuardName(string name)
    {
        if (!name.StartsWith(DbPrefix, StringComparison.Ordinal) || name.Length > 63)
        {
            throw new InvalidOperationException(
                $"Refusing to create/clone/drop '{name}': this harness only ever touches its own {DbPrefix}* databases.");
        }
    }

    private static async Task TerminateAsync(NpgsqlConnection admin, string database)
    {
        await using var terminate = admin.CreateCommand();
        terminate.CommandText =
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
        terminate.Parameters.AddWithValue("db", database);
        await terminate.ExecuteNonQueryAsync();
    }

    // ── schema, exactly as production builds it ──────────────────────────────

    /// <summary>
    /// The production 4-phase interleave (Program.cs InitializeApplicationDataAsync), with the
    /// app's own migration-history tables — NOT <see cref="IntegrationMigrationChain"/>, whose
    /// default <c>__EFMigrationsHistory</c> would make every migration look pending to the
    /// command's DI-registered contexts.
    /// </summary>
    public static async Task MigrateLikeProductionAsync(string superuserConn)
    {
        const string ssfPhaseATarget = "20260421075311_AlterCostEntriesAddJobCardId";
        const string analyticsPhase1Target = "20260502020000_RestoreBuckets234Matviews";

        await using (var user = new UserDbContext(UserOptions(superuserConn)))
        {
            await user.Database.MigrateAsync();
        }

        await using (var accounts = new AccountsDbContext(AccountsOptions(superuserConn)))
        {
            await accounts.Database.MigrateAsync();
        }

        await using (var ssfA = new ShramSafalDbContext(SsfOptions(superuserConn)))
        {
            await ssfA.Database.GetService<IMigrator>().MigrateAsync(ssfPhaseATarget);
        }

        await using (var analyticsB = new AnalyticsDbContext(AnalyticsOptions(superuserConn)))
        {
            await analyticsB.Database.GetService<IMigrator>().MigrateAsync(analyticsPhase1Target);
        }

        await using (var ssf = new ShramSafalDbContext(SsfOptions(superuserConn)))
        {
            await ssf.Database.MigrateAsync();
        }

        await using (var analytics = new AnalyticsDbContext(AnalyticsOptions(superuserConn)))
        {
            await analytics.Database.MigrateAsync();
        }
    }

    public static DbContextOptions<UserDbContext> UserOptions(string conn) =>
        new DbContextOptionsBuilder<UserDbContext>()
            .UseNpgsql(conn, n => n.MigrationsHistoryTable("__ef_migrations", "public")).Options;

    public static DbContextOptions<ShramSafalDbContext> SsfOptions(string conn) =>
        new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn, n => n.MigrationsHistoryTable("__ef_migrations", "ssf")).Options;

    private static DbContextOptions<AccountsDbContext> AccountsOptions(string conn) =>
        new DbContextOptionsBuilder<AccountsDbContext>()
            .UseNpgsql(conn, n => n.MigrationsHistoryTable("__accounts_migrations_history", AccountsDbContext.SchemaName))
            .Options;

    private static DbContextOptions<AnalyticsDbContext> AnalyticsOptions(string conn) =>
        new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, n =>
            {
                n.MigrationsAssembly(typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                n.MigrationsHistoryTable("__analytics_migrations_history", AnalyticsDbContext.SchemaName);
            })
            .Options;

    /// <summary>
    /// The usual grant block for the non-ssf schemas (ssf's own grants come from the
    /// BootstrapDbRoles migration) plus READ on both <c>__ef_migrations</c> history tables, which
    /// the command's pending-migration check reads as the app role.
    /// </summary>
    public static async Task GrantAppRoleAsync(string superuserConn)
    {
        var role = TestRoleCredentials.AppRoleUser;
        await ExecAsync(superuserConn, $"""
            GRANT USAGE ON SCHEMA public, analytics, accounts TO {role};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics, accounts TO {role};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics, accounts TO {role};
            GRANT USAGE ON SCHEMA ssf TO {role};
            GRANT SELECT ON public.__ef_migrations TO {role};
            GRANT SELECT ON ssf.__ef_migrations TO {role};
            """);
    }

    /// <summary>The vacuity guard: true when the connection could bypass RLS (superuser or BYPASSRLS).</summary>
    public static async Task<bool> CanBypassRlsAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = RoleVacuityGuardSql;
        return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
    }

    // ── DI, composed the way Program.cs composes it ─────────────────────────

    /// <param name="clockUtc">
    /// When set, the product's <see cref="IClock"/> is pinned (registered after
    /// <c>AddBuildingBlocks</c>, so it wins) — used for the owner's in-app actions, so their
    /// timestamps sit on the same timeline as the fixed run instants. The command itself is given
    /// its run instant explicitly and never reads this.
    /// </param>
    public static ServiceProvider BuildProvider(string conn, string environmentName = "Production", DateTime? clockUtc = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
                ["ConnectionStrings:AccountsDb"] = conn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton<IHostEnvironment>(new FixedHostEnvironment(environmentName));

        services.AddBuildingBlocks();
        services.AddScoped<TenantContext>();
        services.AddScoped<TenantConnectionInterceptor>();
        services.AddUserInfrastructure(config);
        services.AddShramSafalApi(config);
        services.AddAccountsInfrastructure(config);
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();
        services.AddTransient<PurveshDemoSeeder>();
        if (clockUtc is { } fixedUtc)
        {
            services.AddSingleton<IClock>(new FixedClock(fixedUtc));
        }

        return services.BuildServiceProvider();
    }

    /// <summary>
    /// Runs <paramref name="work"/> the way a labour endpoint runs a request for a signed-in
    /// caller: one transaction on the ShramSafal context, tenancy established by
    /// <see cref="ICallerFarmTenantScope.EstablishForCallerAsync"/> (membership-checked), RLS live.
    /// </summary>
    public static async Task<T> AsCallerAsync<T>(
        IServiceProvider provider, Guid farmId, Guid userId, Func<IServiceProvider, Task<T>> work)
    {
        await using var scope = provider.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        var gate = await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(farmId, userId);
        if (!gate.IsSuccess)
        {
            throw new InvalidOperationException($"caller scope refused: {gate.Error}");
        }

        var result = await work(sp);
        await tx.CommitAsync();
        return result;
    }

    /// <summary>
    /// Arrange-only: the v2 startup seed, exactly as Program.cs runs it under
    /// <c>SEED_PURVESH_DEMO=true</c> (admin-elevated scope), on a superuser connection.
    /// </summary>
    public static async Task<string> SeedV2DemoAsync(string superuserConn)
    {
        await using var provider = BuildProvider(superuserConn, "Development");
        await using var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return await scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>().SeedPurveshDemoAsync();
    }

    // ── the command ─────────────────────────────────────────────────────────

    public sealed record CommandRun(int ExitCode, string Output, JsonElement? Report)
    {
        public JsonElement RequireReport() =>
            Report ?? throw new InvalidOperationException("The command printed no fenced report. Output:\n" + Output);
    }

    public static async Task<CommandRun> RunReseedAsync(
        IServiceProvider provider, DateTime utcNow, bool dryRun)
    {
        var args = dryRun
            ? new[] { PurveshDemoReseedCommand.Flag, PurveshDemoReseedCommand.DryRunFlag }
            : new[] { PurveshDemoReseedCommand.Flag };
        await using var output = new StringWriter();
        var exit = await PurveshDemoReseedCommand.RunAsync(provider, args, output, utcNow, CancellationToken.None);
        var text = output.ToString();
        return new CommandRun(exit, text, ParseFencedReport(text));
    }

    public static JsonElement? ParseFencedReport(string output)
    {
        var begin = output.IndexOf(BeginFence, StringComparison.Ordinal);
        var end = output.IndexOf(EndFence, StringComparison.Ordinal);
        if (begin < 0 || end < 0 || end < begin)
        {
            return null;
        }

        var json = output[(begin + BeginFence.Length)..end].Trim();
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    /// <summary>Case-insensitive property lookup (the report's casing is the serializer's).</summary>
    public static JsonElement Prop(this JsonElement e, string name)
    {
        foreach (var p in e.EnumerateObject())
        {
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                return p.Value;
            }
        }

        throw new KeyNotFoundException($"Report has no '{name}' member. Report: {e}");
    }

    public static bool TryProp(this JsonElement e, string name, out JsonElement value)
    {
        foreach (var p in e.EnumerateObject())
        {
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                value = p.Value;
                return true;
            }
        }

        value = default;
        return false;
    }

    // ── ground truth (superuser, RLS-bypassing on purpose: these assert what is STORED) ──

    public static async Task ExecAsync(string conn, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    public static async Task<object?> ScalarAsync(string conn, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    public static async Task<long> CountAsync(string conn, string sql, params (string Name, object Value)[] args) =>
        Convert.ToInt64(await ScalarAsync(conn, sql, args));

    public static async Task<List<object?[]>> RowsAsync(string conn, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var rows = new List<object?[]>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }

    // ── whole-database snapshots ────────────────────────────────────────────

    private static readonly Regex UuidPattern = new(
        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Every row of every ordinary/partitioned table in the app's schemas, as Postgres renders
    /// the whole row (<c>t::text</c>, session TimeZone = UTC so timestamps are stable).
    /// </summary>
    public sealed class DbSnapshot(Dictionary<string, List<string>> tables)
    {
        public IReadOnlyDictionary<string, List<string>> Tables { get; } = tables;

        public IReadOnlyList<string> Rows(string table) =>
            Tables.TryGetValue(table, out var rows) ? rows : [];
    }

    public static readonly string[] SnapshotSchemas = ["ssf", "public", "accounts", "analytics", "mis"];

    public static async Task<DbSnapshot> SnapshotAsync(string superuserConn)
    {
        await using var db = new NpgsqlConnection(superuserConn);
        await db.OpenAsync();
        await using (var tz = db.CreateCommand())
        {
            tz.CommandText = "SET TIME ZONE 'UTC'";
            await tz.ExecuteNonQueryAsync();
        }

        var tableNames = new List<string>();
        await using (var list = db.CreateCommand())
        {
            list.CommandText = """
                SELECT n.nspname || '.' || c.relname
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
                  AND n.nspname = ANY(@schemas)
                ORDER BY 1
                """;
            list.Parameters.AddWithValue("schemas", SnapshotSchemas);
            await using var reader = await list.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                tableNames.Add(reader.GetString(0));
            }
        }

        var tables = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var table in tableNames)
        {
            var parts = table.Split('.');
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT t::text FROM \"{parts[0]}\".\"{parts[1]}\" t";
            var rows = new List<string>();
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                rows.Add(reader.GetString(0));
            }

            rows.Sort(StringComparer.Ordinal);
            tables[table] = rows;
        }

        return new DbSnapshot(tables);
    }

    public sealed record TableDiff(string Table, IReadOnlyList<string> Removed, IReadOnlyList<string> Added)
    {
        public bool IsEmpty => Removed.Count == 0 && Added.Count == 0;
    }

    public static List<TableDiff> Diff(DbSnapshot before, DbSnapshot after)
    {
        var diffs = new List<TableDiff>();
        foreach (var table in before.Tables.Keys.Union(after.Tables.Keys).OrderBy(t => t, StringComparer.Ordinal))
        {
            var b = before.Rows(table);
            var a = after.Rows(table);
            var removed = MultisetMinus(b, a);
            var added = MultisetMinus(a, b);
            if (removed.Count > 0 || added.Count > 0)
            {
                diffs.Add(new TableDiff(table, removed, added));
            }
        }

        return diffs;
    }

    private static List<string> MultisetMinus(IReadOnlyList<string> left, IReadOnlyList<string> right)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var r in right)
        {
            counts[r] = counts.TryGetValue(r, out var c) ? c + 1 : 1;
        }

        var result = new List<string>();
        foreach (var l in left)
        {
            if (counts.TryGetValue(l, out var c) && c > 0)
            {
                counts[l] = c - 1;
            }
            else
            {
                result.Add(l);
            }
        }

        return result;
    }

    public static IEnumerable<Guid> UuidsIn(string rowText) =>
        UuidPattern.Matches(rowText).Select(m => Guid.Parse(m.Value));

    /// <summary>
    /// The set of ids "owned" by <paramref name="farmId"/> in a snapshot: the farm id itself, the
    /// <c>"Id"</c> of every row that names the farm in a farm-scoping column, and — to a fixpoint —
    /// the first uuid (the row id) of every row that references an owned id. Child rows that carry
    /// no farm column (log tasks, verifications, corrections, …) are reached through their parent.
    /// </summary>
    public static async Task<HashSet<Guid>> OwnedIdsAsync(string superuserConn, Guid farmId, params DbSnapshot[] snapshots)
    {
        var owned = new HashSet<Guid> { farmId };
        var farmScoped = await FarmScopedRowIdsAsync(superuserConn, farmId);
        owned.UnionWith(farmScoped);

        // Only tables whose FIRST column is a uuid row id may grow the set — so a row that merely
        // names a person (an audit row's actor, say) can never make that PERSON "owned".
        var idFirstTables = (await RowsAsync(superuserConn, """
                SELECT c.table_schema || '.' || c.table_name
                FROM information_schema.columns c
                JOIN information_schema.tables t
                  ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
                WHERE c.table_schema = 'ssf' AND c.ordinal_position = 1
                  AND lower(c.column_name) = 'id' AND c.data_type = 'uuid'
                """))
            .Select(r => (string)r[0]!)
            .ToHashSet(StringComparer.Ordinal);

        var allRows = snapshots.SelectMany(s => s.Tables.Where(kv => idFirstTables.Contains(kv.Key)).SelectMany(kv => kv.Value))
            .Distinct(StringComparer.Ordinal)
            .Select(r => (Text: r, Ids: UuidsIn(r).ToArray()))
            .Where(r => r.Ids.Length > 0)
            .ToList();

        bool grew;
        do
        {
            grew = false;
            foreach (var (_, ids) in allRows)
            {
                if (!owned.Contains(ids[0]) && ids.Skip(1).Any(owned.Contains))
                {
                    owned.Add(ids[0]);
                    grew = true;
                }
            }
        }
        while (grew);

        return owned;
    }

    /// <summary>Row ids of every table with a farm-scoping column equal to the farm (live DB).</summary>
    private static async Task<HashSet<Guid>> FarmScopedRowIdsAsync(string superuserConn, Guid farmId)
    {
        var result = new HashSet<Guid>();
        var columns = await RowsAsync(superuserConn, """
            SELECT c.table_schema, c.table_name, c.column_name
            FROM information_schema.columns c
            JOIN information_schema.columns idc
              ON idc.table_schema = c.table_schema AND idc.table_name = c.table_name AND idc.column_name = 'Id'
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
            WHERE c.table_schema = ANY(@schemas)
              AND c.column_name IN ('farm_id', 'originating_farm_id', 'FarmId')
              AND c.data_type = 'uuid'
              AND idc.data_type = 'uuid'
            """, ("schemas", SnapshotSchemas));
        foreach (var col in columns)
        {
            var rows = await RowsAsync(superuserConn,
                $"SELECT \"Id\" FROM \"{col[0]}\".\"{col[1]}\" WHERE \"{col[2]}\" = @farm", ("farm", farmId));
            foreach (var r in rows)
            {
                result.Add((Guid)r[0]!);
            }
        }

        return result;
    }

    /// <summary>A row "belongs" to an owned set when its own id (first uuid) or any referenced uuid is owned.</summary>
    public static bool Mentions(string rowText, HashSet<Guid> owned) => UuidsIn(rowText).Any(owned.Contains);

    /// <summary>
    /// Every row of the snapshot that belongs to the farm (by <see cref="Mentions"/>), sorted — the
    /// farm's whole footprint, for a hash-identity comparison.
    /// </summary>
    public static List<string> Footprint(DbSnapshot snapshot, HashSet<Guid> owned) =>
        snapshot.Tables
            .SelectMany(kv => kv.Value.Where(r => Mentions(r, owned)).Select(r => kv.Key + "|" + r))
            .OrderBy(r => r, StringComparer.Ordinal)
            .ToList();

    public static string Sha256(IEnumerable<string> lines)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = System.Text.Encoding.UTF8.GetBytes(string.Join("\n", lines));
        return Convert.ToHexString(sha.ComputeHash(bytes));
    }

    // ── misc ────────────────────────────────────────────────────────────────

    public static DateOnly FarmLocalDate(DateTime utc) => DateOnly.FromDateTime(utc + Ist);

    /// <summary>A Postgres <c>date</c> as Npgsql hands it back (DateOnly, or DateTime on older mappings).</summary>
    public static DateOnly AsDate(object? value) => value switch
    {
        DateOnly d => d,
        DateTime dt => DateOnly.FromDateTime(dt),
        _ => throw new InvalidCastException($"not a date: {value ?? "NULL"}"),
    };

    private static readonly Regex DateTimePattern = new(
        @"(?<![0-9])\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?<offset>Z|[+-]\d{2}(?::?\d{2})?)?",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Every date-TIME value in a row's text rendering, as UTC: the columns Postgres renders
    /// (snapshots run with session TimeZone = UTC, so <c>2026-03-10 06:30:00+00</c>) AND any ISO
    /// instant embedded in a json/jsonb column (<c>2026-03-10T06:30:00Z</c>). A value with no offset
    /// (<c>timestamp without time zone</c>) is read as UTC. A bare date (no time of day) is not a
    /// date-time and is not returned — a planned item may legitimately be dated ahead.
    /// </summary>
    public static IEnumerable<DateTime> TimestampsIn(string row)
    {
        foreach (Match m in DateTimePattern.Matches(row))
        {
            var offset = m.Groups["offset"].Value;
            var body = m.Value[..(m.Value.Length - offset.Length)].Replace(' ', 'T');
            var normalisedOffset = offset switch
            {
                "" or "Z" => "+00:00",
                { Length: 3 } => offset + ":00",
                { Length: 5 } => offset[..3] + ":" + offset[3..],
                _ => offset,
            };
            yield return DateTimeOffset.Parse(body + normalisedOffset, System.Globalization.CultureInfo.InvariantCulture)
                .UtcDateTime;
        }
    }

    private sealed class FixedHostEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "AgriSync.Bootstrapper";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    public sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
