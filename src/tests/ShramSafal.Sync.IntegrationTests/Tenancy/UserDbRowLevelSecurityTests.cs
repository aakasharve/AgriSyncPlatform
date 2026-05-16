// spec: data-principle-spine-2026-05-05/03.6
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 03 Sub-phase 03.6 — UserDb
/// Row-Level Security integration tests. Parallel to
/// <see cref="RowLevelSecurityTests"/> from 03.4 but exercises the
/// User bounded context (<c>public.memberships</c>) under the same
/// claim → GUC → policy chain plus the 03.6 third GUC
/// <c>agrisync.user_id</c>.
///
/// <para>
/// <b>Test surface (per brief R1):</b>
/// <list type="number">
/// <item><b>User A cannot read User B's memberships</b> — RLS policy
/// <c>p_user_memberships</c> filters by
/// <c>user_id = current_setting('agrisync.user_id', true)::uuid</c>.
/// Querying under User A's claim must return zero rows belonging to
/// User B.</item>
/// <item><b>User A CAN read User A's own memberships</b> — count
/// matches seed (two memberships per user).</item>
/// <item><b>No-claim throws fail-closed</b> — querying without
/// <c>SetTenant</c> hits the
/// <see cref="TenantConnectionInterceptor"/>'s fail-closed guard.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Docker gate.</b> Mirrors <see cref="RowLevelSecurityTests"/>:
/// <c>[Collection("RequiresDocker")]</c> +
/// <c>[Trait("Category","RequiresDocker")]</c>. Local Docker-less
/// environments skip; CI integration sweep runs them.
/// </para>
///
/// <para>
/// <b>Transaction scoping.</b> Same Postgres GUC scoping rule as 03.4
/// — <c>set_config(name, value, true)</c> is transaction-scoped, so
/// every test wraps its query in <c>BeginTransactionAsync</c>. The
/// 03.6 <see cref="TenantTransactionMiddleware"/> update that opens
/// per-context transactions reproduces this in production; the test
/// helper mirrors that.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class UserDbRowLevelSecurityTests : IAsyncLifetime
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
    private Guid _userA;
    private Guid _userB;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();

        // Apply both User and Accounts migration chains. The User chain
        // includes the new 20260516150000_EnableUserDbRowLevelSecurity
        // migration; Accounts is included for parity with
        // RowLevelSecurityTests' migration sequencing.
        await ApplyMigrationsAsync(conn);

        // Seed two users + two memberships per user.
        _userA = Guid.NewGuid();
        _userB = Guid.NewGuid();

        await using (var raw = new NpgsqlConnection(conn))
        {
            await raw.OpenAsync();
            await SeedUserAsync(raw, _userA, phone: "+919999000001", displayName: "User A");
            await SeedUserAsync(raw, _userB, phone: "+919999000002", displayName: "User B");

            await SeedMembershipAsync(raw, Guid.NewGuid(), _userA, appId: "shramsafal");
            await SeedMembershipAsync(raw, Guid.NewGuid(), _userA, appId: "useradmin");
            await SeedMembershipAsync(raw, Guid.NewGuid(), _userB, appId: "shramsafal");
            await SeedMembershipAsync(raw, Guid.NewGuid(), _userB, appId: "useradmin");
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);

        // AddUserInfrastructure (03.6) attaches the
        // TenantConnectionInterceptor to UserDbContext and registers
        // TenantContext + TenantScopedDbContextRegistry. Adding the
        // ShramSafal infra too keeps the registry in sync with what
        // Program.cs would compose.
        services.AddUserInfrastructure(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        _rootProvider = services.BuildServiceProvider();
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
    // 1. RLS isolates User B's memberships from a User-A-claim query.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task User_A_cannot_read_User_B_memberships()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<UserDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        // Bind tenant claim — the third GUC (agrisync.user_id) is what
        // p_user_memberships keys on. FarmId/OwnerAccountId are required
        // by TenantContext.SetTenant's signature but are NOT what the
        // memberships policy filters by; use synthetic Guids.
        tenant.SetTenant(
            farmId: Guid.NewGuid(),
            ownerAccountId: Guid.NewGuid(),
            userId: _userA);

        await using var tx = await ctx.Database.BeginTransactionAsync();
        // Project to UserId only — avoids the obsolete AppMembership
        // type at the test boundary while still exercising the RLS gate.
        var rows = await ctx.Memberships
            .AsNoTracking()
            .Select(m => m.UserId)
            .ToListAsync();

        rows.Should().AllSatisfy(uid =>
            uid.Value.Should().Be(_userA,
                "RLS policy p_user_memberships must filter out User B's rows"));
        rows.Should().HaveCount(2,
            "User A was seeded with exactly two memberships");
    }

    // ────────────────────────────────────────────────────────────────────
    // 2. User A's own memberships remain visible under User A's claim.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task User_A_can_read_own_memberships()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<UserDbContext>();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();

        tenant.SetTenant(
            farmId: Guid.NewGuid(),
            ownerAccountId: Guid.NewGuid(),
            userId: _userA);

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var count = await ctx.Memberships.AsNoTracking().CountAsync();

        count.Should().Be(2,
            "User A's own memberships must remain visible under their own claim");
    }

    // ────────────────────────────────────────────────────────────────────
    // 3. No-claim query throws fail-closed via the interceptor.
    // ────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Query_without_tenant_claim_throws_fail_closed()
    {
        using var scope = _rootProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<UserDbContext>();
        // DO NOT call SetTenant.

        await using var tx = await ctx.Database.BeginTransactionAsync();
        Func<Task> act = async () => await ctx.Memberships.AsNoTracking().CountAsync();

        await act.Should().ThrowAsync<InvalidOperationException>(
            "TenantConnectionInterceptor must fail-closed on UserDbContext too — " +
            "any query with no claim and no admin elevation throws before SQL leaves the wire.");
    }

    // ────────────────────────────────────────────────────────────────────
    // Migration + seeding helpers.
    // ────────────────────────────────────────────────────────────────────

    private static async Task ApplyMigrationsAsync(string conn)
    {
        // Mirrors RowLevelSecurityTests.ApplyFullMigrationChainAsync (which
        // mirrors DwcScoreMatviewTests). The SSF migration
        // 20260422180547_AddAdminScopeHealthView references analytics.events,
        // so the chain MUST be:
        //   User → Accounts → SSF Phase-A (fence) → Analytics → SSF Phase-B
        // Without the Analytics interleave SSF Phase-B fails with
        // "relation analytics.events does not exist".

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
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(conn).Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            var migrator = ssf.Database.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(ssfPhaseATarget);
        }

        var analyticsOpts = new DbContextOptionsBuilder<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(
                    typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext.SchemaName);
            })
            .Options;
        await using (var analytics = new AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        // SSF Phase B — resume to head, now that analytics.events exists.
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }

        // Previous-month analytics partition (defensive, matches sibling fixture).
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

    private static async Task SeedUserAsync(NpgsqlConnection db, Guid userId, string phone, string displayName)
    {
        // public.users has owned PhoneNumber + Credential columns. The
        // EF entity uses `phone` for the value (HasMaxLength 12).
        // Minimum non-null columns to satisfy NOT NULL: display_name,
        // preferred_language (defaults to 'mr'), credential_*.
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO public.users (
                "Id", display_name, phone, password_hash, credential_created_at_utc,
                created_at_utc, auth_mode, is_active, preferred_language)
            VALUES (
                @id, @name, @phone, 'placeholder-hash', NOW(),
                NOW(), 0, true, 'mr');
            """;
        cmd.Parameters.AddWithValue("id", userId);
        cmd.Parameters.AddWithValue("name", displayName);
        cmd.Parameters.AddWithValue("phone", phone);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(NpgsqlConnection db, Guid id, Guid userId, string appId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO public.memberships (
                "Id", user_id, app_id, role, granted_at_utc, is_revoked)
            VALUES (
                @id, @uid, @app, 'PrimaryOwner', NOW(), false);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("uid", userId);
        cmd.Parameters.AddWithValue("app", appId);
        await cmd.ExecuteNonQueryAsync();
    }
}
