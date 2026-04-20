using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
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
using ShramSafal.Infrastructure.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Scenarios;

/// <summary>
/// CEI Phase 1 end-to-end scenario: deviation reason codes, pull sync shape, attention board field.
/// </summary>
public sealed class CEIPhase1EndToEnd
{
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    /// <summary>
    /// CEI-I4 / reference data: exactly 7 deviation reason codes are served by the API.
    /// </summary>
    [Fact]
    public async Task DeviationReasonCodes_Returns7Rows()
    {
        await using var harness = await TestHarness.CreateAsync();

        var resp = await harness.Client.GetAsync("/shramsafal/reference/deviation-reason-codes");

        resp.StatusCode.Should().Be(System.Net.HttpStatusCode.OK,
            "deviation-reason-codes endpoint must be reachable without auth");

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        doc.RootElement.GetArrayLength().Should().Be(7,
            "7 deviation reason codes are defined in GetDeviationReasonCodesHandler: " +
            "weather.rain, weather.wind, input.unavailable, labour.absent, " +
            "instruction.changed, plant.stage.delayed, operator.other");
    }

    /// <summary>
    /// CEI-I5 / pull sync: the sync pull response always includes an attentionBoard field
    /// (may be null — computation is failure-isolated — but the key must be present).
    /// </summary>
    [Fact]
    public async Task PullSync_Response_IncludesAttentionBoardField()
    {
        await using var harness = await TestHarness.CreateAsync();

        var since = Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"));
        var resp = await harness.Client.GetAsync($"/sync/pull?since={since}");

        resp.IsSuccessStatusCode.Should().BeTrue(
            "pull sync must succeed even for a user with no data");

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());

        doc.RootElement.TryGetProperty("attentionBoard", out _).Should().BeTrue(
            "attentionBoard must always be present in pull response (CEI Phase 1 — may be null)");
    }

    // ---------------------------------------------------------------------------
    // Minimal self-contained test harness (mirrors SyncEndpointsTests.TestHarness)
    // ---------------------------------------------------------------------------

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
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-cei-tests", Guid.NewGuid().ToString("N"));
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
                options.UseInMemoryDatabase($"cei-tests-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();
            var dbName = $"cei-tests-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, new InMemoryDatabaseRoot()));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new TestHarness(app, client, storageDirectory);
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
                : TestUserId;

            var claims = new List<Claim>
            {
                new("sub", userId.ToString()),
                new("membership", "shramsafal:PrimaryOwner")
            };

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
