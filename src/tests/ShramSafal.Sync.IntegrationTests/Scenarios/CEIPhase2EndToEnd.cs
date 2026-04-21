using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
using ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Scenarios;

/// <summary>
/// CEI Phase 2 §4.5 end-to-end scenario — exercises the full test-stack
/// lifecycle across the HTTP surface:
/// <list type="number">
///   <item>Ramu (PrimaryOwner) owns the farm.</item>
///   <item>Sushma (Agronomist) is a farm member.</item>
///   <item>Sushma creates a Grape Soil Basic <c>TestProtocol</c>.</item>
///   <item>Scheduler materialises <c>TestInstance</c>s for the crop cycle.</item>
///   <item><c>MarkOverdueInstancesHandler</c> transitions a past-due instance to Overdue.</item>
///   <item>Ramu's Attention Board surfaces the farm with <c>missingTestCount &gt;= 1</c>.</item>
///   <item>Vikram (LabOperator) marks the Soil Basic test Collected.</item>
///   <item>Vikram reports pH=5.5 with a finalised attachment — the
///       <c>soil.ph.low.apply-lime</c> recommendation is raised.</item>
///   <item>The instance is visible as <c>Reported</c> in
///       <c>GET /test-instances?cropCycleId=…</c>.</item>
///   <item>The missing-test card for this plot disappears from the Attention Board.</item>
/// </list>
/// </summary>
public sealed class CEIPhase2EndToEnd
{
    // Stable user ids — mirror SyncEndpointsTests so failures are easy to grep.
    private static readonly Guid RamuUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid SushmaUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid VikramUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    [Fact]
    public async Task FullTestStackLifecycle_FromSchedule_ToReportedWithRecommendation()
    {
        await using var harness = await TestHarness.CreateAsync();

        // ------------------------------------------------------------- 1) Farm
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-cei2", "req-farm", farmId, "Ramu's Vineyard");

        // ------------------------------------------------ 2) Farm memberships
        // Ramu is already owner via create_farm. Sushma (Agronomist) and
        // Vikram (LabOperator) are seeded directly — this keeps the scenario
        // focused on the test stack, not the invite/QR flow.
        await harness.SeedFarmMembershipAsync(farmId, SushmaUserId, AppRole.Agronomist);
        await harness.SeedFarmMembershipAsync(farmId, VikramUserId, AppRole.LabOperator);

        // -------------------------- plot + crop cycle pushed as Ramu (owner)
        var pushPlotAndCycle = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-cei2",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId,
                        farmId,
                        name = "North Block",
                        areaInAcres = 2m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId,
                        farmId,
                        plotId,
                        cropName = "Grapes",
                        stage = "Fruiting",
                        startDate = "2026-01-01",
                        endDate = "2026-06-30"
                    }
                }
            }
        });
        pushPlotAndCycle.EnsureSuccessStatusCode();

        // -------------------------------- 3) Sushma creates a TestProtocol
        using var createProtocolRequest = CreateJsonRequest(
            HttpMethod.Post,
            "/shramsafal/test-protocols",
            new
            {
                name = "Grape Soil Basic",
                cropType = "Grapes",
                kind = (int)TestProtocolKind.Soil,
                periodicity = (int)TestProtocolPeriodicity.PerStage,
                everyNDays = (int?)null,
                stageNames = new[] { "Fruiting", "Harvest" },
                parameterCodes = new[] { "pH" }
            },
            SushmaUserId,
            "shramsafal:Agronomist");

        var createProtocolResponse = await harness.Client.SendAsync(createProtocolRequest);
        createProtocolResponse.StatusCode.Should().Be(HttpStatusCode.Created,
            "Agronomist is allowed to create test protocols (CEI §4.5)");

        // --------------------- 4) Ramu schedules TestInstances for the cycle
        // Two stages: the first is deep in the past (so MarkOverdueInstancesHandler
        // has a candidate to flip to Overdue), the second is today (so Vikram
        // has a Due instance to collect — the FSM forbids Overdue → Collected,
        // so we keep one instance in each bucket).
        var todayOnly = DateOnly.FromDateTime(DateTime.UtcNow);
        using var scheduleRequest = CreateJsonRequest(
            HttpMethod.Post,
            "/shramsafal/test-instances/schedule-from-plan",
            new
            {
                cropCycleId,
                farmId,
                plotId,
                cropType = "Grapes",
                stages = new object[]
                {
                    new
                    {
                        stageName = "Fruiting",
                        startDate = "2026-01-02",   // past — will go Overdue
                        endDate = "2026-01-31"
                    },
                    new
                    {
                        stageName = "Harvest",
                        startDate = todayOnly.ToString("yyyy-MM-dd"),
                        endDate = todayOnly.AddDays(30).ToString("yyyy-MM-dd")
                    }
                }
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var scheduleResponse = await harness.Client.SendAsync(scheduleRequest);
        scheduleResponse.EnsureSuccessStatusCode();

        using (var scheduleDoc = JsonDocument.Parse(await scheduleResponse.Content.ReadAsStringAsync()))
        {
            scheduleDoc.RootElement.GetProperty("scheduledCount").GetInt32().Should().BeGreaterThanOrEqualTo(1,
                "at least one TestInstance must be materialised from the Grape Soil Basic protocol");
        }

        // -------------------------------- Discover the scheduled instance id
        using var listInstancesRequest = CreateRequest(
            HttpMethod.Get,
            $"/shramsafal/test-instances?cropCycleId={cropCycleId}",
            RamuUserId,
            "shramsafal:PrimaryOwner");
        var listInstancesResponse = await harness.Client.SendAsync(listInstancesRequest);
        listInstancesResponse.EnsureSuccessStatusCode();

        // Expect at least two instances scheduled — one for the past stage,
        // one for the current stage. We'll flip the past one to Overdue via
        // the sweeper and collect/report the still-Due one.
        Guid overdueInstanceId;
        Guid dueInstanceId;
        using (var listDoc = JsonDocument.Parse(await listInstancesResponse.Content.ReadAsStringAsync()))
        {
            var instances = listDoc.RootElement.EnumerateArray().ToList();
            instances.Should().HaveCountGreaterThanOrEqualTo(2,
                "Grape Soil Basic (PerStage) must materialise one TestInstance per scheduled stage");

            var past = instances
                .First(i => i.GetProperty("plannedDueDate").GetString()!.StartsWith("2026-01"));
            overdueInstanceId = past.GetProperty("testInstanceId").GetGuid();

            var current = instances
                .First(i => i.GetProperty("testInstanceId").GetGuid() != overdueInstanceId);
            dueInstanceId = current.GetProperty("testInstanceId").GetGuid();

            past.GetProperty("status").GetString().Should().Be("Due",
                "instance should start in Due before the overdue sweeper runs");
        }

        // ----------- 5) Overdue sweep — flip the Due instance to Overdue
        // The scheduled due date (2026-01-02) is well in the past relative
        // to the IClock used by the harness (system clock, today >= 2026-04-21).
        await harness.RunOverdueSweepAsync();

        // ----------- 6) Attention board surfaces the missing test card
        using var attentionRequest = CreateRequest(
            HttpMethod.Get,
            "/shramsafal/attention",
            RamuUserId,
            "shramsafal:PrimaryOwner");
        var attentionResponse = await harness.Client.SendAsync(attentionRequest);
        attentionResponse.EnsureSuccessStatusCode();

        using (var attentionDoc = JsonDocument.Parse(await attentionResponse.Content.ReadAsStringAsync()))
        {
            var cards = attentionDoc.RootElement.GetProperty("cards").EnumerateArray().ToList();

            var cardForPlot = cards.FirstOrDefault(c => c.GetProperty("plotId").GetGuid() == plotId);
            cardForPlot.ValueKind.Should().NotBe(JsonValueKind.Undefined,
                "an attention card must exist for the plot while a test is overdue");

            var missingTestCount = cardForPlot.GetProperty("missingTestCount");
            missingTestCount.ValueKind.Should().Be(JsonValueKind.Number,
                "missingTestCount must be populated when at least one test is overdue");
            missingTestCount.GetInt32().Should().BeGreaterThanOrEqualTo(1,
                "at least one overdue test must surface on the attention board");
        }

        // ------------------------- 7) Vikram marks the Due test Collected
        // (the Overdue one must stay Overdue — the FSM forbids Overdue →
        // Collected; see TestInstance.MarkCollected.)
        using var collectRequest = CreateJsonRequest<object?>(
            HttpMethod.Post,
            $"/shramsafal/test-instances/{dueInstanceId}/collect",
            null,
            VikramUserId,
            "shramsafal:LabOperator");
        var collectResponse = await harness.Client.SendAsync(collectRequest);
        collectResponse.EnsureSuccessStatusCode();

        using (var collectDoc = JsonDocument.Parse(await collectResponse.Content.ReadAsStringAsync()))
        {
            collectDoc.RootElement.GetProperty("status").GetString().Should().Be("Collected",
                "LabOperator collection must advance the state to Collected (CEI §4.5 FSM)");
        }

        // --- 8) Vikram records pH=5.5 (<6.0 triggers soil.ph.low.apply-lime)
        // The domain guard only requires a non-empty attachment id; we use a
        // fresh Guid rather than spinning up the full attachment-finalization
        // flow (the integration plan explicitly permits this simplification).
        var attachmentId = Guid.NewGuid();

        using var reportRequest = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/test-instances/{dueInstanceId}/report",
            new
            {
                results = new[]
                {
                    new
                    {
                        parameterCode = "pH",
                        parameterValue = "5.5",
                        unit = "pH",
                        referenceRangeLow = (decimal?)6.0m,
                        referenceRangeHigh = (decimal?)7.5m
                    }
                },
                attachmentIds = new[] { attachmentId },
                clientCommandId = (string?)null
            },
            VikramUserId,
            "shramsafal:LabOperator");

        var reportResponse = await harness.Client.SendAsync(reportRequest);
        reportResponse.EnsureSuccessStatusCode();

        using (var reportDoc = JsonDocument.Parse(await reportResponse.Content.ReadAsStringAsync()))
        {
            reportDoc.RootElement.GetProperty("status").GetString().Should().Be("Reported",
                "recording the result must transition state to Reported");

            var recs = reportDoc.RootElement.GetProperty("recommendations").EnumerateArray().ToList();
            recs.Should().NotBeEmpty("pH=5.5 must trigger at least one recommendation");
            recs.Should().Contain(r => r.GetProperty("ruleCode").GetString() == "soil.ph.low.apply-lime",
                "soil.ph.low.apply-lime must fire for pH < 6.0 on a Soil protocol");
        }

        // --------------- 9) The instance is visible as Reported in the queue
        using var postReportListRequest = CreateRequest(
            HttpMethod.Get,
            $"/shramsafal/test-instances?cropCycleId={cropCycleId}",
            RamuUserId,
            "shramsafal:PrimaryOwner");
        var postReportListResponse = await harness.Client.SendAsync(postReportListRequest);
        postReportListResponse.EnsureSuccessStatusCode();

        using (var queueDoc = JsonDocument.Parse(await postReportListResponse.Content.ReadAsStringAsync()))
        {
            var reported = queueDoc.RootElement.EnumerateArray()
                .First(i => i.GetProperty("testInstanceId").GetGuid() == dueInstanceId);
            reported.GetProperty("status").GetString().Should().Be("Reported",
                "the instance must appear as Reported in the cycle queue");

            var overdue = queueDoc.RootElement.EnumerateArray()
                .First(i => i.GetProperty("testInstanceId").GetGuid() == overdueInstanceId);
            overdue.GetProperty("status").GetString().Should().Be("Overdue",
                "the past-dated instance must remain Overdue after the sweep (FSM: Overdue is terminal until Waived)");
        }

        // Ramu waives the stale past-stage Overdue instance (PrimaryOwner is
        // an authorised waiver per the FSM — Due/Overdue → Waived). This
        // clears the remaining missingTestCount so the attention board can
        // drop the card, matching the scenario's end-state: no missing test
        // cards remain for this plot once every outstanding instance is
        // resolved (Reported or Waived).
        using var waiveRequest = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/test-instances/{overdueInstanceId}/waive",
            new { reason = "superseded by current-stage protocol run" },
            RamuUserId,
            "shramsafal:PrimaryOwner");
        var waiveResponse = await harness.Client.SendAsync(waiveRequest);
        waiveResponse.EnsureSuccessStatusCode();

        // ------------ 10) Attention card for the plot no longer surfaces
        using var finalAttentionRequest = CreateRequest(
            HttpMethod.Get,
            "/shramsafal/attention",
            RamuUserId,
            "shramsafal:PrimaryOwner");
        var finalAttentionResponse = await harness.Client.SendAsync(finalAttentionRequest);
        finalAttentionResponse.EnsureSuccessStatusCode();

        using (var finalDoc = JsonDocument.Parse(await finalAttentionResponse.Content.ReadAsStringAsync()))
        {
            var cards = finalDoc.RootElement.GetProperty("cards").EnumerateArray().ToList();

            var cardForPlot = cards.FirstOrDefault(c => c.GetProperty("plotId").GetGuid() == plotId);

            // Either no card at all, or the card exists for another reason and
            // missingTestCount is null/zero — both are acceptable outcomes
            // because the test is no longer missing.
            if (cardForPlot.ValueKind != JsonValueKind.Undefined)
            {
                var mtc = cardForPlot.GetProperty("missingTestCount");
                if (mtc.ValueKind == JsonValueKind.Number)
                {
                    mtc.GetInt32().Should().Be(0,
                        "missingTestCount must drop to zero once every scheduled test is Reported");
                }
            }
        }
    }

    // ---------------------------------------------------------------------- helpers

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

    private static HttpRequestMessage CreateJsonRequest<T>(
        HttpMethod method,
        string uri,
        T body,
        Guid userId,
        string membershipClaim)
    {
        var request = CreateRequest(method, uri, userId, membershipClaim);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }
        return request;
    }

    private static HttpRequestMessage CreateRequest(
        HttpMethod method,
        string uri,
        Guid userId,
        string membershipClaim)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Add("X-Test-UserId", userId.ToString());
        request.Headers.Add("X-Test-Membership", membershipClaim);
        return request;
    }

    // -----------------------------------------------------------------------
    // Test harness (mirrors SyncEndpointsTests.TestHarness so the scenario is
    // self-contained and doesn't depend on xUnit collection fixtures).
    // -----------------------------------------------------------------------

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
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-cei2-e2e", Guid.NewGuid().ToString("N"));
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
                options.UseInMemoryDatabase($"cei2-e2e-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();
            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"cei2-e2e-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            // The production TestProtocolRepository uses Postgres ILike which
            // the EF InMemory provider cannot translate. Swap in a simple
            // InMemory-safe adapter that still goes through the EF DbContext
            // so CreateTestProtocolHandler's AddAsync path is exercised end-to-end.
            builder.Services.RemoveAll<ITestProtocolRepository>();
            builder.Services.AddScoped<ITestProtocolRepository, InMemoryTestProtocolRepository>();

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

        /// <summary>
        /// Invoke the <see cref="MarkOverdueInstancesHandler"/> directly — the
        /// test-stack overdue sweep is idempotent and pure against the current
        /// clock, so calling it once is sufficient to transition any
        /// <c>Due</c> instances whose planned due date is in the past.
        /// </summary>
        public async Task RunOverdueSweepAsync()
        {
            await using var scope = app.Services.CreateAsyncScope();
            var handler = scope.ServiceProvider.GetRequiredService<MarkOverdueInstancesHandler>();
            await handler.HandleAsync(new MarkOverdueInstancesCommand());
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

    /// <summary>
    /// InMemory-provider-safe <see cref="ITestProtocolRepository"/>. The
    /// production repository uses <c>EF.Functions.ILike</c> (Postgres only),
    /// which the InMemory provider cannot translate. This adapter keeps the
    /// same DbContext-backed semantics but swaps the ILike call for an
    /// ordinal case-insensitive equality in-memory.
    /// </summary>
    private sealed class InMemoryTestProtocolRepository(ShramSafalDbContext context) : ITestProtocolRepository
    {
        public async Task AddAsync(TestProtocol protocol, CancellationToken ct = default)
        {
            ArgumentNullException.ThrowIfNull(protocol);
            await context.TestProtocols.AddAsync(protocol, ct);
            await context.SaveChangesAsync(ct);
        }

        public async Task<TestProtocol?> GetByIdAsync(Guid protocolId, CancellationToken ct = default)
        {
            if (protocolId == Guid.Empty) return null;
            return await context.TestProtocols.FindAsync([protocolId], ct);
        }

        public async Task<IReadOnlyList<TestProtocol>> GetByCropTypeAsync(string cropType, CancellationToken ct = default)
        {
            var trimmed = cropType?.Trim() ?? string.Empty;
            var all = await context.TestProtocols.ToListAsync(ct);
            return all
                .Where(p => string.Equals(p.CropType, trimmed, StringComparison.OrdinalIgnoreCase))
                .ToList();
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
                : RamuUserId;

            var membership = Request.Headers.TryGetValue("X-Test-Membership", out var membershipHeader)
                ? membershipHeader.ToString()
                : "shramsafal:PrimaryOwner";

            var claims = new List<Claim>
            {
                new("sub", userId.ToString())
            };
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
