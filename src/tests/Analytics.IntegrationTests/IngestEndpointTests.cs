using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using AgriSync.Bootstrapper;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using Analytics.Application;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Analytics.IntegrationTests;

/// <summary>
/// Endpoint-level coverage for <c>POST /analytics/ingest</c> (DWC v2 §2.4).
/// Three scenarios per the plan:
/// </summary>
/// <list type="bullet">
/// <item><b>Valid batch → 202 Accepted</b> + every event lands in
///   <c>analytics.events</c> with the right shape (event type, server
///   clock timestamp, actor user id from the bearer claim).</item>
/// <item><b>Unknown event type → 400 BadRequest</b> + zero rows
///   persisted (vocabulary lockdown — the bus drops the batch on 400).</item>
/// <item><b>Unauthenticated → 401</b> via <c>RequireAuthorization()</c>;
///   the endpoint delegate must not even run.</item>
/// </list>
/// <remarks>
/// <para>
/// Uses EF InMemory for the analytics rail so the suite runs locally
/// without Postgres / Docker. The exact same pattern is already in
/// production use by <c>ShramSafal.Sync.IntegrationTests.SyncEndpointsTests</c>
/// (see <c>builder.Services.AddAnalytics(o =&gt; o.UseInMemoryDatabase(...))</c>
/// at line ~1546 of that file). The EF-level write path is covered
/// against real Postgres by <c>ShramSafal.Admin.IntegrationTests</c>;
/// duplicating that here would just slow down the CI lane that
/// matters — the endpoint contract.
/// </para>
/// <para>
/// The test harness ships TWO authentication schemes: an "Authenticated"
/// scheme that always succeeds with a fixed test user, and a "NoAuth"
/// scheme that returns <c>NoResult</c> so the auth middleware emits
/// 401. Tests pick which one to use via the harness factory.
/// </para>
/// </remarks>
public sealed class IngestEndpointTests
{
    private static readonly Guid TestUserId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    private static readonly Guid TestFarmId = Guid.Parse("d0000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task Valid_Batch_Returns_202_And_Persists_Every_Event()
    {
        await using var harness = await IngestTestHarness.CreateAsync(authenticated: true);

        var body = new
        {
            events = new object[]
            {
                new
                {
                    eventType = "closure.started",
                    props = new Dictionary<string, object?>
                    {
                        ["farmId"] = TestFarmId.ToString(),
                        ["method"] = "voice",
                        ["ts"] = 1746274800000,
                    },
                },
                new
                {
                    eventType = "proof.attached",
                    props = new Dictionary<string, object?>
                    {
                        ["farmId"] = TestFarmId.ToString(),
                        ["logId"] = Guid.NewGuid().ToString(),
                        ["type"] = "photo",
                    },
                },
            },
        };

        var response = await harness.Client.PostAsJsonAsync("/analytics/ingest", body);

        response.StatusCode.Should().Be(HttpStatusCode.Accepted,
            "valid batch must return 202 per DWC v2 §2.4 — the writer is failure-isolated, so even a downstream persistence problem must not surface as a 4xx/5xx");

        // Verify both rows landed via a fresh scope so we beat the EF
        // first-level cache.
        await using var scope = harness.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();
        var persisted = await ctx.Events.ToListAsync();
        persisted.Should().HaveCount(2);
        persisted.Select(e => e.EventType)
            .Should().BeEquivalentTo(new[] { "closure.started", "proof.attached" });

        // Actor stamping — every row must carry the user id from the bearer
        // claim so audit reviewers can answer "who emitted this event".
        persisted.Should().AllSatisfy(e =>
        {
            e.ActorUserId.Should().NotBeNull();
            e.ActorUserId!.Value.Value.Should().Be(TestUserId);
            e.ActorRole.Should().Be("user");
        });

        // FarmId lifts from the props bag to the dedicated column so per-farm
        // matview filters don't pay a JSONB cast.
        persisted.Should().AllSatisfy(e =>
        {
            e.FarmId.Should().NotBeNull();
            e.FarmId!.Value.Value.Should().Be(TestFarmId);
        });

        // Server clock — the handler uses IClock so the timestamp is the
        // server's view, not the device's. The fake clock pinned in the
        // harness stamps a known instant on every row.
        persisted.Should().AllSatisfy(e =>
            e.OccurredAtUtc.Should().Be(IngestTestHarness.FrozenServerTime));
    }

    [Fact]
    public async Task Unknown_EventType_Returns_400_And_Persists_Nothing()
    {
        await using var harness = await IngestTestHarness.CreateAsync(authenticated: true);

        var body = new
        {
            events = new object[]
            {
                new
                {
                    eventType = "closure.never_heard_of_it",
                    props = new Dictionary<string, object?>
                    {
                        ["farmId"] = TestFarmId.ToString(),
                    },
                },
            },
        };

        var response = await harness.Client.PostAsJsonAsync("/analytics/ingest", body);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "unknown event_type fails vocabulary validation; the bus drops the batch on 400 (no point retrying)");

        // The contract is "drop the entire batch on 400" — verify zero rows
        // landed, not just a count drop. Otherwise a partial-success bug
        // could go undetected if the fixture had a non-zero baseline.
        await using var scope = harness.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();
        var count = await ctx.Events.CountAsync();
        count.Should().Be(0,
            "validation failure must reject the whole batch — partial persistence would corrupt the matview-readable state");
    }

