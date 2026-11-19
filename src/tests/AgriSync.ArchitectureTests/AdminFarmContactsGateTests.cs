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
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
using ShramSafal.Application.UseCases.Admin.GetSuffering;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Tasks 1 and 2; amendment C17).
/// Written by the test-writer from the plan only.
///
/// <para>
/// <c>GET /shramsafal/admin/farms/contacts?ids=</c> hands farm names and owner
/// phones to platform owners only (module <c>FarmsList</c>, then the platform
/// gate); 1 to 200 ids, otherwise 400 <c>{ "code": "contacts_ids_invalid" }</c>;
/// no cache. <c>GET /shramsafal/admin/farms/suffering</c> becomes platform
/// owners only too. The gates live in the route delegates, so these tests run
/// them as <see cref="AdminCompanyMisGateTests"/> does: the production mapping
/// on a hand-made route builder, a fixed seat, and the real handlers over a
/// repository that records what it was asked. "No factory opened" = the
/// repository was never asked. No web server, no database.
/// </para>
/// </summary>
public sealed class AdminFarmContactsGateTests
{
    private const string ContactsRoute = "/shramsafal/admin/farms/contacts";
    private const string SufferingRoute = "/shramsafal/admin/farms/suffering";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2e02");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c2e02");

    private static Guid Farm(int n) => Guid.Parse($"c2e20000-0000-0000-0000-{n:D12}");

    private static string IdsQuery(int count) =>
        "?ids=" + string.Join(",", Enumerable.Range(1, count).Select(n => Farm(n).ToString("D")));

    [Fact]
    public async Task Contacts_refuse_a_non_platform_admin()
    {
        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        fpoOwner.CanRead(ModuleKey.FarmsList).Should().BeTrue("this is the seat the case is about: it holds farms.list");

        var refused = await Ask(ContactsRoute, IdsQuery(2), fpoOwner);

        refused.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(refused.Body).Should().Be("admin_platform_only");
        refused.Repository.Calls.Should().BeEmpty("no farm name or phone is read and no factory opened for a refused caller");
        refused.Body.Should().NotContain("Fake Contact Farm");

        // A Platform Analyst holds every read module but is not a platform owner.
        var analyst = Seat(OrganizationType.Platform, OrganizationRole.Analyst, isPlatformAdmin: false);
        analyst.CanRead(ModuleKey.FarmsList).Should().BeTrue();
        var analystAnswer = await Ask(ContactsRoute, IdsQuery(2), analyst);
        analystAnswer.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(analystAnswer.Body).Should().Be("admin_platform_only");
        analystAnswer.Repository.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task Contacts_refuse_zero_or_more_than_200_ids()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        foreach (var query in new[] { null, "?ids=", "?ids=,", IdsQuery(201) })
        {
            var answer = await Ask(ContactsRoute, query, owner);

            var label = query is null ? "(no ids)" : query.Length > 40 ? "201 ids" : query;
            answer.Status.Should().Be(StatusCodes.Status400BadRequest, label);
            Code(answer.Body).Should().Be("contacts_ids_invalid", "the refusal key is code (C17): {0}", label);
            using (var doc = JsonDocument.Parse(answer.Body))
            {
                doc.RootElement.TryGetProperty("message", out _).Should().BeTrue("C17: {{ code, message }} ({0})", label);
                doc.RootElement.TryGetProperty("error", out _).Should().BeFalse("C17: the key is code, not error ({0})", label);
            }

            answer.Repository.Calls.Should().BeEmpty("nothing is read and no factory opened: {0}", label);
        }

        // The control on both edges: 1 id and exactly 200 ids are read, once each.
        foreach (var count in new[] { 1, 200 })
        {
            var ok = await Ask(ContactsRoute, IdsQuery(count), owner);
            ok.Status.Should().Be(StatusCodes.Status200OK, "{0} ids is inside the 1 to 200 rule", count);
            ok.Repository.Calls.Should().Equal(new[] { nameof(IAdminMisRepository.GetFarmContactsAsync) });
            ok.Repository.AskedIds.Should().BeEquivalentTo(Enumerable.Range(1, count).Select(Farm));
        }
    }

    [Fact]
    public async Task Contacts_refuse_an_id_that_is_not_a_uuid()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        var answer = await Ask(ContactsRoute, $"?ids={Farm(1):D},not-a-uuid", owner);

        answer.Status.Should().Be(StatusCodes.Status400BadRequest, "ids are comma-separated uuids");
        Code(answer.Body).Should().Be("contacts_ids_invalid");
        answer.Repository.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task Contacts_answer_farm_name_and_owner_phone_to_a_platform_owner()
    {
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);

        var answer = await Ask(ContactsRoute, IdsQuery(2), owner);

        answer.Status.Should().Be(StatusCodes.Status200OK);
        answer.Repository.ContactsAdminUserId.Should().Be(Admin, "the signed-in admin is named in the cross-farm audit row");

        using var doc = JsonDocument.Parse(answer.Body);
        doc.RootElement.ValueKind.Should().Be(JsonValueKind.Array, "the answer is [{ farmId, name, ownerPhone }]");
        var items = doc.RootElement.EnumerateArray().ToList();
        items.Should().HaveCount(2);

        var first = items.Single(i => i.GetProperty("farmId").GetGuid() == Farm(1));
        first.GetProperty("name").GetString().Should().Be("Fake Contact Farm 1");
        first.GetProperty("ownerPhone").GetString().Should().Be("0000000001");
        var second = items.Single(i => i.GetProperty("farmId").GetGuid() == Farm(2));
        second.GetProperty("ownerPhone").ValueKind.Should().Be(JsonValueKind.Null, "a farm whose owner has no phone on record");

        foreach (var item in items)
        {
            item.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                new[] { "farmId", "name", "ownerPhone" }, "the route does not send the owner account");
        }
    }

    [Fact]
    public void Contacts_are_not_cached_and_suffering_keeps_its_live_cache()
    {
        HasOutputCache(Endpoint(ContactsRoute)).Should().BeFalse("the contacts route opens the audited factory: no cache");

        // The control proves the check can see a cache: Suffering keeps CacheOutput("AdminLive").
        HasOutputCache(Endpoint(SufferingRoute)).Should().BeTrue("Suffering keeps CacheOutput(\"AdminLive\") (Task 2)");
    }

    [Fact]
    public async Task Suffering_refuses_a_non_platform_admin()
    {
        // A Platform Analyst holds every read module, so only the platform gate can refuse.
        var analyst = Seat(OrganizationType.Platform, OrganizationRole.Analyst, isPlatformAdmin: false);
        var analystAnswer = await Ask(SufferingRoute, null, analyst);
        analystAnswer.Status.Should().Be(StatusCodes.Status403Forbidden);
        Code(analystAnswer.Body).Should().Be("admin_platform_only");
        analystAnswer.Repository.Calls.Should().BeEmpty("nothing is read for a refused caller");

        var fpoOwner = Seat(OrganizationType.FPO, OrganizationRole.Owner, isPlatformAdmin: false);
        var fpoAnswer = await Ask(SufferingRoute, null, fpoOwner);
        fpoAnswer.Status.Should().Be(StatusCodes.Status403Forbidden);
        fpoAnswer.Repository.Calls.Should().BeEmpty();

        // The control: a platform owner is let in and the handler really reads.
        var owner = Seat(OrganizationType.Platform, OrganizationRole.Owner, isPlatformAdmin: true);
        var ownerAnswer = await Ask(SufferingRoute, null, owner);
        ownerAnswer.Status.Should().Be(StatusCodes.Status200OK);
        ownerAnswer.Repository.Calls.Should().Equal(new[] { nameof(IAdminMisRepository.GetSufferingAsync) });
    }

    // ------------------------------------------------------------------
    // Harness (as AdminCompanyMisGateTests)
    // ------------------------------------------------------------------

    private static AdminScope Seat(OrganizationType type, OrganizationRole role, bool isPlatformAdmin) =>
        new(Org, type, role, EntitlementMatrix.For(type, role), IsPlatformAdmin: isPlatformAdmin);

    private static bool HasOutputCache(RouteEndpoint endpoint) =>
        endpoint.Metadata.Any(m => m is IOutputCachePolicy || m is OutputCacheAttribute);

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

    private static async Task<Answer> Ask(string route, string? query, ResolveResult seat)
    {
        var endpoint = Endpoint(route);
        var repository = new RecordingMisRepository();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(new FixedSeatResolver(seat));
        services.AddSingleton(new GetFarmContactsHandler(repository));
        services.AddSingleton(new GetSufferingHandler(repository));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request = { Method = "GET", Path = route, QueryString = new QueryString(query ?? string.Empty) },
            User = new ClaimsPrincipal(new ClaimsIdentity(
                new[] { new Claim("sub", Admin.ToString("D")) }, authenticationType: "Test")),
        };

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

    private sealed record Answer(int Status, string Body, RecordingMisRepository Repository);

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

    private sealed class RecordingMisRepository : IAdminMisRepository
    {
        public List<string> Calls { get; } = new();
        public Guid? ContactsAdminUserId { get; private set; }
        public IReadOnlyCollection<Guid> AskedIds { get; private set; } = Array.Empty<Guid>();

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetFarmContactsAsync));
            ContactsAdminUserId = adminUserId;
            AskedIds = farmIds.ToArray();

            // Farm n is named "Fake Contact Farm n"; even farms have no owner phone on record.
            var answer = farmIds.Select(id =>
            {
                var n = int.Parse(id.ToString("D")[^12..]);
                return new FarmContactDto(
                    id, $"Fake Contact Farm {n}", n % 2 == 0 ? null : $"{n:D10}",
                    Guid.Parse($"a0000000-0000-0000-0000-{n:D12}"));
            }).ToList();
            return Task.FromResult<IReadOnlyList<FarmContactDto>>(answer);
        }

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default)
        {
            Calls.Add(nameof(GetSufferingAsync));
            return Task.FromResult<IReadOnlyList<SufferingItemDto>>(Array.Empty<SufferingItemDto>());
        }

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetFarmsListAsync));
            return Task.FromResult(new FarmsListDto(Array.Empty<FarmSummaryDto>(), 0, page, pageSize));
        }

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetUsersListAsync));
            return Task.FromResult(new UsersListDto(Array.Empty<UserSummaryDto>(), 0, page, pageSize));
        }
    }
}
