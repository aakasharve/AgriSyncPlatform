using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Endpoints;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ShramSafal.Api;
using ShramSafal.Infrastructure.Persistence;
using User.Api;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// T-IGH-05-ADMIN-TWO-ORGS-SEEDER — integration coverage.
/// Verifies that POST /__e2e/seed { "fixture": "admin_two_orgs" }
/// seeds 1 admin user, 2 orgs, 2 memberships, 2 farms, 2 farm-scopes
/// and returns 200 with the expected JSON shape. Also verifies
/// idempotency: a second call must not create duplicate rows.
/// </summary>
[Trait("Category", "AdminTwoOrgsSeeder")]
public sealed class AdminTwoOrgsSeederTests
{
    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Seed_AdminTwoOrgs_Returns200_WithExpectedJsonShape()
    {
        await using var harness = await AdminSeedHarness.CreateAsync();

        var response = await harness.Client.PostAsJsonAsync("/__e2e/seed", new { fixture = "admin_two_orgs" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.True(root.TryGetProperty("userId",   out var userId),   "response must have userId");
        Assert.True(root.TryGetProperty("phone",    out var phone),    "response must have phone");
        Assert.True(root.TryGetProperty("password", out var password), "response must have password");
        Assert.True(root.TryGetProperty("farmId",   out var farmId),   "response must have farmId");
        Assert.True(root.TryGetProperty("fixture",  out var fixture),  "response must have fixture");
        Assert.True(root.TryGetProperty("summary",  out _),            "response must have summary");

        Assert.Equal(E2eFixtureSeeder.AdminUserIdValue.ToString(), userId.GetString());
        Assert.Equal("8888888888",     phone.GetString());
        Assert.Equal("admin123",       password.GetString());
        Assert.Equal(E2eFixtureSeeder.FarmAId.ToString(), farmId.GetString());
        Assert.Equal("admin_two_orgs", fixture.GetString());
    }

    [Fact]
    public async Task Seed_AdminTwoOrgs_DbState_HasExpectedCounts()
    {
        await using var harness = await AdminSeedHarness.CreateAsync();

        await harness.Client.PostAsJsonAsync("/__e2e/seed", new { fixture = "admin_two_orgs" });

        await using var scope = harness.App.Services.CreateAsyncScope();
        var ssf  = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var user = scope.ServiceProvider.GetRequiredService<UserDbContext>();

        // 1 admin user
        var adminUser = await user.Users.FirstOrDefaultAsync(
            u => u.Id == new AgriSync.SharedKernel.Contracts.Ids.UserId(E2eFixtureSeeder.AdminUserIdValue));
        Assert.NotNull(adminUser);

        // 2 organisations
        var orgCount = await ssf.Organizations.CountAsync(
            o => o.Id == E2eFixtureSeeder.OrgAId || o.Id == E2eFixtureSeeder.OrgBId);
        Assert.Equal(2, orgCount);

        // 2 memberships
        var memCount = await ssf.OrganizationMemberships.CountAsync(
            m => m.Id == E2eFixtureSeeder.MembershipAId || m.Id == E2eFixtureSeeder.MembershipBId);
        Assert.Equal(2, memCount);

        // 2 farms — also assert OwnerAccountId is non-empty (schema invariant I5)
        var farmAKey = new AgriSync.SharedKernel.Contracts.Ids.FarmId(E2eFixtureSeeder.FarmAId);
        var farmBKey = new AgriSync.SharedKernel.Contracts.Ids.FarmId(E2eFixtureSeeder.FarmBId);
        var farmCount = await ssf.Farms.CountAsync(
            f => f.Id == farmAKey || f.Id == farmBKey);
        Assert.Equal(2, farmCount);

        var farmA = await ssf.Farms.FirstOrDefaultAsync(f => f.Id == farmAKey);
        var farmB = await ssf.Farms.FirstOrDefaultAsync(f => f.Id == farmBKey);
        Assert.NotNull(farmA);
        Assert.NotNull(farmB);
        Assert.False(farmA.OwnerAccountId.IsEmpty,
            "Farm A must have a non-empty OwnerAccountId (schema invariant I5)");
        Assert.False(farmB.OwnerAccountId.IsEmpty,
            "Farm B must have a non-empty OwnerAccountId (schema invariant I5)");
        Assert.Equal(new AgriSync.SharedKernel.Contracts.Ids.OwnerAccountId(E2eFixtureSeeder.OwnerAccountAIdValue),
            farmA.OwnerAccountId);
        Assert.Equal(new AgriSync.SharedKernel.Contracts.Ids.OwnerAccountId(E2eFixtureSeeder.OwnerAccountBIdValue),
            farmB.OwnerAccountId);

        // 2 farm-scopes
        var scopeCount = await ssf.OrganizationFarmScopes.CountAsync(
            s => s.Id == E2eFixtureSeeder.FarmScopeAId || s.Id == E2eFixtureSeeder.FarmScopeBId);
        Assert.Equal(2, scopeCount);
    }

    [Fact]
    public async Task Seed_AdminTwoOrgs_IsIdempotent_NoRowsAddedOnSecondCall()
    {
        await using var harness = await AdminSeedHarness.CreateAsync();

        // First seed
        var r1 = await harness.Client.PostAsJsonAsync("/__e2e/seed", new { fixture = "admin_two_orgs" });
        Assert.Equal(HttpStatusCode.OK, r1.StatusCode);

        // Second seed — must still return 200 and not throw
        var r2 = await harness.Client.PostAsJsonAsync("/__e2e/seed", new { fixture = "admin_two_orgs" });
        Assert.Equal(HttpStatusCode.OK, r2.StatusCode);

        // Counts must be identical after two calls
        await using var scope = harness.App.Services.CreateAsyncScope();
        var ssf  = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var user = scope.ServiceProvider.GetRequiredService<UserDbContext>();

        var userCount = await user.Users.CountAsync(
            u => u.Id == new AgriSync.SharedKernel.Contracts.Ids.UserId(E2eFixtureSeeder.AdminUserIdValue));
        Assert.Equal(1, userCount);

        var orgCount = await ssf.Organizations.CountAsync(
            o => o.Id == E2eFixtureSeeder.OrgAId || o.Id == E2eFixtureSeeder.OrgBId);
        Assert.Equal(2, orgCount);

        var memCount = await ssf.OrganizationMemberships.CountAsync(
            m => m.Id == E2eFixtureSeeder.MembershipAId || m.Id == E2eFixtureSeeder.MembershipBId);
        Assert.Equal(2, memCount);

        var farmAKey = new AgriSync.SharedKernel.Contracts.Ids.FarmId(E2eFixtureSeeder.FarmAId);
        var farmBKey = new AgriSync.SharedKernel.Contracts.Ids.FarmId(E2eFixtureSeeder.FarmBId);
        var farmCount = await ssf.Farms.CountAsync(
            f => f.Id == farmAKey || f.Id == farmBKey);
        Assert.Equal(2, farmCount);

        // After both calls OwnerAccountId must still be non-empty (invariant I5 survives idempotency)
        var farmA = await ssf.Farms.FirstOrDefaultAsync(f => f.Id == farmAKey);
        var farmB = await ssf.Farms.FirstOrDefaultAsync(f => f.Id == farmBKey);
        Assert.NotNull(farmA);
        Assert.NotNull(farmB);
        Assert.False(farmA.OwnerAccountId.IsEmpty,
            "Farm A OwnerAccountId must remain non-empty after idempotent re-seed");
        Assert.False(farmB.OwnerAccountId.IsEmpty,
            "Farm B OwnerAccountId must remain non-empty after idempotent re-seed");

        var scopeCount = await ssf.OrganizationFarmScopes.CountAsync(
            s => s.Id == E2eFixtureSeeder.FarmScopeAId || s.Id == E2eFixtureSeeder.FarmScopeBId);
        Assert.Equal(2, scopeCount);

        // Summary must say "already seeded"
        var body2 = await r2.Content.ReadAsStringAsync();
        using var doc2 = JsonDocument.Parse(body2);
        var summary2 = doc2.RootElement.GetProperty("summary").GetString() ?? "";
        Assert.Contains("already seeded", summary2, StringComparison.OrdinalIgnoreCase);
    }

    // -----------------------------------------------------------------------
    // Harness
    // -----------------------------------------------------------------------

    /// <summary>
    /// Minimal test server that stands up the E2e seed endpoints with
    /// in-memory databases for both ShramSafalDbContext and UserDbContext.
    /// Sets ALLOW_E2E_SEED=true for the lifetime of the harness then
    /// restores the previous value.
    /// </summary>
    private sealed class AdminSeedHarness(WebApplication app, HttpClient client, string? previousEnvValue)
        : IAsyncDisposable
    {
        public HttpClient  Client { get; } = client;
        public WebApplication App { get; } = app;

        public static async Task<AdminSeedHarness> CreateAsync()
        {
            // Gate the E2e endpoints on the env flag
            var previousEnvValue = Environment.GetEnvironmentVariable(
                E2eTestEndpoints.EnvFlag);
            Environment.SetEnvironmentVariable(E2eTestEndpoints.EnvFlag, "true");

            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();

            // Minimal configuration — connection strings are required by
            // AddUserApi + AddShramSafalApi registrations even though we
            // override the DbContextOptions below.
            builder.Configuration.AddInMemoryCollection(
                new System.Collections.Generic.Dictionary<string, string?>
                {
                    ["ConnectionStrings:UserDb"]       = "Host=localhost;Database=test",
                    ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Database=test",
                    ["ShramSafal:Storage:DataDirectory"] = System.IO.Path.Combine(
                        System.IO.Path.GetTempPath(), "agrisync-admin-seed-tests", Guid.NewGuid().ToString("N")),
                });

            builder.Services.AddBuildingBlocks();
            builder.Services.AddAnalytics(opts =>
                opts.UseInMemoryDatabase($"admin-seed-analytics-{Guid.NewGuid()}"));

            // ShramSafal + User APIs (register real services — DbContext is overridden next)
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.AddUserApi(builder.Configuration);

            // Override ShramSafalDbContext → InMemory
            var ssfDbName  = $"admin-seed-ssf-{Guid.NewGuid()}";
            var userDbName = $"admin-seed-user-{Guid.NewGuid()}";
            var ssfDbRoot  = new InMemoryDatabaseRoot();
            var userDbRoot = new InMemoryDatabaseRoot();

            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.AddDbContext<ShramSafalDbContext>((sp, options) =>
            {
                options.UseInMemoryDatabase(ssfDbName, ssfDbRoot);
                var saveSide = sp.GetService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>();
                var txSide   = sp.GetService<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>();
                if (saveSide is not null && txSide is not null)
                {
                    options.AddInterceptors(saveSide, txSide);
                }
            });

            // Override UserDbContext → InMemory
            builder.Services.RemoveAll<DbContextOptions<UserDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<UserDbContext>>();
            builder.Services.AddDbContext<UserDbContext>((sp, options) =>
            {
                options.UseInMemoryDatabase(userDbName, userDbRoot);
                var saveSide = sp.GetService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>();
                var txSide   = sp.GetService<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>();
                if (saveSide is not null && txSide is not null)
                {
                    options.AddInterceptors(saveSide, txSide);
                }
            });

            // Register E2e harness services (toggle + fixture seeder)
            builder.Services.AddSingleton<E2eFailPushesToggle>();
            builder.Services.AddTransient<E2eFixtureSeeder>();

            var app = builder.Build();
            // Map only the E2e endpoints — no auth middleware required since
            // E2eTestEndpoints uses AllowAnonymous.
            app.MapE2eEndpoints();

            await app.StartAsync();
            var client = app.GetTestClient();

            return new AdminSeedHarness(app, client, previousEnvValue);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await App.StopAsync();
            await App.DisposeAsync();
            // Restore the env flag to whatever it was before the test
            Environment.SetEnvironmentVariable(
                E2eTestEndpoints.EnvFlag,
                previousEnvValue);
        }
    }
}
