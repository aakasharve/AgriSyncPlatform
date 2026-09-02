// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
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
/// LABOUR_PHASE2 Phase 5 — a <b>real HTTP round trip</b> over the two new
/// routes (founder decision O-4).
///
/// <para><b>What this proves that nothing else in the phase does.</b> Every
/// other Phase 5 suite calls handlers directly. That leaves four things
/// completely unproven: the route TEMPLATES (a typo in
/// <c>labour-permissions</c> is invisible to a handler test), the DI wiring of
/// the pipeline-wrapped handler (a missing registration only fails at request
/// time), the request-body binding, and the <c>Error.Kind</c> → HTTP status
/// mapping — 403 for "may not", 409 for "that switch does not apply here". This
/// file is the wire contract the UI half will call, asserted at the wire.</para>
///
/// <para><b>Harness posture, copied from <c>LabourEndpointTests</c>.</b>
/// In-process <c>TestServer</c> + EF InMemory + an <c>X-Test-UserId</c> auth
/// scheme. Under a non-relational provider
/// <c>TenantConnectionInterceptor</c> never fires and
/// <c>CallerFarmTenantScope</c> no-ops by design, so what is exercised here is
/// the HTTP wiring plus the pipeline authorizer's owner check and each
/// handler's own defense-in-depth check — provider-agnostic, all of it. The
/// tenancy boundary itself is proven against real Postgres as
/// <c>agrisync_app</c> in <c>LabourCapabilityGrantRealPostgresTests</c>; this
/// file deliberately does not restate that claim.</para>
/// </summary>
public sealed class LabourPermissionEndpointTests
{
    private static readonly Guid OwnerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid MukadamUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CoOwnerUserId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    [Fact]
    public async Task Owner_grants_a_worker_over_HTTP_and_the_roster_read_reports_it()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-1", "req-perm-1", farmId, "Permission Farm");
        await harness.SeedFarmMembershipAsync(farmId, WorkerUserId, AppRole.Worker);

