using System.Security.Claims;
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetSilentChurn;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Subscriptions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4 as replaced by C26; C27).
/// Written by the test-writer from the plan only.
///
/// <para>
/// <c>GET /shramsafal/admin/farms/silent-churn</c> names farms and owner phones across every farm, so it is platform
/// owners only: the module check (<c>farms.silent-churn</c>), then <c>RequirePlatformSeatAsync</c>, refused with
/// 403 before anything is read (no reader call, no contacts read, no plan read: no audited factory opened). No
/// <c>.CacheOutput</c>: each load is an honest live count. The gates live in the route delegate, so these tests run
/// it as <see cref="AdminOneFarmPageGateTests"/> does: the production mapping on a hand-made route builder, a fixed
/// seat, the real handler over recording ports and a context with no database provider (a refused caller must
/// never touch it). No web server, no database.
/// </para>
/// </summary>
public sealed class AdminSilentFarmsGateTests
{
    private const string SilentRoute = "/shramsafal/admin/farms/silent-churn";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2e04");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c2e04");

    /// <summary>06:30 UTC on 14 Nov 2026 = 12:00 India time.</summary>
    private static readonly DateTime Now = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    // spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4): replaces Silent_list_refuses_a_non_platform_admin
    // (its analyst half is now a team seat that is served; its FPO and no-module halves live on below).
    [Fact]
    public async Task Silent_list_answers_a_team_seat_with_the_farms_to_call_tick()
    {
        var team = TeamSeat(ControlRoomTicks.FarmsToCall);
        team.CanRead(ModuleKey.FarmsSilentChurn).Should().BeTrue();

        var ok = await Ask(team);

        ok.Status.Should().Be(StatusCodes.Status200OK, ok.Body);
        ok.Ports.ReaderCalls.Should().Be(1, "a Platform seat with the tick is let in and the handler really reads");
        ok.Ports.ReaderAdminUserId.Should().Be(Admin, "the signed-in admin is named on the factory's audit row");

        // The control: the founder. The platform has no farms, which is not measured (C27 2), never an empty "nobody".
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);
        var founder = await Ask(owner);
        founder.Status.Should().Be(StatusCodes.Status200OK, founder.Body);
        founder.Ports.ReaderCalls.Should().Be(1);
        founder.Ports.ReaderAdminUserId.Should().Be(Admin, "the signed-in admin is named on the factory's audit row");
        founder.Ports.ReaderCountedAtUtc.Should().Be(Now);
        founder.Ports.ReaderSinceUtc.Should().Be(new DateTime(2026, 10, 14, 18, 30, 0, DateTimeKind.Utc),
            "entries are loaded from the start of the India day 30 days before today (C10, C26)");

        using var doc = JsonDocument.Parse(founder.Body);
        var data = doc.RootElement.GetProperty("data");
        data.GetProperty("countedAtUtc").GetDateTime().ToUniversalTime().Should().Be(Now);
        data.GetProperty("farms").GetArrayLength().Should().Be(0);
        data.GetProperty("notMeasuredReason").GetString().Should().Be("farm_list_unreadable");
    }

    [Fact]
    public async Task Silent_list_refuses_a_team_seat_without_the_farms_to_call_tick()
    {
        var team = TeamSeat(ControlRoomTicks.CompanyNumbers);
        var refused = await Ask(team);
        refused.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(refused.Body).Should().Be("admin_module_forbidden");
        refused.Ports.ReaderCalls.Should().Be(0, "no farm key is read, no audited factory opened");
        refused.Ports.ContactCalls.Should().Be(0, "no name or phone is read");
        refused.Ports.PlanCalls.Should().Be(0, "no plan is read");
        refused.Body.Should().NotContain("countedAtUtc", "a refusal carries no part of the answer");

        // An FPO owner holds the module, and only the Platform-seat gate refuses.
        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        fpoOwner.CanRead(ModuleKey.FarmsSilentChurn).Should().BeTrue("the FPO owner holds the module");
        var fpo = await Ask(fpoOwner);
        fpo.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(fpo.Body).Should().Be("admin_platform_only");
        fpo.Ports.ReaderCalls.Should().Be(0);
        fpo.Ports.ContactCalls.Should().Be(0);

        // Without the module: refused by the module check, nothing read.
        var fpoEmployee = Seat(OrganizationType.FPO, OrganizationRole.Employee, isPlatformAdmin: false);
        fpoEmployee.CanRead(ModuleKey.FarmsSilentChurn).Should().BeFalse();
        var noModule = await Ask(fpoEmployee);
        noModule.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(noModule.Body).Should().Be("admin_module_forbidden");
        noModule.Ports.ReaderCalls.Should().Be(0);
        noModule.Ports.ContactCalls.Should().Be(0);
    }

    [Fact]
    public void The_silent_list_is_not_cached()
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        var endpoints = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>().ToList();

        var silent = endpoints.Where(e => e.RoutePattern.RawText == SilentRoute).ToList();
        silent.Should().ContainSingle($"the admin routes must map exactly one {SilentRoute}");
        HasOutputCache(silent[0]).Should().BeFalse("each load opens the audited factory: .CacheOutput is removed (C26)");

        // The control proves the check can see a cache: Suffering keeps CacheOutput("AdminLive") (C19 item 6).
        var suffering = endpoints.Single(e => e.RoutePattern.RawText == "/shramsafal/admin/farms/suffering");
        HasOutputCache(suffering).Should().BeTrue();
    }

    // ------------------------------------------------------------------
    // Harness (as AdminOneFarmPageGateTests)
    // ------------------------------------------------------------------

    private static AdminScope Seat(OrganizationType type, OrganizationRole role, bool isPlatformAdmin) =>
        new(Org, type, role, EntitlementMatrix.For(type, role), IsPlatformAdmin: isPlatformAdmin);

    private static AdminScope TeamSeat(params string[] ticks) =>
        new(Org, OrganizationType.Platform, OrganizationRole.Employee, ControlRoomTicks.ModulesFor(ticks), IsPlatformAdmin: false);

    private static bool HasOutputCache(RouteEndpoint endpoint) =>
        endpoint.Metadata.Any(m => m is IOutputCachePolicy || m is OutputCacheAttribute);

    private static TestRouteBuilder NewRouteBuilder() =>
        new(new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

    private static RouteEndpoint SilentEndpoint()
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, SilentRoute, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the admin routes must map exactly one {SilentRoute}");
        var methods = matches[0].Metadata.GetMetadata<HttpMethodMetadata>();
        methods.Should().NotBeNull();
        methods!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" }, "the route is a read");
        return matches[0];
    }

    private static async Task<Answer> Ask(AdminScope scope)
    {
        var endpoint = SilentEndpoint();
        var ports = new RecordingPorts();

        // A context with no database provider: any use of it throws, so a refused caller provably never reads.
        var noDatabase = new DbContext(new DbContextOptionsBuilder<DbContext>().Options);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(
            new FixedSeatResolver(ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>())));
        services.AddSingleton(new GetSilentChurnHandler(
            ports, ports, ports, new RecordingControlRoomHistory(), new FixedControlRoomStore(), noDatabase,
            CompanyMisExclusions.None, new FixedClock(Now)));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = SilentRoute },
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

    /// <summary>Reader, contacts and plan ports in one recorder. The reader lists no farm.</summary>
    private sealed class RecordingPorts : ICompanyMisReader, IAdminMisRepository, ISubscriptionReader
    {
        public int ReaderCalls { get; private set; }
        public Guid? ReaderAdminUserId { get; private set; }
        public DateTime? ReaderSinceUtc { get; private set; }
        public DateTime? ReaderCountedAtUtc { get; private set; }
        public int ContactCalls { get; private set; }
        public int PlanCalls { get; private set; }

        // Compile-only (plan CR-2c, E3): the Company MIS method reads as ReadAsync here.
        public Task<CompanyMisRows> ReadForCompanyMisAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime additionsSinceUtc, DateTime countedAtUtc,
            IReadOnlySet<Guid> excludedUserIds, CancellationToken ct = default) =>
            ReadAsync(adminUserId, sinceUtc, countedAtUtc, excludedUserIds, ct);

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default)
        {
            ReaderCalls++;
            ReaderAdminUserId = adminUserId;
            ReaderSinceUtc = DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc);
            ReaderCountedAtUtc = DateTime.SpecifyKind(countedAtUtc, DateTimeKind.Utc);
            return Task.FromResult(new CompanyMisRows(
                0, 0,
                Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>(), Array.Empty<MisMembershipRow>(),
                Array.Empty<MisPlotRow>(), Array.Empty<MisVoiceJobRow>(), Array.Empty<MisUserRow>(),
                Array.Empty<MisFpoScopeRow>()));
        }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            ContactCalls++;
            return Task.FromResult<IReadOnlyList<FarmContactDto>>(Array.Empty<FarmContactDto>());
        }

        public Task<SubscriptionProjection?> GetByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default)
        {
            PlanCalls++;
            return Task.FromResult<SubscriptionProjection?>(null);
        }

        public Task<AccessExtensionProjection?> GetActiveAccessExtensionAsync(
            OwnerAccountId ownerAccountId, DateTime asOfUtc, CancellationToken ct = default) =>
            throw new NotSupportedException("the silent list reads the subscription only");

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
