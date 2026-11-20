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
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5 as replaced by C29; C11). Written by the
/// test-writer from the plan only.
///
/// <para>
/// <c>GET /shramsafal/admin/ops/voice-check</c> reads voice jobs across every farm (farm keys through the audited
/// factory), so it is platform owners only: refused with 403 before anything is read. No <c>.CacheOutput</c>: each
/// call is an honest live count. Run as <see cref="AdminSilentFarmsGateTests"/> does: the production route mapping
/// on a hand-made route builder, a fixed seat, the real handler over a recording reader. No web server, no
/// database.
/// </para>
/// </summary>
public sealed class AdminVoiceCheckGateTests
{
    private const string VoiceRoute = "/shramsafal/admin/ops/voice-check";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2e05");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c2e05");

    /// <summary>06:30 UTC on 14 Nov 2026.</summary>
    private static readonly DateTime Now = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    // spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4): replaces Voice_check_refuses_a_non_platform_admin
    // (its analyst half is now a team seat that is served; its FPO half lives on in the refusal test below).
    [Fact]
    public async Task Voice_check_answers_a_team_seat_with_server_health()
    {
        var team = TeamSeat(ControlRoomTicks.ServerHealth);
        team.CanRead(ModuleKey.OpsLive).Should().BeTrue();

        var ok = await Ask(team);
        ok.Status.Should().Be(StatusCodes.Status200OK, ok.Body);
        ok.Ports.ReaderCalls.Should().Be(1, "a Platform seat with the tick is let in and the reader is asked once");
        ok.Ports.ReaderAdminUserId.Should().Be(Admin);

        // The control: the founder is let in and the reader is asked once, naming the signed-in admin.
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);
        var founder = await Ask(owner);
        founder.Status.Should().Be(StatusCodes.Status200OK, founder.Body);
        founder.Ports.ReaderCalls.Should().Be(1);
        founder.Ports.ReaderAdminUserId.Should().Be(Admin);
        founder.Ports.ReaderCountedAtUtc.Should().Be(Now);
        founder.Ports.ReaderSinceUtc.Should().Be(Now.AddHours(-6));

        using var doc = JsonDocument.Parse(founder.Body);
        doc.RootElement.GetProperty("rule").GetString().Should().Be("R10");
        doc.RootElement.GetProperty("state").GetString().Should().Be("not_judged",
            "a platform with no farm listed is not measured, never clear");
        doc.RootElement.GetProperty("windowEndUtc").GetDateTime().ToUniversalTime().Should().Be(Now);
    }

    [Fact]
    public async Task Voice_check_refuses_a_team_seat_without_server_health()
    {
        var team = TeamSeat(ControlRoomTicks.CompanyNumbers);
        var refused = await Ask(team);
        refused.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(refused.Body).Should().Be("admin_module_forbidden");
        refused.Ports.ReaderCalls.Should().Be(0, "nothing is read, no audited factory opened");
        refused.Body.Should().NotContain("windowEndUtc", "a refusal carries no part of the answer");

        // An FPO owner lacks ops.live, so the module gate refuses it; nothing is read either way.
        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        var fpo = await Ask(fpoOwner);
        fpo.Status.Should().Be(StatusCodes.Status403Forbidden);
        fpo.Ports.ReaderCalls.Should().Be(0);
    }

    [Fact]
    public void The_voice_check_is_a_read_and_is_not_cached()
    {
        var endpoint = VoiceEndpoint();

        endpoint.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Should().BeEquivalentTo(new[] { "GET" });
        HasOutputCache(endpoint).Should().BeFalse("each call opens the audited factory: no .CacheOutput (C11)");

        // The control proves the check can see a cache: Suffering keeps CacheOutput("AdminLive").
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        var suffering = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == "/shramsafal/admin/farms/suffering");
        HasOutputCache(suffering).Should().BeTrue();
    }

    // ------------------------------------------------------------------
    // Harness (as AdminSilentFarmsGateTests)
    // ------------------------------------------------------------------

    private static AdminScope Seat(OrganizationType type, OrganizationRole role, bool isPlatformAdmin) =>
        new(Org, type, role, EntitlementMatrix.For(type, role), IsPlatformAdmin: isPlatformAdmin);

    private static AdminScope TeamSeat(params string[] ticks) =>
        new(Org, OrganizationType.Platform, OrganizationRole.Employee, ControlRoomTicks.ModulesFor(ticks), IsPlatformAdmin: false);

    private static bool HasOutputCache(RouteEndpoint endpoint) =>
        endpoint.Metadata.Any(m => m is IOutputCachePolicy || m is OutputCacheAttribute);

    private static TestRouteBuilder NewRouteBuilder() =>
        new(new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

    private static RouteEndpoint VoiceEndpoint()
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, VoiceRoute, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the admin routes must map exactly one {VoiceRoute}");
        return matches[0];
    }

    private static async Task<Answer> Ask(AdminScope scope)
    {
        var endpoint = VoiceEndpoint();
        var ports = new RecordingReader();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(
            new FixedSeatResolver(ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>())));
        services.AddSingleton(new GetVoiceCheckHandler(ports, CompanyMisExclusions.None, new FixedClock(Now)));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = VoiceRoute },
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

    private sealed record Answer(int Status, string Body, RecordingReader Ports);

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

    /// <summary>A reader that lists no farm and records how it was asked.</summary>
    private sealed class RecordingReader : ICompanyMisReader
    {
        public int ReaderCalls { get; private set; }
        public Guid? ReaderAdminUserId { get; private set; }
        public DateTime? ReaderSinceUtc { get; private set; }
        public DateTime? ReaderCountedAtUtc { get; private set; }

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
    }
}
