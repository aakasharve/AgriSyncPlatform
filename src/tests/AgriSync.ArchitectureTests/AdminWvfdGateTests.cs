using System.Security.Claims;
using System.Text.Json;
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
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C33).
/// Written by the test-writer from the plan only.
///
/// <para>
/// <c>GET /shramsafal/admin/metrics/wvfd</c> reads every farm and opens the audited cross-farm factory, so it is
/// platform owners only: the module check (<c>metrics.nsm</c>), then <c>RequirePlatformAdminAsync</c>, refused with
/// 403 before anything is read. No <c>.CacheOutput</c>: each call is an honest live count. <c>GET
/// /shramsafal/admin/farms</c> answers a tier other than A to D with 400 <c>tier_invalid</c> and a refused tier filter
/// with 409, before or instead of a list. The gates live in the route delegates, so these tests run them as
/// <see cref="AdminSilentFarmsGateTests"/> does: the production mapping on a hand-made route builder, a fixed seat,
/// the real handlers over recording ports. No web server, no database.
/// </para>
/// </summary>
public sealed class AdminWvfdGateTests
{
    private const string WvfdRoute = "/shramsafal/admin/metrics/wvfd";
    private const string FarmsRoute = "/shramsafal/admin/farms";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2e06");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c2e06");

    /// <summary>06:30 UTC on Wed 18 Nov 2026 = 12:00 India time.</summary>
    private static readonly DateTime Now = new(2026, 11, 18, 6, 30, 0, DateTimeKind.Utc);

    [Fact]
    public async Task The_wvfd_route_refuses_a_non_platform_admin()
    {
        // A Platform Analyst and an FPO owner both hold the module; neither is a platform owner.
        var analyst = Seat(OrganizationType.Platform, OrganizationRole.Analyst, isPlatformAdmin: false);
        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        foreach (var (seat, name) in new[] { (analyst, "platform analyst"), (fpoOwner, "FPO owner") })
        {
            seat.CanRead(ModuleKey.MetricsNsm).Should().BeTrue($"the {name} holds the module; only the platform gate refuses");

            var refused = await Ask(seat, WvfdRoute, "?weeks=4");

            refused.Status.Should().Be(StatusCodes.Status403Forbidden, name);
            Code(refused.Body).Should().Be("admin_platform_only", name);
            refused.Ports.ReadAllCalls.Should().Be(0, $"{name}: no farm key is read, no audited factory opened");
            refused.Body.Should().NotContain("countedAtUtc", "a refusal carries no part of the answer");
        }

        // Without the module: refused by the module check, nothing read.
        var fpoEmployee = Seat(OrganizationType.FPO, OrganizationRole.Employee, isPlatformAdmin: false);
        fpoEmployee.CanRead(ModuleKey.MetricsNsm).Should().BeFalse();
        var noModule = await Ask(fpoEmployee, WvfdRoute, "?weeks=4");
        noModule.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(noModule.Body).Should().Be("admin_module_forbidden");
        noModule.Ports.ReadAllCalls.Should().Be(0);

        // The control: a platform owner is let in and the handler really reads, naming the signed-in admin. The
        // platform lists no farm, which is not measured, never an empty "nobody" and never a goal.
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);
        var ok = await Ask(owner, WvfdRoute, "?weeks=4");
        ok.Status.Should().Be(StatusCodes.Status200OK, ok.Body);
        ok.Ports.ReadAllCalls.Should().Be(1);
        ok.Ports.AdminUserId.Should().Be(Admin, "the signed-in admin is named on the factory's audit row");
        ok.Ports.CountedAtUtc.Should().Be(Now);
        ok.Ports.SinceUtc.Should().Be(new DateTime(2026, 10, 18, 18, 30, 0, DateTimeKind.Utc),
            "entries load from 00:00 India time of the Monday 4 weeks before this week's Monday");

        using var doc = JsonDocument.Parse(ok.Body);
        var data = doc.RootElement.GetProperty("data");
        data.GetProperty("notMeasuredReason").GetString().Should().Be("farm_list_unreadable");
        data.GetProperty("goalWvfd").ValueKind.Should().Be(JsonValueKind.Null, "no goal is sent");
        data.GetProperty("currentWvfd").ValueKind.Should().Be(JsonValueKind.Null, "not measured is null, never 0");
        doc.RootElement.GetProperty("meta").GetProperty("source").GetString().Should().Be("live");
    }

    [Fact]
    public void The_wvfd_route_is_not_cached()
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        var endpoints = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>().ToList();

        var wvfd = endpoints.Where(e => e.RoutePattern.RawText == WvfdRoute).ToList();
        wvfd.Should().ContainSingle();
        HasOutputCache(wvfd[0]).Should().BeFalse("each call opens the audited factory: no .CacheOutput (C32)");

        // The control proves the check can see a cache: All Farms keeps CacheOutput("AdminLive") (C33 7).
        endpoints.Single(e => e.RoutePattern.RawText == FarmsRoute).Should().Match<RouteEndpoint>(e => HasOutputCache(e));
    }

    [Fact]
    public async Task An_unknown_tier_is_refused()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        var refused = await Ask(owner, FarmsRoute, "?page=1&pageSize=10&tier=E");

        refused.Status.Should().Be(StatusCodes.Status400BadRequest, refused.Body);
        Code(refused.Body).Should().Be("tier_invalid");
        refused.Ports.FarmsListCalls.Should().Be(0, "refused at once, before anything is read");

        var ok = await Ask(owner, FarmsRoute, "?page=1&pageSize=10&tier=B");
        ok.Status.Should().Be(StatusCodes.Status200OK, ok.Body);
        ok.Ports.FarmsListCalls.Should().Be(1);
    }

    [Theory]
    [InlineData("tier_filter_too_many_farms")]
    [InlineData("tier_filter_not_measured")]
    public async Task A_refused_tier_filter_answers_409_with_its_code(string code)
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        var refused = await Ask(owner, FarmsRoute, "?page=1&pageSize=10&tier=A", farmsRefusal: code);

        refused.Status.Should().Be(StatusCodes.Status409Conflict, refused.Body);
        Code(refused.Body).Should().Be(code);
        refused.Body.Should().NotContain("items", "a refusal is never sent as the empty list it came with");
    }

    // ------------------------------------------------------------------
    // Harness (as AdminSilentFarmsGateTests)
    // ------------------------------------------------------------------

    private static AdminScope Seat(OrganizationType type, OrganizationRole role, bool isPlatformAdmin) =>
        new(Org, type, role, EntitlementMatrix.For(type, role), IsPlatformAdmin: isPlatformAdmin);

    private static bool HasOutputCache(RouteEndpoint endpoint) =>
        endpoint.Metadata.Any(m => m is IOutputCachePolicy || m is OutputCacheAttribute);

    private static TestRouteBuilder NewRouteBuilder() =>
        new(new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

    private static RouteEndpoint EndpointOf(string route)
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, route, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the admin routes must map exactly one {route}");
        var methods = matches[0].Metadata.GetMetadata<HttpMethodMetadata>();
        methods.Should().NotBeNull();
        methods!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" }, "the route is a read");
        return matches[0];
    }

    private static async Task<Answer> Ask(AdminScope scope, string route, string query, string? farmsRefusal = null)
    {
        var endpoint = EndpointOf(route);
        var ports = new RecordingPorts { FarmsRefusal = farmsRefusal };

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(
            new FixedSeatResolver(ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>())));
        services.AddSingleton(new GetWvfdHistoryHandler(ports, CompanyMisExclusions.None, new FixedClock(Now)));
        services.AddSingleton(new GetFarmsListHandler(ports));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = route, QueryString = new QueryString(query) },
            User = new ClaimsPrincipal(new ClaimsIdentity(
                new[] { new Claim("sub", Admin.ToString("D")) }, authenticationType: "Test")),
        };

        ctx.SetEndpoint(endpoint);
        await endpoint.RequestDelegate!(ctx);
        await ctx.Response.Body.FlushAsync();

        ctx.Response.Body.Position = 0;
        using var streamReader = new StreamReader(ctx.Response.Body);
        var body = await streamReader.ReadToEndAsync();

        return new Answer(ctx.Response.StatusCode, body, ports);
    }

    private static string Code(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("code", out var code)
            ? code.GetString() ?? "(null)"
            : "(no code in the body)";
    }

    private sealed record Answer(int Status, string Body, RecordingPorts Ports);

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

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    /// <summary>The confirmed farm-days reader and the All Farms repository in one recorder. The reader lists no farm.</summary>
    private sealed class RecordingPorts : IConfirmedFarmDaysReader, IAdminMisRepository
    {
        public string? FarmsRefusal { get; init; }
        public int ReadAllCalls { get; private set; }
        public int FarmsListCalls { get; private set; }
        public Guid? AdminUserId { get; private set; }
        public DateTime? SinceUtc { get; private set; }
        public DateTime? CountedAtUtc { get; private set; }

        public Task<ConfirmedFarmDaysRows> ReadAllAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default)
        {
            ReadAllCalls++;
            AdminUserId = adminUserId;
            SinceUtc = DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc);
            CountedAtUtc = DateTime.SpecifyKind(countedAtUtc, DateTimeKind.Utc);
            return Task.FromResult(new ConfirmedFarmDaysRows(
                0, 0, Array.Empty<ConfirmedFarmRow>(), Array.Empty<ConfirmedEntryRow>(),
                Array.Empty<ConfirmedCheckRow>(), false));
        }

        public Task<ConfirmedFarmDaysRows> ReadFarmsAsync(
            IReadOnlyCollection<ConfirmedFarmKey> keys, DateTime sinceUtc, DateTime countedAtUtc,
            CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
        {
            FarmsListCalls++;
            return Task.FromResult(new FarmsListDto(Array.Empty<FarmSummaryDto>(), 0, page, pageSize)
            {
                RefusalCode = FarmsRefusal,
            });
        }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