        var put = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{WorkerUserId}",
            new { canManageLabourRecords = true });

        var putBody = await put.Content.ReadAsStringAsync();
        Assert.True(put.IsSuccessStatusCode, putBody);

        using (var doc = JsonDocument.Parse(putBody))
        {
            Assert.Equal(WorkerUserId, doc.RootElement.GetProperty("userId").GetGuid());
            Assert.Equal("Worker", doc.RootElement.GetProperty("role").GetString());
            Assert.True(doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean());
            Assert.True(doc.RootElement.GetProperty("hasExplicitGrant").GetBoolean());
            Assert.Equal("ExplicitGrant", doc.RootElement.GetProperty("source").GetString());
            Assert.True(doc.RootElement.GetProperty("isGrantEditable").GetBoolean());
        }

        // The roster read must report the SAME thing — the switch and the list
        // disagreeing is the exact failure a farmer would see.
        var get = await harness.Client.GetAsync($"/shramsafal/farms/{farmId}/labour-permissions");
        var getBody = await get.Content.ReadAsStringAsync();
        Assert.True(get.IsSuccessStatusCode, getBody);

        using (var doc = JsonDocument.Parse(getBody))
        {
            var worker = FindMember(doc.RootElement, WorkerUserId);
            Assert.True(worker.GetProperty("canManageLabourRecords").GetBoolean());
            Assert.Equal("ExplicitGrant", worker.GetProperty("source").GetString());
        }

        // ...and revoking over HTTP puts it back.
        var revoke = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{WorkerUserId}",
            new { canManageLabourRecords = false });
        Assert.True(revoke.IsSuccessStatusCode, await revoke.Content.ReadAsStringAsync());

        using (var doc = JsonDocument.Parse(await revoke.Content.ReadAsStringAsync()))
        {
            Assert.False(doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean());
            Assert.Equal("NotGranted", doc.RootElement.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task A_member_who_is_not_an_owner_gets_403_from_both_routes()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-2", "req-perm-2", farmId, "Permission Farm 2");
        await harness.SeedFarmMembershipAsync(farmId, WorkerUserId, AppRole.Worker);
        await harness.SeedFarmMembershipAsync(farmId, MukadamUserId, AppRole.Mukadam);

        using var read = Request(HttpMethod.Get, $"/shramsafal/farms/{farmId}/labour-permissions", MukadamUserId);
        Assert.Equal(HttpStatusCode.Forbidden, (await harness.Client.SendAsync(read)).StatusCode);

        using var write = Request(
            HttpMethod.Put,
            $"/shramsafal/farms/{farmId}/labour-permissions/{WorkerUserId}",
            MukadamUserId,
            new { canManageLabourRecords = true });
        Assert.Equal(HttpStatusCode.Forbidden, (await harness.Client.SendAsync(write)).StatusCode);
    }

    [Fact]
    public async Task An_owner_targeting_themselves_gets_403()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-3", "req-perm-3", farmId, "Permission Farm 3");
        await harness.SeedFarmMembershipAsync(farmId, OwnerUserId, AppRole.PrimaryOwner);

        var response = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{OwnerUserId}",
            new { canManageLabourRecords = true });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// Inverted 2026-09-02 (D5): a Mukadam's switch is real at the wire now.
    /// The P5 409 survives for owner-tier only (pinned by the sibling fact
    /// below).
    /// </summary>
    [Fact]
    public async Task Switching_a_Mukadam_lands_and_the_roster_reports_an_editable_switch()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-4", "req-perm-4", farmId, "Permission Farm 4");
        await harness.SeedFarmMembershipAsync(farmId, MukadamUserId, AppRole.Mukadam);

        var response = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{MukadamUserId}",
            new { canManageLabourRecords = true });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.Equal("ExplicitGrant", doc.RootElement.GetProperty("source").GetString());

        var get = await harness.Client.GetAsync($"/shramsafal/farms/{farmId}/labour-permissions");
        using var roster = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
        var mukadam = FindMember(roster.RootElement, MukadamUserId);
        Assert.True(mukadam.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.True(mukadam.GetProperty("isGrantEditable").GetBoolean());
        Assert.Equal("ExplicitGrant", mukadam.GetProperty("source").GetString());
    }

    /// <summary>
    /// The P5 guard at the wire, owner-tier edition — the pin the inverted fact
    /// above may not lose. A 409 with a NAMED code is what lets the UI render
    /// those members as permanently-on instead of shipping a switch that
    /// silently does nothing.
    /// </summary>
    [Fact]
    public async Task Toggling_a_SecondaryOwner_gets_409_with_a_code_the_client_can_branch_on()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-5", "req-perm-5", farmId, "Permission Farm 5");
        await harness.SeedFarmMembershipAsync(farmId, CoOwnerUserId, AppRole.SecondaryOwner);

        var response = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{CoOwnerUserId}",
            new { canManageLabourRecords = false });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            "ShramSafal.LabourManagementCarriedByRole",
            doc.RootElement.GetProperty("error").GetString());

        // The roster still says the co-owner is allowed, and that the switch
        // must not be interactive.
        var get = await harness.Client.GetAsync($"/shramsafal/farms/{farmId}/labour-permissions");
        using var roster = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
        var coOwner = FindMember(roster.RootElement, CoOwnerUserId);
        Assert.True(coOwner.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.False(coOwner.GetProperty("isGrantEditable").GetBoolean());
        Assert.Equal("OwnerTier", coOwner.GetProperty("source").GetString());
    }

    /// <summary>
    /// R1 Task 2.2 — a duration-bounded grant (जबाबदारी with an end date)
    /// survives the wire in both directions: the PUT carries the expiry, the
    /// response reports the instant the server stored.
    /// </summary>
    [Fact]
    public async Task A_duration_bounded_grant_round_trips_through_the_wire()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-5", "req-perm-5", farmId, "Permission Farm 5");
        await harness.SeedFarmMembershipAsync(farmId, MukadamUserId, AppRole.Mukadam);

        var end = DateTime.UtcNow.AddDays(2);
        var response = await harness.Client.PutAsJsonAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{MukadamUserId}",
            new { canManageLabourRecords = true, labourGrantExpiresAtUtc = end });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean());
        Assert.Equal(end, doc.RootElement.GetProperty("labourGrantExpiresAtUtc").GetDateTime(),
            TimeSpan.FromSeconds(1));
    }

    /// <summary>
    /// Task 2.3 (review finding M2 from 2.2): the wire contract for
    /// <c>labourGrantExpiresAtUtc</c> is a UTC instant. An ISO string with an
    /// offset ("+05:30") or with no zone designator at all deserializes to
    /// <c>Kind=Local</c>/<c>Unspecified</c>, which Npgsql refuses on a
    /// timestamptz column as an unhandled 500 deep inside SaveChanges. The
    /// handler must refuse it cleanly as InvalidCommand before it can reach
    /// the store — a 4xx the client can branch on, never a 500.
    /// </summary>
    [Theory]
    [InlineData("2027-01-01T00:00:00+05:30")]
    [InlineData("2027-01-01T00:00:00")]
    public async Task An_expiry_that_is_not_a_UTC_instant_is_refused_as_InvalidCommand_never_a_500(
        string expiry)
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-perm-6", "req-perm-6", farmId, "Permission Farm 6");
        await harness.SeedFarmMembershipAsync(farmId, WorkerUserId, AppRole.Worker);

        var response = await harness.Client.PutAsync(
            $"/shramsafal/farms/{farmId}/labour-permissions/{WorkerUserId}",
            new StringContent(
                $"{{\"canManageLabourRecords\":true,\"labourGrantExpiresAtUtc\":\"{expiry}\"}}",
                Encoding.UTF8,
                "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ShramSafal.InvalidCommand", doc.RootElement.GetProperty("error").GetString());
    }

    // ─────────────────────────────────────────────────────────────────────────

    private static JsonElement FindMember(JsonElement roster, Guid userId)
    {
        Assert.Equal(JsonValueKind.Array, roster.ValueKind);
        foreach (var row in roster.EnumerateArray())
        {
            if (row.GetProperty("userId").GetGuid() == userId)
            {
                return row;
            }
        }

        Assert.Fail($"member {userId} is absent from the roster");
        return default;
    }

    private static HttpRequestMessage Request(
        HttpMethod method, string uri, Guid userId, object? body = null)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Add("X-Test-UserId", userId.ToString());
        request.Headers.Add("X-Test-Membership", "shramsafal:Worker");
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return request;
    }

    private static async Task PushCreateFarmAsync(
        HttpClient client, string deviceId, string requestId, Guid farmId, string name)
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
            var storageDirectory = Path.Combine(
                Path.GetTempPath(), "agrisync-labour-permission-tests", Guid.NewGuid().ToString("N"));
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
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase($"labour-permission-tests-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();

            // The entitlement override exists ONLY to unblock the /sync/push
            // create_farm seeding call. The routes under test take no
            // IEntitlementPolicy and must never take one — deciding who on your
            // own farm may correct a headcount is access control, not billing.
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"labour-permission-tests-{Guid.NewGuid()}";
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
