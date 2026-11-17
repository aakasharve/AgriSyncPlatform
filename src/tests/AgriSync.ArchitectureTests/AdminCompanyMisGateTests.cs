using System.Security.Claims;
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetUsersList;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Tasks 1 and 4).
/// Written by the test-writer from the spec and the plan only.
///
/// <para>
/// Company-wide numbers, and the lists of every farm and every person, are for
/// admins of the platform organisation only (decision 6). An FPO owner holds
/// <c>metrics.nsm</c> and <c>farms.list</c>, so the module gate alone would let
/// them in; the platform gate must follow it. The gates live in the bodies of
/// the route delegates, so this test runs them: the production mapping on a
/// hand-made route builder (the <c>AdminOpsAppVersionsGateTests</c> harness),
/// a fixed seat in place of the resolver, and the real handlers over a reader /
/// repository that records what it was asked. No web server, no database.
/// </para>
/// </summary>
public sealed class AdminCompanyMisGateTests
{
    private const string CompanyRoute = "/shramsafal/admin/mis/company";
    private const string FarmsRoute = "/shramsafal/admin/farms";
    private const string UsersRoute = "/shramsafal/admin/users";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2a01");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c2a01");

    /// <summary>06:30 UTC on 14 Nov 2026 = 12:00 India time.</summary>
    private static readonly DateTime Now = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Company_mis_is_refused_to_a_non_platform_admin()
    {
        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        fpoOwner.CanRead(ModuleKey.MetricsNsm).Should().BeTrue("this is the seat the case is about: it holds metrics.nsm");

        var answer = await Ask(CompanyRoute, null, fpoOwner);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(answer.Body).Should().Be("admin_platform_only");
        answer.Reader.Calls.Should().Be(0, "nothing is read and no cross-farm audit row is written for a refused caller");
        answer.Body.Should().NotContain("countedAtUtc", "a refusal carries no part of the answer");
    }

    [Fact]
    public async Task Company_mis_is_refused_to_a_platform_analyst()
    {
        var analyst = Seat(OrganizationType.Platform, OrganizationRole.Analyst, isPlatformAdmin: false);
        analyst.CanRead(ModuleKey.MetricsNsm).Should().BeTrue("the analyst holds the module; only the platform gate refuses");

        var answer = await Ask(CompanyRoute, null, analyst);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(answer.Body).Should().Be("admin_platform_only");
        answer.Reader.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Company_mis_is_refused_without_metrics_nsm()
    {
        var fpoEmployee = Seat(OrganizationType.FPO, OrganizationRole.Employee, isPlatformAdmin: false);
        fpoEmployee.CanRead(ModuleKey.MetricsNsm).Should().BeFalse();

        var answer = await Ask(CompanyRoute, null, fpoEmployee);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(answer.Body).Should().Be("admin_module_forbidden");
        answer.Reader.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Company_mis_without_a_seat_is_401()
    {
        var answer = await Ask(CompanyRoute, null, ResolveResult.Unauthorized());

        answer.Status.Should().Be(StatusCodes.Status401Unauthorized);
        answer.Reader.Calls.Should().Be(0);

        var nobody = await Ask(CompanyRoute, null, ResolveResult.Unauthorized(), signedIn: false);
        nobody.Status.Should().Be(StatusCodes.Status401Unauthorized);
        nobody.Reader.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Company_mis_answers_200_to_a_platform_owner()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        var answer = await Ask(CompanyRoute, null, owner);

        answer.Status.Should().Be(StatusCodes.Status200OK);
        answer.Reader.Calls.Should().Be(1, "for a platform owner the handler really reads");
        answer.Reader.AdminUserId.Should().Be(Admin, "the signed-in admin is named to the reader (and so in the audit row)");

        using var doc = JsonDocument.Parse(answer.Body);
        var data = doc.RootElement.GetProperty("data");
        data.GetProperty("timeZone").GetString().Should().Be("Asia/Kolkata");
        data.GetProperty("countedAtUtc").GetDateTime().ToUniversalTime().Should().Be(Now);
        data.GetProperty("range").GetProperty("from").GetString().Should().Be("2026-10-16");
        data.GetProperty("range").GetProperty("to").GetString().Should().Be("2026-11-14");
        doc.RootElement.GetProperty("meta").GetProperty("source").GetString().Should().Be("live");
        doc.RootElement.GetProperty("meta").GetProperty("window").GetString().Should().Be("2026-10-16..2026-11-14");

        var withRange = await Ask(CompanyRoute, "?from=2026-11-08&to=2026-11-14", owner);
        withRange.Status.Should().Be(StatusCodes.Status200OK);
        using var ranged = JsonDocument.Parse(withRange.Body);
        ranged.RootElement.GetProperty("data").GetProperty("range").GetProperty("days").GetInt32().Should().Be(7);
    }

    [Fact]
    public async Task Company_mis_refuses_a_malformed_date_with_400()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        foreach (var query in new[] { "?from=2026-13-01&to=2026-11-14", "?from=2026-11-01&to=14-11-2026" })
        {
            var answer = await Ask(CompanyRoute, query, owner);

            answer.Status.Should().Be(StatusCodes.Status400BadRequest, query);
            Code(answer.Body).Should().Be("mis_range_invalid", query);
            answer.Reader.Calls.Should().Be(0, query);
        }

        // A well-formed but refused range answers the same code.
        var overLong = await Ask(CompanyRoute, "?from=2026-01-01&to=2026-11-14", owner);
        overLong.Status.Should().Be(StatusCodes.Status400BadRequest);
        Code(overLong.Body).Should().Be("mis_range_invalid");
        overLong.Reader.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Farms_and_users_lists_are_refused_to_a_non_platform_admin()
    {
        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        fpoOwner.CanRead(ModuleKey.FarmsList).Should().BeTrue("an FPO owner holds farms.list");

        // Farms: the module gate lets the FPO owner through; the platform gate refuses.
        var farms = await Ask(FarmsRoute, "?page=1&pageSize=20", fpoOwner);
        farms.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(farms.Body).Should().Be("admin_platform_only");
        farms.Repository.Calls.Should().BeEmpty("no farm and no phone number is read for a refused caller");

        // Users: the FPO owner is refused too, and nothing is read.
        var users = await Ask(UsersRoute, "?page=1&pageSize=20", fpoOwner);
        users.Status.Should().Be(StatusCodes.Status403Forbidden);
        users.Repository.Calls.Should().BeEmpty();

        // The platform gate itself on both lists: a Platform Analyst holds farms.list and admin.users
        // but is not a platform owner.
        var analyst = Seat(OrganizationType.Platform, OrganizationRole.Analyst, isPlatformAdmin: false);
        analyst.CanRead(ModuleKey.FarmsList).Should().BeTrue();
        analyst.CanRead(ModuleKey.AdminUsers).Should().BeTrue();
        foreach (var route in new[] { FarmsRoute, UsersRoute })
        {
            var refused = await Ask(route, "?page=1&pageSize=20", analyst);
            refused.Status.Should().Be(StatusCodes.Status403Forbidden, route);
            Code(refused.Body).Should().Be("admin_platform_only", route);
            refused.Repository.Calls.Should().BeEmpty(route);
        }

        // The control: a platform owner is let in and the handlers really read.
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);
        var ownerFarms = await Ask(FarmsRoute, "?page=1&pageSize=20", owner);
        ownerFarms.Status.Should().Be(StatusCodes.Status200OK);
        ownerFarms.Repository.Calls.Should().Contain(nameof(IAdminMisRepository.GetFarmsListAsync));
        ownerFarms.Repository.FarmsAdminUserId.Should().Be(Admin, "the admin is named in the cross-farm audit row");
        var ownerUsers = await Ask(UsersRoute, "?page=1&pageSize=20", owner);
        ownerUsers.Status.Should().Be(StatusCodes.Status200OK);
        ownerUsers.Repository.Calls.Should().Contain(nameof(IAdminMisRepository.GetUsersListAsync));
    }

    // ------------------------------------------------------------------
    // Harness (as AdminOpsAppVersionsGateTests)
    // ------------------------------------------------------------------

    private static AdminScope Seat(OrganizationType type, OrganizationRole role, bool isPlatformAdmin) =>
        new(Org, type, role, EntitlementMatrix.For(type, role), IsPlatformAdmin: isPlatformAdmin);

    private static RouteEndpoint Endpoint(string route)
    {
        var routes = new TestRouteBuilder(
            new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

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

    private static Task<Answer> Ask(string route, string? query, AdminScope scope) =>
        Ask(route, query, ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>()));

    private static async Task<Answer> Ask(string route, string? query, ResolveResult seat, bool signedIn = true)
    {
        var endpoint = Endpoint(route);
        var resolver = new FixedSeatResolver(seat);
        var reader = new RecordingReader();
        var repository = new RecordingMisRepository();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(resolver);
        services.AddSingleton(new GetCompanyMisHandler(
            reader, new CompanyMisExclusions(new HashSet<Guid>()), new FixedClock(Now)));
        services.AddSingleton(new GetFarmsListHandler(repository));
        services.AddSingleton(new GetUsersListHandler(repository));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = route, QueryString = new QueryString(query ?? string.Empty) },
        };

        if (signedIn)
        {
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(
                new[] { new Claim("sub", Admin.ToString("D")) }, authenticationType: "Test"));
        }

        ctx.SetEndpoint(endpoint);
        await endpoint.RequestDelegate!(ctx);
        await ctx.Response.Body.FlushAsync();

        ctx.Response.Body.Position = 0;
        using var streamReader = new StreamReader(ctx.Response.Body);
        var body = await streamReader.ReadToEndAsync();

        return new Answer(ctx.Response.StatusCode, body, reader, repository);
    }

    private static string Code(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.TryGetProperty("code", out var code)
            ? code.GetString() ?? "(null)"
            : "(no code in the body)";
    }

    private sealed record Answer(int Status, string Body, RecordingReader Reader, RecordingMisRepository Repository);

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

    private sealed class RecordingReader : ICompanyMisReader
    {
        public int Calls { get; private set; }
        public Guid AdminUserId { get; private set; }

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default)
        {
            Calls++;
            AdminUserId = adminUserId;
            return Task.FromResult(new CompanyMisRows(
                0, 0,
                Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>(), Array.Empty<MisMembershipRow>(),
                Array.Empty<MisPlotRow>(), Array.Empty<MisVoiceJobRow>(), Array.Empty<MisUserRow>(),
                Array.Empty<MisFpoScopeRow>()));
        }
    }

    private sealed class RecordingMisRepository : IAdminMisRepository
    {
        public List<string> Calls { get; } = new();
        public Guid? FarmsAdminUserId { get; private set; }

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetFarmsListAsync));
            FarmsAdminUserId = adminUserId;
            return Task.FromResult(new FarmsListDto(Array.Empty<FarmSummaryDto>(), 0, page, pageSize));
        }

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetUsersListAsync));
            return Task.FromResult(new UsersListDto(Array.Empty<UserSummaryDto>(), 0, page, pageSize));
        }

        public Task<WvfdHistoryDto> GetWvfdHistoryAsync(int weeks, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
