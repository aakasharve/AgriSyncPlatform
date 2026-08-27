using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence; // TenantContext
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// DFES (dfes-companion-2026-07-11) Phase 1 — proves the ONE locked aggregate read
/// (<c>GetDailyRichnessAggregatesForFarmAsync</c>) against REAL Postgres via the shared
/// Testcontainers pattern: filters to the caller's farm (RLS + the method's own Where)
/// and orders by local_date. Rows are seeded as superuser (bypasses RLS); the read runs
/// as agrisync_app under a tenant scope so the p_tenant policy applies.
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class DailyRichnessAggregateReadTests : IAsyncLifetime
{
#pragma warning disable CS0618 // parity with sibling tests
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test").WithUsername("test").WithPassword("test").Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private static readonly Guid FarmA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerA = Guid.Parse("1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a");

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);      // copied from ErasureWorkerAnonymizationTest
        await SeedAggregatesAsync(conn);               // superuser raw INSERT (below)

        var appConn = BuildAppRoleConnectionString(conn); // copied from ErasureWorkerAnonymizationTest
        var services = new ServiceCollection();
        services.AddLogging();
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = conn,
            ["ConnectionStrings:UserDb"] = appConn,
        }!).Build();
        services.AddSingleton<IConfiguration>(cfg);
        services.AddShramSafalInfrastructure(cfg);
        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    // Seed as superuser (bypasses RLS): 2 rows on FarmA (out-of-order dates) + 1 on FarmB.
    private static async Task SeedAggregatesAsync(string superuserConn)
    {
        await using var c = new NpgsqlConnection(superuserConn);
        await c.OpenAsync();
        async Task Ins(Guid farm, DateOnly d)
        {
            await using var cmd = c.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.daily_richness_aggregates
                  ("Id", farm_id, local_date, time_zone, day_classification,
                   has_work, has_meaningful_observation, has_learning, has_experiment_outcome,
                   has_disturbance, has_declared_no_work_reason, advances_streak, advances_bar,
                   shram_points_earned, reward_reasons, score_engine_version, components_json,
                   created_at_utc, updated_at_utc)
                VALUES (@id, @farm, @d, 'Asia/Kolkata', 'BasicWorkDay',
                   true, false, false, false, false, false, true, false,
                   5, '[]'::jsonb, 'dfes-test', '{}'::jsonb, NOW(), NOW());
                """;
            cmd.Parameters.AddWithValue("id", Guid.NewGuid());
            cmd.Parameters.AddWithValue("farm", farm);
            cmd.Parameters.AddWithValue("d", d);
            await cmd.ExecuteNonQueryAsync();
        }
        await Ins(FarmA, new DateOnly(2026, 7, 12));   // seed the LATER date first
        await Ins(FarmA, new DateOnly(2026, 7, 11));
        await Ins(FarmB, new DateOnly(2026, 7, 12));   // must NOT surface for FarmA
    }

    [Fact]
    public async Task GetDailyRichnessAggregatesForFarmAsync_returns_only_farm_rows_ordered_by_local_date()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        var repo = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();

        tenant.SetTenant(FarmA, ownerAccountId: OwnerA);
        await using var tx = await ctx.Database.BeginTransactionAsync();

        var rows = await repo.GetDailyRichnessAggregatesForFarmAsync(FarmA, CancellationToken.None);

        rows.Should().HaveCount(2, "only FarmA's two rows are visible under the tenant policy");
        rows[0].LocalDate.Should().Be(new DateOnly(2026, 7, 11));
        rows[1].LocalDate.Should().Be(new DateOnly(2026, 7, 12));
    }

    // ── Fixture helpers copied verbatim from
    //    Privacy/ErasureWorkerAnonymizationTest.cs ────────────────────────

    private static string BuildAppRoleConnectionString(string superuserConn)
    {
        var b = new NpgsqlConnectionStringBuilder(superuserConn)
        {
            Username = "agrisync_app",
            Password = "dev_app_change_me",
        };
        return b.ConnectionString;
    }

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
            .UseNpgsql(conn).Options;
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
    }
}
