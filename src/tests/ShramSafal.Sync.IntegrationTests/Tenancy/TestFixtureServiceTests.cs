// spec: test-fixture-service-runtime-2026-06-06
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Npgsql;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

/// <summary>
/// Task 3 (spec test-fixture-service-runtime-2026-06-06) — proves the
/// safety-critical claim of <see cref="TestFixtureService"/>: a runtime reset
/// is bounded STRICTLY to farms whose <c>owner_account_id</c> appears in the
/// configured allowlist. Rows belonging to any non-allowlisted owner survive.
///
/// <para>
/// <b>What this exercises.</b> The full public surface
/// <c>ResetFixtureAsync → GuardDestructive → ResetInternalAsync →
/// DeleteByAllowlistAsync</c>. The non-"purvesh-demo" fixture name routes the
/// reset into the generic allowlist-bounded delete (the deliverable of Task 3),
/// which is the path most likely to over-delete and therefore the one that
/// most needs a tenant-isolation proof.
/// </para>
///
/// <para>
/// <b>Why NOT the full Purvesh seeder for Arrange (arbiter note).</b>
/// <see cref="PurveshDemoSeeder.SeedPurveshDemoAsync"/> writes through the
/// interceptor-attached <see cref="ShramSafalDbContext"/> while setting NO
/// tenant claim, so <see cref="TenantConnectionInterceptor"/> fail-closed-throws
/// on its first SSF command unless the scope is admin-elevated; the create-farm
/// write path additionally hit the rows-affected desync that burned three prod
/// deploys. That graph is not safely reproducible without a local Docker run,
/// so this test takes the prompt-sanctioned fallback: it seeds via raw SQL
/// (mirroring RowLevelSecurityTests' helpers) and drives the generic
/// <c>DeleteByAllowlistAsync</c> branch directly. The allowlist boundary — the
/// actual safety guarantee — is fully covered.
/// The "purvesh-demo" branch (delegation to PurveshDemoSeeder.ClearPurveshDemoAsync,
/// itself unchanged prod code) is intentionally NOT exercised here — a faithful seed
/// requires the deferred RLS-safe-seeder; tracked under that follow-up.
/// </para>
///
/// <para>
/// <b>Connection identity.</b> The reset scope calls
/// <c>ElevateToAdminCrossTenant()</c> (so the interceptor emits no prelude and
/// does not fail-closed). The provider is pointed at the testcontainer
/// SUPERUSER connection, which Postgres bypasses RLS for even under
/// <c>FORCE ROW LEVEL SECURITY</c> — so the cross-tenant reads + ExecuteDelete
/// inside <c>DeleteByAllowlistAsync</c> actually see and remove rows. This
/// mirrors how the Bootstrapper runs seeders/clears at startup (Program.cs),
/// NOT the RLS-bound agrisync_app path used by RowLevelSecurityTests' query
/// assertions.
/// </para>
///
/// <para>
/// <b>Docker gate.</b> Both <c>[Collection("RequiresDocker")]</c> and
/// <c>[Trait("Category","RequiresDocker")]</c>, matching RowLevelSecurityTests.
/// Local Docker-less runs ERROR at <c>_pg.StartAsync()</c>; the GitHub Actions
/// integration sweep runs the real assertion.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class TestFixtureServiceTests : IAsyncLifetime
{
    // Allowlisted owner = Purvesh's deterministic v2 OwnerAccountId (...c2).
    private static readonly Guid AllowlistedOwner =
        Guid.Parse("00000000-0000-0000-0000-0000000000c2");

#pragma warning disable CS0618 // PostgreSqlBuilder() ctor obsolete in Testcontainers 4.x
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _provider = default!;
    private Guid _allowlistedFarm;
    private Guid _otherFarm;
    private Guid _allowlistedFarmLog;
    private Guid _otherFarmLog;
    private Guid _otherOwner;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();

        await ApplyFullMigrationChainAsync(conn);

        // ── Seed two farms via raw SQL (RLS-bypassing superuser conn) ────────
        // One owned by the allowlisted owner, one owned by a random owner.
        // Each gets one daily_log so the count assertions are unambiguous.
        _allowlistedFarm = Guid.NewGuid();
        _otherFarm = Guid.NewGuid();
        _otherOwner = Guid.NewGuid();
        _allowlistedFarmLog = Guid.NewGuid();
        _otherFarmLog = Guid.NewGuid();

        await using (var raw = new NpgsqlConnection(conn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, _allowlistedFarm, ownerUserId: Guid.NewGuid(), ownerAccountId: AllowlistedOwner, "Allowlisted Farm");
            await SeedFarmAsync(raw, _otherFarm, ownerUserId: Guid.NewGuid(), ownerAccountId: _otherOwner, "Other Farm");
            await InsertDailyLogAsync(raw, _allowlistedFarmLog, _allowlistedFarm, operatorId: Guid.NewGuid(), DateTime.UtcNow);
            await InsertDailyLogAsync(raw, _otherFarmLog, _otherFarm, operatorId: Guid.NewGuid(), DateTime.UtcNow);
        }

        // ── Minimal real DI graph for what ResetInternalAsync resolves ──────
        // The non-"purvesh-demo" branch needs only ShramSafalDbContext +
        // TenantContext (both supplied by AddShramSafalInfrastructure). Pointed
        // at the SUPERUSER conn so the admin-elevated cross-tenant delete sees
        // every tenant's rows (Postgres bypasses RLS for superusers).
        var services = new ServiceCollection();
        services.AddLogging();
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(cfg);
        services.AddShramSafalInfrastructure(cfg);

        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_provider is not null)
        {
            await _provider.DisposeAsync();
        }
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task Reset_deletes_only_allowlisted_owner_rows_and_leaves_other_farms_intact()
    {
        var env = new FakeHostEnvironment { EnvironmentName = Environments.Development };
        var opts = Options.Create(new TestFixtureOptions
        {
            AllowRuntimeReset = true,
            AllowRuntimeSeed = false,
            AllowedOwnerAccountIds = [AllowlistedOwner],
        });
        var svc = new TestFixtureService(
            env, opts, _provider,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<TestFixtureService>.Instance);

        // Act — non-"purvesh-demo" fixture routes to the generic
        // allowlist-bounded DeleteByAllowlistAsync path.
        var result = await svc.ResetFixtureAsync("blank-test-user");

        result.Action.Should().Be("reset");
        result.Summary.Should().Contain("1 allowlisted test farm",
            "exactly one farm is owned by the allowlisted owner");

        // Assert via a fresh superuser connection (RLS bypassed) so the
        // counts reflect actual table state, not a tenant-filtered view.
        await using var verify = new NpgsqlConnection(_pg.GetConnectionString());
        await verify.OpenAsync();

        (await CountDailyLogsForFarmAsync(verify, _allowlistedFarm)).Should().Be(0,
            "the allowlisted owner's farm logs must be deleted by the bounded reset");
        (await CountDailyLogsForFarmAsync(verify, _otherFarm)).Should().Be(1,
            "the non-allowlisted owner's farm log must be untouched — this is the safety boundary");
    }

    private static async Task<int> CountDailyLogsForFarmAsync(NpgsqlConnection db, Guid farmId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ssf.daily_logs WHERE farm_id = @fid";
        cmd.Parameters.AddWithValue("fid", farmId);
        var scalar = await cmd.ExecuteScalarAsync();
        return Convert.ToInt32(scalar);
    }

    private sealed class FakeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    // ────────────────────────────────────────────────────────────────────
    // Migration chain + seed helpers — mirror RowLevelSecurityTests verbatim
    // (same interleave: User → Accounts → SSF Phase-A → Analytics → SSF Phase-B).
    // ────────────────────────────────────────────────────────────────────

    private static async Task ApplyFullMigrationChainAsync(string conn)
    {
        var userOpts = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(conn).Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        const string ssfPhaseATarget = "20260421075311_AlterCostEntriesAddJobCardId";
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            var migrator = ssf.Database.GetService<IMigrator>();
            await migrator.MigrateAsync(ssfPhaseATarget);
        }

        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(
                    typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AnalyticsDbContext.SchemaName);
            })
            .Options;
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }

        await using var rawConn = new NpgsqlConnection(conn);
        await rawConn.OpenAsync();
        var prev = DateTimeOffset.UtcNow.AddMonths(-1);
        var curr = new DateTimeOffset(DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
        await using var ensurePartition = rawConn.CreateCommand();
        ensurePartition.CommandText = $"""
            CREATE TABLE IF NOT EXISTS analytics.events_y{prev.Year:D4}m{prev.Month:D2}
            PARTITION OF analytics.events
            FOR VALUES FROM ('{prev.Year:D4}-{prev.Month:D2}-01')
                        TO  ('{curr.Year:D4}-{curr.Month:D2}-01');
            """;
        await ensurePartition.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(
        NpgsqlConnection db, Guid farmId, Guid ownerUserId, Guid ownerAccountId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertDailyLogAsync(
        NpgsqlConnection db, Guid logId, Guid farmId, Guid operatorId, DateTime createdAtUtc)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc,
                                         source, model_version, prompt_version)
            VALUES (@id, @fid, @plot, @cycle, @op, @date, @created,
                    'pre_spine', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("plot", Guid.NewGuid());
        cmd.Parameters.AddWithValue("cycle", Guid.NewGuid());
        cmd.Parameters.AddWithValue("op", operatorId);
        cmd.Parameters.AddWithValue("date", createdAtUtc.Date);
        cmd.Parameters.AddWithValue("created", createdAtUtc);
        await cmd.ExecuteNonQueryAsync();
    }
}
