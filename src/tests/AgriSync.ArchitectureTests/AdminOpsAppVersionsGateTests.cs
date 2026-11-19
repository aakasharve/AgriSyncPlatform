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
using ShramSafal.Application.UseCases.Admin.GetAppVersions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (plan CR-1c Task V4, review
/// round 2: "nothing pins the route's <c>ops.live</c> gate").
///
/// <para>
/// <c>GET /shramsafal/admin/ops/app-versions</c> lists people by name with
/// their farms. The acceptance criterion is that it is refused without
/// <c>ops.live</c>. The gate lives in the body of the route's delegate, so
/// neither the route's metadata nor a search of the source text can say
/// whether it works. This test runs it.
/// </para>
///
/// <para>
/// The harness is the one <c>AdminFarmerHealthEndpointTests</c> uses for its
/// endpoint-mapping layer: the production mapping extension is called on a
/// hand-made <see cref="IEndpointRouteBuilder"/>, with no web server and no
/// database. It goes one step further and INVOKES the route's own
/// <see cref="RequestDelegate"/>, with a fixed seat in place of the
/// entitlement resolver and a recording repository behind the real
/// <see cref="GetAppVersionsHandler"/>. So what is asserted is what a caller
/// gets (the status and the refusal's body) and what the server did for them
/// (whether anything was read).
/// </para>
///
/// <para>
/// Not covered here: that the pipeline in front of the route rejects a
/// request with no token at all (<c>RequireAuthorization</c> on the
/// <c>/shramsafal</c> group), and the resolver's own rules for who holds
/// which seat (<c>EntitlementResolverTests</c>, which needs a database).
/// </para>
/// </summary>
public sealed class AdminOpsAppVersionsGateTests
{
    private const string Route = "/shramsafal/admin/ops/app-versions";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-000000000001");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task App_versions_is_refused_without_ops_live()
    {
        var endpoint = AppVersionsEndpoint();

        // 1. A real seat that does not hold ops.live: the owner of an FPO.
        //    It reads its own farms list, so it is not a seat with nothing.
        var fpoOwner = new AdminScope(
            Org,
            OrganizationType.FPO,
            OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Owner),
            IsPlatformAdmin: false);

        fpoOwner.CanRead(ModuleKey.OpsLive).Should().BeFalse("this is the seat the case is about");
        fpoOwner.CanRead(ModuleKey.FarmsList).Should().BeTrue("and it is a working seat, not an empty one");

        var refused = await Ask(endpoint, SignedIn(Admin), Seat(fpoOwner));

        refused.Status.Should().Be(StatusCodes.Status403Forbidden,
            "a seat without ops.live is refused: the page lists people by name with their farms");
        ModuleNamedInRefusal(refused.Body).Should().Be(ModuleKey.OpsLive,
            "the refusal names the module this route is gated on, and that module is ops.live");
        refused.Repository.Calls.Should().BeEmpty(
            "nothing is read for a caller who is refused: no person, no farm name, and no "
            + "cross-farm audit row written in their name");
        refused.Body.Should().NotContain("measuredSinceUtc", "a refusal carries no part of the answer");

        // 2. Every module EXCEPT ops.live, on a seat flagged as platform admin.
        //    The gate is this one module: not some neighbouring module (a gate
        //    on ops.errors would let this seat in), and not the seat's title.
        var everythingElse = new AdminScope(
            Org,
            OrganizationType.Platform,
            OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner)
                .Where(m => m.ModuleKey != ModuleKey.OpsLive)
                .ToList(),
            IsPlatformAdmin: true);

        everythingElse.CanRead(ModuleKey.OpsErrors).Should().BeTrue();
        everythingElse.CanRead(ModuleKey.OpsLive).Should().BeFalse();

        var stillRefused = await Ask(endpoint, SignedIn(Admin), Seat(everythingElse));

        stillRefused.Status.Should().Be(StatusCodes.Status403Forbidden,
            "holding every other module, and the platform-admin flag, does not stand in for ops.live");
        ModuleNamedInRefusal(stillRefused.Body).Should().Be(ModuleKey.OpsLive);
        stillRefused.Repository.Calls.Should().BeEmpty();

        // 3. No admin seat at all (a signed-in farm worker): 401, the
        //    resolver's contract for "no seat", and nothing read.
        var noSeat = await Ask(endpoint, SignedIn(Admin), ResolveResult.Unauthorized());

        noSeat.Status.Should().Be(StatusCodes.Status401Unauthorized, "a person with no admin seat is refused");
        noSeat.Repository.Calls.Should().BeEmpty();

        // 4. A caller who is nobody: refused before any seat is looked up.
        var nobody = await Ask(endpoint, user: null, Seat(fpoOwner));

        nobody.Status.Should().Be(StatusCodes.Status401Unauthorized);
        nobody.Resolver.Asked.Should().Be(0, "there is no person to look a seat up for");
        nobody.Repository.Calls.Should().BeEmpty();

        // The control. A seat that holds ops.live and NOTHING else is let in,
        // and the handler really runs. Without this, "refused" above could be
        // a route that refuses everybody, or a harness that never reaches the
        // handler at all.
        var onlyOpsLive = new AdminScope(
            Org,
            OrganizationType.Platform,
            OrganizationRole.Analyst,
            new[] { new ModuleEntitlement(ModuleKey.OpsLive, CanRead: true, CanExport: false, CanWrite: false) },
            IsPlatformAdmin: false);

        var allowed = await Ask(endpoint, SignedIn(Admin), Seat(onlyOpsLive));

        allowed.Status.Should().Be(StatusCodes.Status200OK, "ops.live, and only ops.live, is what the route asks for");
        allowed.Resolver.Asked.Should().Be(1, "the seat is resolved through the entitlement resolver, never read from a claim");
        allowed.Repository.Calls.Should().Contain(nameof(IAdminOpsRepository.GetAppSeenAsync),
            "for a seat with ops.live the handler really reads the records");
        allowed.Body.Should().Contain("measuredSinceUtc", "and the caller gets the answer");
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    /// <summary>
    /// Maps the production admin routes exactly as <c>MapShramSafalApi</c>
    /// does (a <c>/shramsafal</c> group, then <c>MapAdminEndpoints</c>) and
    /// returns the one route this test is about.
    /// </summary>
    private static RouteEndpoint AppVersionsEndpoint()
    {
        var routes = new TestRouteBuilder(
            new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

        routes.MapGroup("/shramsafal").MapAdminEndpoints();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, Route, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the admin routes must map exactly one {Route}");

        var methods = matches[0].Metadata.GetMetadata<HttpMethodMetadata>();
        methods.Should().NotBeNull();
        methods!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" }, "the route is a read");

        matches[0].RequestDelegate.Should().NotBeNull();
        return matches[0];
    }

    /// <summary>
    /// One request to the route's own delegate. The seat is whatever the test
    /// says the resolver answers; the handler is the real one over a
    /// repository that records what it was asked and holds no rows.
    /// </summary>
    private static async Task<Answer> Ask(RouteEndpoint endpoint, ClaimsPrincipal? user, ResolveResult seat)
    {
        var resolver = new FixedSeatResolver(seat);
        var repository = new RecordingOpsRepository();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(resolver);
        services.AddSingleton(new GetAppVersionsHandler(repository, TimeProvider.System));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = Route, QueryString = new QueryString("?days=7") },
        };

        if (user is not null)
        {
            ctx.User = user;
        }

        ctx.SetEndpoint(endpoint);

        await endpoint.RequestDelegate!(ctx);
        await ctx.Response.Body.FlushAsync();

        ctx.Response.Body.Position = 0;
        using var reader = new StreamReader(ctx.Response.Body);
        var body = await reader.ReadToEndAsync();

        return new Answer(ctx.Response.StatusCode, body, resolver, repository);
    }

    private static ResolveResult Seat(AdminScope scope) =>
        ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>());

    /// <summary>A signed-in caller, shaped like the principal the JWT handler builds.</summary>
    private static ClaimsPrincipal SignedIn(Guid userId) =>
        new(new ClaimsIdentity(new[] { new Claim("sub", userId.ToString("D")) }, authenticationType: "Test"));

    /// <summary>The module a 403 from the module gate says it was refused on.</summary>
    private static string ModuleNamedInRefusal(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.TryGetProperty("moduleKey", out var module)
            ? module.GetString() ?? "(null)"
            : "(the refusal names no module)";
    }

    private sealed record Answer(
        int Status,
        string Body,
        FixedSeatResolver Resolver,
        RecordingOpsRepository Repository);

    /// <summary>
    /// Minimal <see cref="IEndpointRouteBuilder"/> that collects the data
    /// sources the mapping appends, as in <c>AdminFarmerHealthEndpointTests</c>.
    /// </summary>
    private sealed class TestRouteBuilder(IServiceProvider services) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = services;

        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();

        public IApplicationBuilder CreateApplicationBuilder() => new ApplicationBuilder(ServiceProvider);
    }

    /// <summary>
    /// The services the routes are BUILT against (not the ones a request is
    /// served with). When the admin routes are mapped, the framework asks, for
    /// every parameter of every route, "is this a registered service?", and a
    /// read route whose handler parameter is not one fails to build. This
    /// answers yes for every class and interface, so that mapping the whole
    /// admin group does not need a registration here for each handler any
    /// admin route takes, and a new admin route cannot break this test.
    /// It only decides how parameters are classified; the request itself gets
    /// its two real services from <see cref="Ask"/>.
    /// </summary>
    private sealed class RouteBuildingServices(IServiceProvider inner) : IServiceProvider, IServiceProviderIsService
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(IServiceProviderIsService) ? this : inner.GetService(serviceType);

        public bool IsService(Type serviceType) => serviceType.IsInterface || serviceType.IsClass;
    }

    private sealed class FixedSeatResolver(ResolveResult result) : IEntitlementResolver
    {
        private int _asked;

        public int Asked => Volatile.Read(ref _asked);

        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct)
        {
            Interlocked.Increment(ref _asked);
            return Task.FromResult(result);
        }
    }

    /// <summary>
    /// Holds no rows and writes down every query it is asked. For a refused
    /// caller that list must stay empty.
    /// </summary>
    private sealed class RecordingOpsRepository : IAdminOpsRepository
    {
        public List<string> Calls { get; } = new();

        public Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetAppSeenAsync));
            return Task.FromResult<IReadOnlyList<AppSeenRow>>(Array.Empty<AppSeenRow>());
        }

        public Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default)
        {
            Calls.Add(nameof(GetAppSeenStartAsync));
            return Task.FromResult<DateTime?>(null);
        }

        public Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetSignInDevicesAsync));
            return Task.FromResult(new SignInDevices(Phones: 0, OtherDevices: 0, PeopleWithUnknownDevice: 0));
        }

        public Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
            IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetPeopleNamesAsync));
            return Task.FromResult<IReadOnlyDictionary<Guid, string?>>(new Dictionary<Guid, string?>());
        }

        public Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetFarmNamesByPersonAsync));
            return Task.FromResult<IReadOnlyDictionary<Guid, IReadOnlyList<string>>>(
                new Dictionary<Guid, IReadOnlyList<string>>());
        }

        // The members that were on the port before this plan. The route under
        // test has no business reaching them.
        public Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<OpsErrorsPageDto> GetErrorsPagedAsync(
            int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default) =>
            throw new NotSupportedException();

        // Added to the port after this plan, by plan CR-1a Task R1 (spec
        // control-room-go-live-must-haves-2026-11-10): the read behind
        // GET /shramsafal/admin/ops/recorded. The app-versions route has no
        // business reaching it; its own gate is held in
        // AdminOpsRecordedRouteTests.
        public Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(
            DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
