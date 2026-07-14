// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Task 1.3 (spec: 2026-07-13-labour-attendance-approval-design) — endpoint-
/// level proof for <c>GET /shramsafal/farms/{farmId}/labour</c>: an
/// authenticated FARM MEMBER gets 200 + the <c>LabourDataDto</c> wire shape
/// (<c>people</c> + <c>dashboard</c>); a caller who is NOT a member of the
/// farm gets 403 with no farm data leaked.
///
/// <para>
/// <b>Authorization gate under test.</b> In production the SOLE gate is
/// <c>ICallerFarmTenantScope.EstablishForCallerAsync</c> (see
/// <c>LabourEndpoints.cs</c>). Under this harness's EF InMemory provider,
/// <c>CallerFarmTenantScope</c> no-ops (non-relational — see its own
/// docstring), so the effective gate exercised here is
/// <c>GetLabourDataHandler</c>'s own <c>GetUserRoleForFarmAsync</c> membership
/// check — the same provider-agnostic defense-in-depth check every other
/// CallerFarmTenantScope consumer's handler also runs. Real-Postgres RLS
/// coverage for the tenant-scope boundary itself lives in
/// <c>Security/RowLevelSecurityTests</c>; this file proves the HTTP
/// wiring + auth + Forbidden-mapping contract.
/// </para>
///
/// <para>
/// Mirrors <c>SyncEndpointsTests.TestHarness</c>'s InMemory-DbContext +
/// per-request <c>X-Test-UserId</c> auth-header pattern (NOT Testcontainers
/// — the Postgres money-consistency invariant is already covered by Task
/// 1.2's <c>GetLabourDataHandlerTests</c>).
/// </para>
/// </summary>
public sealed class LabourEndpointTests
{
    private static readonly Guid OwnerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid NonMemberUserId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    [Fact]
    public async Task Get_AsFarmMember_Returns200_WithPeopleAndDashboard()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-labour-1", "req-farm-labour-1", farmId, "Labour Endpoint Farm");
        await harness.SeedFarmMembershipAsync(farmId, WorkerUserId, AppRole.Worker);

        var response = await harness.Client.GetAsync($"/shramsafal/farms/{farmId}/labour");
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);

        using var doc = JsonDocument.Parse(body);
        var people = doc.RootElement.GetProperty("people");
        Assert.Equal(JsonValueKind.Array, people.ValueKind);
        Assert.Contains(people.EnumerateArray(), p => p.GetProperty("role").GetString() == "worker");

        var dashboard = doc.RootElement.GetProperty("dashboard");
        Assert.Equal(JsonValueKind.Object, dashboard.ValueKind);
        Assert.True(dashboard.TryGetProperty("money", out _));
    }

    [Fact]
    public async Task Get_AsNonMember_Returns403_AndLeaksNoFarmData()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-labour-2", "req-farm-labour-2", farmId, "Non-Member Farm");
        // NOTE: NonMemberUserId is deliberately NOT the farm's owner and is
        // NOT seeded as a member.

        using var request = CreateGetRequest($"/shramsafal/farms/{farmId}/labour", NonMemberUserId);
        var response = await harness.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ShramSafal.Forbidden", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Get_WithUnknownFarmId_Returns403_NotFound()
    {
        // No farm at all exists for this id — the caller cannot be a member
        // of a farm that was never created. Must behave identically to the
        // real non-member case (Forbidden), never leak a 404/500 that would
        // distinguish "exists but you're not a member" from "doesn't exist".
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();

        var response = await harness.Client.GetAsync($"/shramsafal/farms/{farmId}/labour");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static async Task PushCreateFarmAsync(
        HttpClient client,
        string deviceId,
        string requestId,
        Guid farmId,
        string name)
    {
        var response = await client.PostAsJsonAsync("/sync/push", new
        {
            deviceId,
            mutations = new[]
            {
                new
                {
                    clientRequestId = requestId,
                    mutationType = "create_farm",
                    payload = new { farmId, name }
                }
            }
        });

        response.EnsureSuccessStatusCode();
    }

    private static HttpRequestMessage CreateGetRequest(string uri, Guid userId)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Add("X-Test-UserId", userId.ToString());
        request.Headers.Add("X-Test-Membership", "shramsafal:Worker");
        return request;
    }

    private sealed class TestHarness(WebApplication app, HttpClient client, string storageDirectory) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-labour-tests", Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDirectory
            });

            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            // Analytics writer — sync-push handlers (create_farm) depend on
            // IAnalyticsWriter; give the harness an in-memory store so emits
            // flow through the real failure-isolated writer.
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase($"labour-tests-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            // Entitlement policy override — the real DefaultEntitlementPolicy
            // needs ISubscriptionReader (Accounts module), which this harness
            // doesn't stand up. GetLabourDataHandler itself has no
            // entitlement gate; this override only unblocks the /sync/push
            // create_farm seeding call used by every test below.
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"labour-tests-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new TestHarness(app, client, storageDirectory);
        }

        public async Task SeedFarmMembershipAsync(Guid farmId, Guid userId, AppRole role)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
            db.FarmMemberships.Add(FarmMembership.Create(
                Guid.NewGuid(),
                new FarmId(farmId),
                new UserId(userId),
                role,
                DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
            if (Directory.Exists(storageDirectory))
            {
                Directory.Delete(storageDirectory, recursive: true);
            }
        }
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var userId = Request.Headers.TryGetValue("X-Test-UserId", out var userIdHeader) &&
                         Guid.TryParse(userIdHeader, out var parsedUserId)
                ? parsedUserId
                : OwnerUserId;
            var membership = Request.Headers.TryGetValue("X-Test-Membership", out var membershipHeader)
                ? membershipHeader.ToString()
                : "shramsafal:PrimaryOwner";

            var claims = new List<Claim> { new("sub", userId.ToString()) };
            if (!string.IsNullOrWhiteSpace(membership))
            {
                claims.Add(new Claim("membership", membership));
            }

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    /// <summary>
    /// Integration-test stub bypassing the Slice 2 subscription gate — the
    /// Accounts module (ISubscriptionReader) is not stood up in this harness.
    /// </summary>
    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId,
            FarmId farmId,
            PaidFeature feature,
            CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(
                Allowed: true,
                EntitlementReason.Allowed,
                SubscriptionStatus: null));
    }
}
