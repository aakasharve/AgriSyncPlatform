using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
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
using static ShramSafal.Application.Ports.IEntitlementPolicy;
using ShramSafal.Domain.Compliance;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Scenarios;

/// <summary>
/// CEI Phase 3 §4.6 end-to-end scenario.
/// Exercises the compliance engine lifecycle:
/// 1. Farm + 4 planned activities not executed (missed tasks week rule triggers).
/// 2. <c>EvaluateComplianceHandler</c> runs → NeedsAttention signal opens.
/// 3. Ramu resolves the signal with a note → resolved, IsOpen = false.
/// 4. Evaluator runs again → NEW signal opens (condition still holds).
/// </summary>
public sealed class CEIPhase3EndToEnd
{
    private static readonly Guid RamuUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task ComplianceSignal_MissedTasksRule_FullLifecycle()
    {
        await using var harness = await TestHarness.CreateAsync();

        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var asOf = DateTime.UtcNow;

        // 1 — Create farm + plot + cycle via push sync
        var pushResult = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-cei3",
            mutations = new object[]
            {
                new { clientRequestId = "req-farm3", mutationType = "create_farm",
                    payload = new { farmId, name = "Ramu's Vineyard" } },
                new { clientRequestId = "req-plot3", mutationType = "create_plot",
                    payload = new { plotId, farmId, name = "East Block", areaInAcres = 2m } },
                new { clientRequestId = "req-cycle3", mutationType = "create_crop_cycle",
                    payload = new { cropCycleId, farmId, plotId, cropName = "Grapes",
                        stage = "Flowering", startDate = "2026-01-01", endDate = "2026-12-31" } }
            }
        });
        pushResult.EnsureSuccessStatusCode();

        // 2 — Seed 4 planned activities last week (no LogTasks → all missed → rule fires)
        await harness.SeedPlannedActivitiesAsync(farmId, plotId, cropCycleId, count: 4, asOf: asOf);

        // 3 — Trigger compliance evaluation via HTTP (POST /shramsafal/compliance/evaluate/{farmId})
        var evalResponse = await harness.Client.PostAsync($"/shramsafal/compliance/evaluate/{farmId}", null);
        evalResponse.StatusCode.Should().BeOneOf(new[]
        {
            System.Net.HttpStatusCode.Accepted,
            System.Net.HttpStatusCode.OK
        }, "EvaluateCompliance endpoint must return 200/202");

        // Give the async evaluation a moment (sync path in test uses InMemory so it completes quickly)
        await Task.Delay(200);

        // 4 — Signal must be persisted with correct severity + action (CEI-I6)
        await using var scope = harness.App.Services.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<IComplianceSignalRepository>();
        var signals = await repo.GetOpenForFarmAsync(new FarmId(farmId));

        signals.Should().Contain(s =>
            s.RuleCode == ComplianceRuleCode.MissedTaskThresholdWeek &&
            s.Severity == ComplianceSeverity.NeedsAttention &&
            s.SuggestedAction == ComplianceSuggestedAction.ScheduleMissingActivity,
            "MissedTaskThresholdWeek → NeedsAttention + ScheduleMissingActivity (CEI-I6)");

        var signal = signals.First(s => s.RuleCode == ComplianceRuleCode.MissedTaskThresholdWeek);
        signal.IsOpen.Should().BeTrue();

        // 5 — Resolve the signal with a note
        signal.Resolve(new UserId(RamuUserId), "I scheduled the 4 missed sprays for tomorrow.", asOf.AddMinutes(10));
        var dbContext = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await dbContext.SaveChangesAsync();

        signal.ResolvedAtUtc.Should().NotBeNull();
        signal.ResolutionNote.Should().Be("I scheduled the 4 missed sprays for tomorrow.");
        signal.IsOpen.Should().BeFalse();

        // 6 — Second evaluator run → new signal opens (condition still holds; resolved row is not blocked)
        var evalResponse2 = await harness.Client.PostAsync($"/shramsafal/compliance/evaluate/{farmId}", null);
        evalResponse2.StatusCode.Should().BeOneOf(new[]
        {
            System.Net.HttpStatusCode.Accepted,
            System.Net.HttpStatusCode.OK
        });
        await Task.Delay(200);

        await using var scope2 = harness.App.Services.CreateAsyncScope();
        var freshSignals = await scope2.ServiceProvider
            .GetRequiredService<IComplianceSignalRepository>()
            .GetOpenForFarmAsync(new FarmId(farmId));

        freshSignals.Should().Contain(s =>
            s.RuleCode == ComplianceRuleCode.MissedTaskThresholdWeek && s.IsOpen,
            "A fresh open signal must be present after the second evaluation run");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private sealed class TestHarness(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        // Expression-bodied properties reference the captured primary-ctor
        // fields directly; a `{ get; } = client` initializer would create a
        // second backing field for the same value (CS9124). The
        // `storageDir` parameter was never read — dropped per CS9113.
        public HttpClient Client => client;
        public WebApplication App => app;

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-cei3-e2e", Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDir
            });

            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase($"cei3-e2e-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"cei3-e2e-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            builder.Logging.SetMinimumLevel(LogLevel.Warning);

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Test",
                    $"{Guid.Parse("11111111-1111-1111-1111-111111111111")}|shramsafal:PrimaryOwner");

            return new TestHarness(app, client);
        }

        public async Task SeedPlannedActivitiesAsync(Guid farmId, Guid plotId, Guid cropCycleId, int count, DateTime asOf)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

            for (var i = 0; i < count; i++)
            {
                var activity = ShramSafal.Domain.Planning.PlannedActivity.CreateLocallyAdded(
                    Guid.NewGuid(), cropCycleId, $"Spraying_{i}", "Flowering",
                    DateOnly.FromDateTime(asOf.AddDays(-6 + i)),
                    new UserId(Guid.Parse("11111111-1111-1111-1111-111111111111")),
                    "missed activity", asOf.AddDays(-8));
                db.Set<ShramSafal.Domain.Planning.PlannedActivity>().Add(activity);
            }

            await db.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            await app.StopAsync();
            await app.DisposeAsync();
            client.Dispose();
        }
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(Allowed: true, EntitlementReason.Allowed, SubscriptionStatus: null));
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var userId = Guid.Parse("11111111-1111-1111-1111-111111111111");
            var membership = "shramsafal:PrimaryOwner";

            var claims = new List<Claim>
            {
                new("sub", userId.ToString()),
                new("membership", membership),
            };

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
