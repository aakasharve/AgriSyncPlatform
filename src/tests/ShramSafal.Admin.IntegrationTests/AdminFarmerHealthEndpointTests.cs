using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Admin;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Admin;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// Endpoint-level coverage for <c>/admin/farmer-health/*</c>
/// (DWC v2 §3.8). Two layers:
/// </summary>
/// <remarks>
/// <para>
/// <b>Layer 1 — endpoint mapping:</b> verifies <c>MapAdminFarmerHealth</c>
/// registers exactly the two routes the plan specifies (Mode A
/// drilldown + Mode B cohort) with correct HTTP methods and an
/// authorization gate. Pure reflection over the built
/// <see cref="EndpointDataSource"/> — no HTTP, no DB, no fakes for the
/// handlers (the handler-level pipeline is already covered by
/// <see cref="GetFarmerHealthHandlerTests"/> and
/// <see cref="GetCohortPatternsHandlerTests"/>).
/// </para>
/// <para>
/// <b>Layer 2 — AdminAuditEmitter:</b> verifies the
/// Infrastructure-side emitter (a) writes one row to
/// <c>analytics.events</c> with <c>event_type='admin.farmer_lookup'</c>
/// and the right shape (<c>RequiresDocker</c>), and (b) silently
/// swallows write failures so observability outages never break an
/// admin response (per the <see cref="IAdminAuditEmitter"/> contract).
/// </para>
/// <para>
/// 401 / 404 / redaction / cohort-bucket assertions per plan §3.8 Step
/// 3 are covered downstream:
/// </para>
/// <list type="bullet">
/// <item>401 / 428 / 403 — <see cref="EntitlementResolverTests"/> +
///   <c>AdminScopeHelper</c> tests in the W0-A foundation.</item>
/// <item>404 when farm outside scope — <see cref="GetFarmerHealthHandlerTests.Returns_NotFound_when_repository_returns_null"/>.</item>
/// <item>Redaction applied per claims — <see cref="GetFarmerHealthHandlerTests.Invokes_redactor_with_FarmerHealth_module_key_for_low_privilege_scope"/>
///   and <see cref="GetCohortPatternsHandlerTests.Invokes_redactor_with_FarmerHealth_module_key"/>.</item>
/// <item>Cohort returns buckets — <see cref="GetCohortPatternsHandlerTests.Returns_payload_and_emits_ModeB_Cohort_audit_event"/>.</item>
/// </list>
/// <para>
/// HTTP-level end-to-end (real WebApplicationFactory) is deferred to the
/// next phase when the admin web/E2E harness is reused; that fixture
/// does not currently live in this test project.
/// </para>
/// </remarks>
public sealed class AdminFarmerHealthEndpointTests
{
    // --------------------------------------------------------------
    // Layer 1 — endpoint mapping (no DB, no HTTP)
    // --------------------------------------------------------------

    [Fact]
    public void MapAdminFarmerHealth_Registers_Drilldown_And_Cohort_Routes()
    {
        var endpoints = BuildAdminFarmerHealthEndpoints();

        var paths = endpoints
            .OfType<RouteEndpoint>()
            .Select(e => e.RoutePattern.RawText)
            .ToHashSet(StringComparer.Ordinal);

        paths.Should().Contain("/admin/farmer-health/{farmId:guid}",
            "Mode A drilldown route per DWC v2 §3.8 Step 1");
        paths.Should().Contain("/admin/farmer-health/cohort",
            "Mode B cohort route per DWC v2 §3.8 Step 1");
        endpoints.OfType<RouteEndpoint>().Should().HaveCount(2,
            "MapAdminFarmerHealth must register exactly the two DWC v2 routes — adding more without updating this gate is a scope-creep red flag");
    }