    [Fact]
    public async Task Unauthenticated_Request_Returns_401()
    {
        // The "NoAuth" scheme returns AuthenticateResult.NoResult so the
        // RequireAuthorization() middleware emits 401 before the endpoint
        // delegate runs — exactly the contract DWC v2 §2.4 specifies.
        await using var harness = await IngestTestHarness.CreateAsync(authenticated: false);

        var body = new
        {
            events = Array.Empty<object>(),
        };

        var response = await harness.Client.PostAsJsonAsync("/analytics/ingest", body);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "the bus only flushes when there's an active session; anonymous traffic here is misconfigured client or a probe — both get 401");
    }

    [Fact]
    public async Task Missing_Required_Prop_Returns_400_With_Validation_Code()
    {
        await using var harness = await IngestTestHarness.CreateAsync(authenticated: true);

        // closure.started requires { farmId, method, ts } — drop ts.
        var body = new
        {
            events = new object[]
            {
                new
                {
                    eventType = "closure.started",
                    props = new Dictionary<string, object?>
                    {
                        ["farmId"] = TestFarmId.ToString(),
                        ["method"] = "voice",
                    },
                },
            },
        };

        var response = await harness.Client.PostAsJsonAsync("/analytics/ingest", body);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // Body must surface the typed validation code so the bus can log it
        // before dropping the batch. Without this the bus has to guess what
        // happened, which makes drift between the two registries undebuggable.
        var problem = await response.Content.ReadFromJsonAsync<Dictionary<string, object?>>();
        problem.Should().NotBeNull();
        problem!.Should().ContainKey("error");
        problem["error"]!.ToString().Should().Be("analytics.missing_required_prop");
    }

    /// <summary>
    /// Self-hosted minimal app that wires <see cref="MapAnalyticsIngest"/>
    /// against EF InMemory and a configurable test auth scheme. Mirrors
    /// the shape of <c>SyncEndpointsTests.TestHarness</c> but trimmed
    /// down to only what /analytics/ingest needs (no ShramSafal, no
    /// outbox, no compliance signals).
    /// </summary>
    private sealed class IngestTestHarness(
        WebApplication app,
        HttpClient client) : IAsyncDisposable
    {
        public static readonly DateTime FrozenServerTime =
            new(2026, 5, 3, 10, 0, 0, DateTimeKind.Utc);

        public HttpClient Client { get; } = client;
        public IServiceProvider Services => app.Services;

        public static async Task<IngestTestHarness> CreateAsync(bool authenticated)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing",
            });

            builder.WebHost.UseTestServer();

            // One scheme + RequireAuthorization() is enough to drive the
            // contract; the "NoAuth" handler simply returns NoResult so the
            // auth middleware writes 401 before the endpoint delegate runs.
            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, ConfigurableAuthHandler>("Test", _ =>
                {
                });
            builder.Services.AddSingleton(new AuthBehavior(authenticated));
            builder.Services.AddAuthorization();

            // Logging — the handler uses ILogger<IngestEventsHandler>; without
            // ILoggerFactory in DI minimal-API binding throws at startup.
            builder.Services.AddLogging();

            // Analytics rail — InMemory keeps the suite Docker-free; the
            // failure-isolated AnalyticsWriter still runs against it, so the
            // failure-mode behavior matches production. Pin an explicit
            // InMemoryDatabaseRoot so DbContexts resolved in the request
            // scope and the test's verification scope share storage (the
            // default per-instance singleton root works in single-scope
            // scenarios but is fragile under TestServer's nested scopes).
            var dbName = $"analytics-ingest-tests-{Guid.NewGuid():N}";
            var dbRoot = new InMemoryDatabaseRoot();
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            // Frozen clock so the test can assert on the exact OccurredAtUtc
            // landed on each row — proves the handler resolves time via IClock,
            // not DateTime.UtcNow.
            builder.Services.AddSingleton<IClock>(new FrozenClock(FrozenServerTime));

            // The unit under test.
            builder.Services.AddAnalyticsApplication();

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapAnalyticsIngest();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new IngestTestHarness(app, client);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }

        private sealed record AuthBehavior(bool Authenticated);

        private sealed class ConfigurableAuthHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder,
            AuthBehavior behavior)
            : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
        {
            protected override Task<AuthenticateResult> HandleAuthenticateAsync()
            {
                if (!behavior.Authenticated)
                {
                    return Task.FromResult(AuthenticateResult.NoResult());
                }

                var identity = new ClaimsIdentity(new[]
                {
                    new Claim("sub", TestUserId.ToString()),
                }, Scheme.Name);
                var principal = new ClaimsPrincipal(identity);
                var ticket = new AuthenticationTicket(principal, Scheme.Name);
                return Task.FromResult(AuthenticateResult.Success(ticket));
            }
        }

        private sealed class FrozenClock(DateTime utcNow) : IClock
        {
            public DateTime UtcNow { get; } = utcNow;
        }
    }
}
