// spec: voice-tenant-claim-caller-farm-2026-06-08
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

/// <summary>
/// spec: voice-tenant-claim-caller-farm-2026-06-08 — proves the
/// <see cref="ICallerFarmTenantScope"/> isolation gate on a NON-superuser
/// <c>agrisync_app</c> connection (the only way to prove FORCE-RLS; a
/// local/CI superuser would vacuously pass every policy).
///
/// <para>
/// Mirrors the harness of
/// <see cref="RowLevelSecurityTests"/> verbatim — same pinned
/// <c>postgres:16-alpine</c> container, same User → Accounts → SSF-A →
/// Analytics → SSF-B migration chain (so the 03.3 FORCE-RLS migration +
/// the user-scoped SELECT policies are live), same <c>agrisync_app</c>
/// non-superuser connection string, and the same raw-SQL seed helpers.
/// </para>
///
/// <para>
/// <b>Surface:</b>
/// <list type="number">
/// <item><b>Member happy path</b> — a real owner calling
/// <c>EstablishForCallerAsync(theirFarm, theirUser)</c> gets
/// <see cref="AgriSync.BuildingBlocks.Results.Result.Success"/>; the
/// subsequent <c>db.Farms</c> read returns exactly that farm AND an
/// <c>ssf.ai_jobs</c> insert with that <c>farm_id</c> succeeds under the
/// <c>WITH CHECK (farm_id = agrisync.farm_id)</c> policy.</item>
/// <item><b>Foreign-farm denial</b> — a caller passing a farmId they are
/// NOT a member/owner of gets
/// <see cref="AgriSync.BuildingBlocks.Results.Result.Failure"/> tagged
/// <see cref="ShramSafalErrors.Forbidden"/>, AND no
/// <c>agrisync.farm_id</c> GUC was set (proves nothing about the foreign
/// farm leaks before the gate decides).</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Docker gate.</b> Same dual marker as the sibling RLS suite —
/// <c>[Collection("RequiresDocker")]</c> + <c>[Trait("Category","RequiresDocker")]</c>.
/// Local Docker-less envs skip; the GitHub Actions integration sweep runs them.
/// The user runs Postgres natively on :5433 for MVP and relies on CI for the
/// Testcontainers suites (feedback_avoid_docker_local_dev), so this test is
/// authored to run in CI, not on the founder's workstation.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class CallerFarmTenantScopeTests : IAsyncLifetime
{
#pragma warning disable CS0618 // Type or member is obsolete (parameterless PostgreSqlBuilder ctor)
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private Guid _farmA;
    private Guid _farmB;
    private Guid _ownerUserA;
    private Guid _ownerUserB;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();

        await ApplyFullMigrationChainAsync(conn);

        _farmA = Guid.NewGuid();
        _farmB = Guid.NewGuid();
        _ownerUserA = Guid.NewGuid();
        _ownerUserB = Guid.NewGuid();

        await using (var raw = new NpgsqlConnection(conn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, _farmA, _ownerUserA, "Farm A");
            await SeedFarmAsync(raw, _farmB, _ownerUserB, "Farm B");
        }

        // CRITICAL: connect as agrisync_app (the non-superuser role created by
        // 20260515090000_BootstrapDbRoles), NOT the testcontainer superuser.
        // Postgres ALWAYS bypasses RLS for superusers even under FORCE ROW
        // LEVEL SECURITY — a superuser connection would make this test
        // vacuously pass (membership confirmed for ANY farm, including the
        // foreign one). Only agrisync_app actually evaluates the user-scoped
        // SELECT policies that ARE the isolation gate.
        var appConn = BuildAppRoleConnectionString(conn);

        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = appConn,
                ["ConnectionStrings:UserDb"] = appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        _rootProvider = services.BuildServiceProvider();
    }

    private static string BuildAppRoleConnectionString(string superuserConn)
    {
        var builder = new NpgsqlConnectionStringBuilder(superuserConn)
        {
            Username = "agrisync_app",
            Password = "dev_app_change_me",
        };
        return builder.ConnectionString;
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }
        await _pg.DisposeAsync();
    }

    // ────────────────────────────────────────────────────────────────────
    // 1. Member happy path — owner of Farm A establishes scope, then reads
    //    Farm A AND writes an ai_job under the farm_id WITH CHECK policy.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Establish_for_owner_succeeds_and_enables_farm_read_and_ai_job_write()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var sut = scope.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>();

        // The scope service uses admin-elevate + tx-local set_config GUCs. Those
        // GUCs (is_local=true) live only inside an explicit transaction, exactly
        // like TenantTransactionMiddleware opens in production. Open one here so
        // the GUCs survive across the membership read, the farm read, and the
        // ai_jobs insert below.
        await using var tx = await ctx.Database.BeginTransactionAsync();

        var result = await sut.EstablishForCallerAsync(_farmA, _ownerUserA);

        result.IsSuccess.Should().BeTrue(
            "owner A owns Farm A, so the user-scoped membership read confirms membership and the scope is established");

        // Farm read now passes (was the RLS 500 victim before this fix).
        var farms = await ctx.Farms.AsNoTracking().ToListAsync();
        farms.Should().ContainSingle(f => f.Id.Value == _farmA,
            "with the agrisync.farm_id GUC set to Farm A, p_tenant_farms surfaces exactly Farm A");

        // ai_jobs WITH CHECK (farm_id = agrisync.farm_id) write passes for the
        // scoped farm. Insert via raw SQL on the same scoped connection.
        var inserted = await ctx.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version)
            VALUES (
                {Guid.NewGuid()}, {"caller-scope-test-job-a"}, 'ParseVoice', {_ownerUserA}, {_farmA}, 'Queued',
                '1.0.0', NOW(), 0, NOW(),
                'pre_spine', 'unknown', 'unknown')
            """);
        inserted.Should().Be(1,
            "the ai_jobs WITH CHECK (farm_id = agrisync.farm_id) passes because the scope set agrisync.farm_id to Farm A");

        await tx.CommitAsync();
    }

    // ────────────────────────────────────────────────────────────────────
    // 2. Foreign-farm denial — the SOLE authorization gate. Owner B asks for
    //    a scope on Farm A (not theirs) → Forbidden, and NO agrisync.farm_id
    //    GUC was set (nothing about the foreign farm leaks).
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Establish_for_foreign_farm_returns_forbidden_and_sets_no_farm_guc()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var sut = scope.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        // Owner B is NOT a member/owner of Farm A. The membership read runs
        // under owner B's own user-scoped policies, finds nothing, and the gate
        // denies BEFORE any farm_id GUC is set.
        var result = await sut.EstablishForCallerAsync(_farmA, _ownerUserB);

        result.IsSuccess.Should().BeFalse("owner B is not a member or owner of Farm A");
        result.Error.Should().Be(ShramSafalErrors.Forbidden,
            "the membership-validated gate is the sole authorization gate; a foreign farmId yields Forbidden");

        // Prove the FOREIGN farm's id was never established as the tenant scope
        // — the real isolation property. Step 3b sets an all-zeros sentinel
        // farm_id before the membership read (so the bare-cast p_tenant_*
        // policies don't throw 22P02 on an empty GUC); that sentinel matches no
        // real farm. The gate denies BEFORE step 6 overwrites it with a real
        // farm_id, so the foreign Farm A id never reaches the GUC.
        var farmGuc = await ctx.Database
            .SqlQuery<string>($"SELECT COALESCE(current_setting('agrisync.farm_id', true), '') AS \"Value\"")
            .SingleAsync();
        farmGuc.Should().NotBe(_farmA.ToString(),
            "on denial the foreign Farm A id must NEVER be established as the single-farm scope — nothing about Farm A leaks");
        farmGuc.Should().BeOneOf(string.Empty, Guid.Empty.ToString(),
            "on denial the farm_id GUC is at most the all-zeros sentinel (matches no farm), never a real farm id");

        await tx.CommitAsync();
    }

    // ────────────────────────────────────────────────────────────────────
    // 3. Empty farm_id GUC (the prod voice-parse 22P02 repro). The membership
    //    read touches ssf.farms / ssf.farm_memberships whose ORIGINAL
    //    p_tenant_* policies (20260516130000) bare-cast
    //    current_setting('agrisync.farm_id', true)::uuid (no NULLIF). On the
    //    prod voice-parse path that GUC is an empty string when the gate runs,
    //    so ''::uuid throws 22P02 and the request 500s before the gate can
    //    decide. The ORIGINAL tests missed this because a fresh container
    //    leaves the GUC genuinely UNSET (→ NULL → no error). This test seeds
    //    the GUC to '' to model prod. Without step 3b it throws 22P02; with it
    //    the owner gate succeeds.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Establish_for_owner_succeeds_even_when_farm_id_guc_is_empty_string()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var sut = scope.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>();
        var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        // Seed the prod precondition: agrisync.farm_id present but EMPTY (not
        // NULL) on this transaction. Elevate FIRST so the interceptor no-ops —
        // otherwise its fail-closed guard throws before we can seed the GUC;
        // EstablishForCallerAsync's own idempotent elevate is then a no-op.
        tenantContext.ElevateToAdminCrossTenant();
        await ctx.Database.ExecuteSqlRawAsync("SELECT set_config('agrisync.farm_id', '', true)");

        // Must NOT throw 22P02; must succeed for the real owner.
        var result = await sut.EstablishForCallerAsync(_farmA, _ownerUserA);

        result.IsSuccess.Should().BeTrue(
            "an empty agrisync.farm_id GUC must not crash the membership read — step 3b neutralises it to the all-zeros sentinel before reading ssf.farms / ssf.farm_memberships (regression: prod voice-parse 22P02)");

        var farms = await ctx.Farms.AsNoTracking().ToListAsync();
        farms.Should().ContainSingle(f => f.Id.Value == _farmA,
            "after the gate succeeds, step 6 sets the real farm_id and p_tenant_farms surfaces exactly Farm A");

        await tx.CommitAsync();
    }

    // ────────────────────────────────────────────────────────────────────
    // Migration chain + seeding helpers — mirror RowLevelSecurityTests.
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

    private static async Task SeedFarmAsync(NpgsqlConnection db, Guid farmId, Guid ownerUserId, string name)
    {
        // ssf.farms — quoted "Id" column; owner_account_id NOT NULL (reuse
        // ownerUserId as a stand-in account id, same as RowLevelSecurityTests).
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerUserId);
        await cmd.ExecuteNonQueryAsync();
    }
}
