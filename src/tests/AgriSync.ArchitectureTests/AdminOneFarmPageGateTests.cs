using System.Security.Claims;
using System.Text.Json;
using AgriSync.Bootstrapper;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmerHealth;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3 as rewritten by C21; amendment C13).
/// Written by the test-writer from the plan only.
///
/// <para>
/// <c>GET /admin/farmer-health/{farmId}</c> names a farm and its owner's phone, and platform analysts hold every read
/// module, so it is platform owners only: the module check, then the platform gate, refused with 403 before anything
/// is read or the audited factory opened (the factory lives in the repository, so "nothing opened" = the repository
/// was never asked). An unknown farm answers 404. No cache: each load opens the factory once. The gates live in the
/// route delegate, so these tests run it as <see cref="AdminFarmContactsGateTests"/> does: the production mapping on
/// a hand-made route builder, a fixed seat, the real handler over a repository that records what it was asked. No
/// web server, no database.
/// </para>
/// </summary>
public sealed class AdminOneFarmPageGateTests
{
    private const string OneFarmRoute = "/admin/farmer-health/{farmId:guid}";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2e03");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c2e03");
    private static readonly Guid Farm = Guid.Parse("c2e30000-0000-0000-0000-000000000001");

    [Fact]
    public async Task The_one_farm_page_refuses_a_non_platform_admin()
    {
        // A Platform Analyst holds every read module, the farmer-health module included, but is not a platform owner.
        var analyst = Seat(OrganizationType.Platform, OrganizationRole.Analyst, isPlatformAdmin: false);
        analyst.CanRead(ModuleKey.FarmerHealth).Should().BeTrue("this is the seat the case is about (C13)");

        var refused = await Ask(analyst, knownFarm: true);

        refused.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(refused.Body).Should().Be("admin_platform_only");
        refused.Repository.Calls.Should().BeEmpty("nothing is read and no factory opened for a refused caller");
        refused.Body.Should().NotContain("Fake One-Farm", "a refusal carries no part of the page");

        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        var fpoAnswer = await Ask(fpoOwner, knownFarm: true);
        fpoAnswer.Status.Should().Be(StatusCodes.Status403Forbidden);
        fpoAnswer.Repository.Calls.Should().BeEmpty();

        // The control: a platform owner is let in, the repository is asked once, naming the signed-in admin.
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);
        var ok = await Ask(owner, knownFarm: true);
        ok.Status.Should().Be(StatusCodes.Status200OK);
        ok.Repository.Calls.Should().Equal(new[] { (Farm, Admin) },
            "one read of this farm; the signed-in admin is named on the factory's audit row");
        ok.Body.Should().Contain("Fake One-Farm Farm");
    }

    [Fact]
    public async Task An_unknown_farm_answers_404_at_the_route()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        var answer = await Ask(owner, knownFarm: false);

        answer.Status.Should().Be(StatusCodes.Status404NotFound, "a farm id that does not exist answers 404, never a page of dashes");
        answer.Repository.Calls.Should().Equal(new[] { (Farm, Admin) });
    }

    [Fact]
    public void The_one_farm_page_is_not_cached()
    {
        HasOutputCache(OneFarmEndpoint()).Should().BeFalse("each load opens the audited factory once: no CacheOutput (C21)");

        // The control proves the check can see a cache: Suffering keeps CacheOutput("AdminLive") (Task 2).
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        var suffering = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == "/shramsafal/admin/farms/suffering");
        HasOutputCache(suffering).Should().BeTrue();
    }

    // ------------------------------------------------------------------
    // Harness (as AdminFarmContactsGateTests)
    // ------------------------------------------------------------------

    private static AdminScope Seat(OrganizationType type, OrganizationRole role, bool isPlatformAdmin) =>
        new(Org, type, role, EntitlementMatrix.For(type, role), IsPlatformAdmin: isPlatformAdmin);

    private static bool HasOutputCache(RouteEndpoint endpoint) =>
        endpoint.Metadata.Any(m => m is IOutputCachePolicy || m is OutputCacheAttribute);

    private static TestRouteBuilder NewRouteBuilder() =>
        new(new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

    private static RouteEndpoint OneFarmEndpoint()
    {
        var routes = NewRouteBuilder();
        routes.MapAdminFarmerHealth();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, OneFarmRoute, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the farmer-health routes must map exactly one {OneFarmRoute}");
        var methods = matches[0].Metadata.GetMetadata<HttpMethodMetadata>();
        methods.Should().NotBeNull();
        methods!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" }, "the route is a read");
        return matches[0];
    }

    private static async Task<Answer> Ask(AdminScope scope, bool knownFarm)
    {
        var endpoint = OneFarmEndpoint();
        var repository = new RecordingFarmerHealthRepository(knownFarm);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(
            new FixedSeatResolver(ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>())));
        services.AddSingleton(new GetFarmerHealthHandler(repository, new PassThroughRedactor(), new NoAuditEmitter()));

        var path = $"/admin/farmer-health/{Farm:D}";
        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = path },
            User = new ClaimsPrincipal(new ClaimsIdentity(
                new[] { new Claim("sub", Admin.ToString("D")) }, authenticationType: "Test")),
        };
        ctx.Request.RouteValues["farmId"] = Farm.ToString("D");

        ctx.SetEndpoint(endpoint);
        await endpoint.RequestDelegate!(ctx);
        await ctx.Response.Body.FlushAsync();

        ctx.Response.Body.Position = 0;
        using var streamReader = new StreamReader(ctx.Response.Body);
        var body = await streamReader.ReadToEndAsync();

        return new Answer(ctx.Response.StatusCode, body, repository);
    }

    private static string Code(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("code", out var code)
            ? code.GetString() ?? "(null)"
            : "(no code in the body)";
    }

    private sealed record Answer(int Status, string Body, RecordingFarmerHealthRepository Repository);

    private sealed class TestRouteBuilder(IServiceProvider services) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = services;

        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();

        public IApplicationBuilder CreateApplicationBuilder() => new ApplicationBuilder(ServiceProvider);
    }

    private sealed class RouteBuildingServices(IServiceProvider inner) : IServiceProvider, IServiceProviderIsService
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(IServiceProviderIsService) ? this : inner.GetService(serviceType);

        public bool IsService(Type serviceType) => serviceType.IsInterface || serviceType.IsClass;
    }

    private sealed class FixedSeatResolver(ResolveResult result) : IEntitlementResolver
    {
        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct) =>
            Task.FromResult(result);
    }

    private sealed class RecordingFarmerHealthRepository(bool knownFarm) : IAdminFarmerHealthRepository
    {
        public List<(Guid FarmId, Guid AdminUserId)> Calls { get; } = new();

        public Task<FarmerHealthDto?> GetAsync(Guid farmId, AdminScope scope, Guid adminUserId, CancellationToken ct = default)
        {
            Calls.Add((farmId, adminUserId));
            return Task.FromResult(knownFarm
                ? new FarmerHealthDto(
                    FarmId: farmId,
                    FarmerName: "Fake One-Farm Owner",
                    Phone: "0000000003",
                    Score: null,
                    Timeline: Array.Empty<FarmerHealthTimelineDto>(),
                    SyncState: null,
                    AiHealth: null,
                    Verifications: new FarmerHealthVerificationCountsDto(0, 0, 0, 0, 0),
                    WorkerSummary: Array.Empty<FarmerHealthWorkerSummaryDto>(),
                    FarmName: "Fake One-Farm Farm")
                : null);
        }
    }

    private sealed class PassThroughRedactor : IResponseRedactor
    {
        public T Redact<T>(T dto, AdminScope scope, string moduleKey) where T : class => dto;

        public IReadOnlyList<T> RedactMany<T>(IEnumerable<T> dtos, AdminScope scope, string moduleKey) where T : class =>
            dtos.ToList();
    }

    private sealed class NoAuditEmitter : IAdminAuditEmitter
    {
        public Task EmitFarmerLookupAsync(AdminScope scope, Guid targetFarmId, string modeName, CancellationToken ct = default) =>
            Task.CompletedTask;
    }
}