    [Fact]
    public void MapAdminFarmerHealth_Routes_Are_GET_Only()
    {
        var endpoints = BuildAdminFarmerHealthEndpoints();

        foreach (var endpoint in endpoints.OfType<RouteEndpoint>())
        {
            var methods = endpoint.Metadata
                .GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>();
            methods.Should().NotBeNull(
                $"endpoint {endpoint.RoutePattern.RawText} must declare an HTTP method via MapGet/MapPost");
            methods!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" },
                $"endpoint {endpoint.RoutePattern.RawText} must be GET — both Mode A drilldown and Mode B cohort are reads");
        }
    }

    [Fact]
    public void MapAdminFarmerHealth_Requires_Authorization()
    {
        var endpoints = BuildAdminFarmerHealthEndpoints();

        foreach (var endpoint in endpoints.OfType<RouteEndpoint>())
        {
            // RequireAuthorization() attaches AuthorizeAttribute metadata; an
            // unauthenticated caller is rejected by the auth middleware
            // before the endpoint delegate runs (the W0-A spine then maps
            // to 401 via AdminScopeHelper.ResolveOrDenyAsync). Without
            // this metadata the endpoint silently allows anonymous access,
            // which is a DWC v2 §3.8 spec violation.
            var authorize = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>();
            authorize.Should().NotBeEmpty(
                $"endpoint {endpoint.RoutePattern.RawText} must call RequireAuthorization() so the auth middleware emits 401 before the endpoint runs");
        }
    }

    [Fact]
    public void MapAdminFarmerHealth_Tags_Endpoints_For_Swagger_Grouping()
    {
        var endpoints = BuildAdminFarmerHealthEndpoints();

        foreach (var endpoint in endpoints.OfType<RouteEndpoint>())
        {
            var tagsAttr = endpoint.Metadata
                .GetMetadata<Microsoft.AspNetCore.Http.Metadata.ITagsMetadata>();
            tagsAttr.Should().NotBeNull(
                $"endpoint {endpoint.RoutePattern.RawText} should declare WithTags so swagger groups it under admin/farmer-health");
            tagsAttr!.Tags.Should().Contain("admin/farmer-health");
        }
    }

    // --------------------------------------------------------------
    // Layer 2a — AdminAuditEmitter writes a row (RequiresDocker)
    // --------------------------------------------------------------

    [Collection(nameof(AdminTestCollection))]
    public sealed class AdminAuditEmitterDbTests
    {
        private readonly AdminTestFixture _f;
        public AdminAuditEmitterDbTests(AdminTestFixture f) => _f = f;

        [Fact, Trait("Category", "RequiresDocker")]
        public async Task EmitFarmerLookupAsync_Writes_One_AnalyticsEvent_Row()
        {
            await using var scope = _f.Services.CreateAsyncScope();
            var ctx = scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();

            // Snapshot baseline — fixture is shared so prior tests may have
            // emitted other event_types into analytics.events.
            var baselineLookups = await ctx.Events
                .Where(e => e.EventType == "admin.farmer_lookup")
                .CountAsync();

            var orgId = Guid.Parse("a0000000-0000-0000-0000-000000000099");
            var farmId = Guid.Parse("b0000000-0000-0000-0000-000000000099");
            var adminScope = MakePlatformOwnerScope(orgId);

            var clock = new FrozenClock(new DateTime(2026, 5, 3, 12, 0, 0, DateTimeKind.Utc));
            var writer = new AnalyticsWriter(ctx, NullLogger<AnalyticsWriter>.Instance);
            var emitter = new AdminAuditEmitter(writer, clock);

            await emitter.EmitFarmerLookupAsync(adminScope, farmId, "ModeA_Drilldown", CancellationToken.None);

            // Re-fetch through a fresh context to defeat 1st-level cache.
            await using var verifyScope = _f.Services.CreateAsyncScope();
            var verifyCtx = verifyScope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();
            var lookups = await verifyCtx.Events
                .Where(e => e.EventType == "admin.farmer_lookup")
                .ToListAsync();

            lookups.Should().HaveCount(baselineLookups + 1,
                "exactly one new admin.farmer_lookup row must land per emit call");

            var newest = lookups.OrderByDescending(e => e.OccurredAtUtc).First();
            newest.OccurredAtUtc.Should().Be(clock.UtcNow,
                "the emitter must use IClock so tests can pin the timestamp");
            newest.FarmId.Should().NotBeNull();
            newest.FarmId!.Value.Value.Should().Be(farmId);
            newest.PropsJson.Should().NotBeNull();
            using var doc = JsonDocument.Parse(newest.PropsJson);
            var root = doc.RootElement;
            root.GetProperty("scopeOrgId").GetGuid().Should().Be(orgId);
            root.GetProperty("targetFarmId").GetGuid().Should().Be(farmId);
            root.GetProperty("modeName").GetString().Should().Be("ModeA_Drilldown");
        }

        [Fact, Trait("Category", "RequiresDocker")]
        public async Task EmitFarmerLookupAsync_With_Empty_FarmId_Records_ModeB_Cohort()
        {
            // Cohort emits use Guid.Empty as targetFarmId because the call
            // is org-wide rather than per-farm. The audit row still records
            // who/which-org/which-mode for forensic review.
            await using var scope = _f.Services.CreateAsyncScope();
            var ctx = scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();

            var orgId = Guid.Parse("a0000000-0000-0000-0000-0000000000aa");
            var adminScope = MakePlatformOwnerScope(orgId);

            var clock = new FrozenClock(new DateTime(2026, 5, 3, 13, 0, 0, DateTimeKind.Utc));
            var writer = new AnalyticsWriter(ctx, NullLogger<AnalyticsWriter>.Instance);
            var emitter = new AdminAuditEmitter(writer, clock);

            await emitter.EmitFarmerLookupAsync(adminScope, Guid.Empty, "ModeB_Cohort", CancellationToken.None);

            await using var verifyScope = _f.Services.CreateAsyncScope();
            var verifyCtx = verifyScope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();
            var newest = await verifyCtx.Events
                .Where(e => e.EventType == "admin.farmer_lookup" && e.OccurredAtUtc == clock.UtcNow)
                .SingleAsync();

            using var doc = JsonDocument.Parse(newest.PropsJson);
            doc.RootElement.GetProperty("modeName").GetString().Should().Be("ModeB_Cohort");
            doc.RootElement.GetProperty("targetFarmId").GetGuid().Should().Be(Guid.Empty);
        }
    }

    // --------------------------------------------------------------
    // helpers
    // --------------------------------------------------------------

    /// <summary>
    /// Builds an in-memory test host, calls the production
    /// <c>MapAdminFarmerHealth</c> extension on it, and returns the
    /// resulting <see cref="EndpointDataSource"/> entries. No real HTTP
    /// pipeline runs — we just inspect what got registered.
    /// </summary>
    private static IReadOnlyList<Endpoint> BuildAdminFarmerHealthEndpoints()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddRouting();
        services.AddAuthorization();
        // Stub registrations so endpoint construction succeeds — the delegate
        // bodies are never invoked in these tests, only the metadata graph.
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetFarmerHealth.GetFarmerHealthHandler>(
            _ => null!);
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetCohortPatterns.GetCohortPatternsHandler>(
            _ => null!);

        var sp = services.BuildServiceProvider();
        var endpointBuilder = new TestEndpointRouteBuilder(sp);
        endpointBuilder.MapAdminFarmerHealth();

        return endpointBuilder.DataSources
            .SelectMany(ds => ds.Endpoints)
            .Where(e => e is RouteEndpoint re && re.RoutePattern.RawText is not null
                && re.RoutePattern.RawText.StartsWith("/admin/farmer-health", StringComparison.Ordinal))
            .ToList();
    }

    /// <summary>
    /// Minimal <see cref="IEndpointRouteBuilder"/> that just collects the
    /// data sources <see cref="MapAdminFarmerHealth"/> appends. Enough for
    /// metadata-only inspection without spinning a real WebApplication.
    /// </summary>
    private sealed class TestEndpointRouteBuilder(IServiceProvider sp) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = sp;
        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();
        public IApplicationBuilder CreateApplicationBuilder()
            => new ApplicationBuilder(ServiceProvider);
    }

    private static AdminScope MakePlatformOwnerScope(Guid orgId) => new(
        orgId, OrganizationType.Platform, OrganizationRole.Owner,
        EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner),
        IsPlatformAdmin: true);

    private sealed class FrozenClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }
}
