// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
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
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using User.Application.Ports.External;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5). The seven People and access routes are for the founder
/// alone. The gates live in the route delegates, so these tests run the production mapping on a hand-made route builder,
/// a fixed seat, and the real handlers over in-memory fakes that count every call. No web server, no database.
/// "Store untouched" = the fake store was never asked anything.
/// </summary>
public sealed class ControlRoomPeopleGateTests
{
    private static readonly Guid Caller = Guid.Parse("99999999-0000-0000-0000-0000000c3a05");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000c3a05");
    private static readonly Guid PersonId = Guid.Parse("c3a50000-0000-0000-0000-000000000001");
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);

    private static readonly (string Method, string Route, string? Body)[] Routes =
    [
        ("GET", "/shramsafal/admin/people", null),
        ("POST", "/shramsafal/admin/people", """{"displayName":"Example: Asha","phone":"9000000051","startingRole":"viewer","ticks":["company_numbers"]}"""),
        ("PUT", $"/shramsafal/admin/people/{PersonId}", """{"displayName":"Example: Asha K","startingRole":"viewer","ticks":["company_numbers"]}"""),
        ("POST", $"/shramsafal/admin/people/{PersonId}/remove", "{}"),
        ("POST", $"/shramsafal/admin/people/{PersonId}/keep", "{}"),
        ("GET", "/shramsafal/admin/people/history?days=7", null),
        ("GET", "/shramsafal/admin/people/trust-report", null),
    ];

    private static AdminScope Founder() =>
        new(Org, OrganizationType.Platform, OrganizationRole.Owner, EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner), IsPlatformAdmin: true);

    private static AdminScope TeamSeatWithEveryTick() =>
        new(Org, OrganizationType.Platform, OrganizationRole.Employee,
            ControlRoomTicks.ModulesFor(ControlRoomTicks.All.Select(t => t.Key)), IsPlatformAdmin: false);

    [Fact]
    public async Task People_routes_refuse_a_team_seat_holding_every_tick()
    {
        Routes.Should().HaveCount(7);
        var team = TeamSeatWithEveryTick();
        team.CanRead(ModuleKey.AdminUsers).Should().BeTrue("the control: this seat really holds the most a team seat can");

        foreach (var (method, route, body) in Routes)
        {
            var answer = await Ask(method, route, body, team);

            answer.Status.Should().Be(StatusCodes.Status403Forbidden, $"{method} {route}");
            Code(answer.Body).Should().Be("control_room.founder_only", $"{method} {route}");
            answer.Fakes.Store.Calls.Should().BeEmpty($"{method} {route}: the store is untouched");
            answer.Fakes.History.Reads.Should().Be(0, $"{method} {route}: nothing is read");
            answer.Fakes.History.Written.Should().BeEmpty($"{method} {route}: nothing is written");
        }
    }

    [Fact]
    public async Task People_routes_refuse_an_fpo_owner_and_an_analyst()
    {
        var seats = new[]
        {
            new AdminScope(Org, OrganizationType.FPO, OrganizationRole.Owner, EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Owner), IsPlatformAdmin: false),
            new AdminScope(Org, OrganizationType.Platform, OrganizationRole.Analyst, EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Analyst), IsPlatformAdmin: false),
        };

        foreach (var seat in seats)
            foreach (var (method, route, body) in Routes)
            {
                var answer = await Ask(method, route, body, seat);
                answer.Status.Should().Be(StatusCodes.Status403Forbidden, $"{seat.OrganizationType} {seat.OrganizationRole}: {method} {route}");
                Code(answer.Body).Should().Be("control_room.founder_only");
                answer.Fakes.Store.Calls.Should().BeEmpty();
            }
    }

    [Fact]
    public async Task People_routes_answer_the_founder()
    {
        var expected = new[] { 200, 201, 200, 200, 200, 200, 200 };
        for (var i = 0; i < Routes.Length; i++)
        {
            var (method, route, body) = Routes[i];
            var answer = await Ask(method, route, body, Founder());
            answer.Status.Should().Be(expected[i], $"{method} {route}: {answer.Body}");
        }

        var list = await Ask("GET", Routes[0].Route, null, Founder());
        using var doc = JsonDocument.Parse(list.Body);
        doc.RootElement.GetProperty("people").GetArrayLength().Should().BeGreaterThan(0);
        doc.RootElement.GetProperty("ticks").GetArrayLength().Should().Be(ControlRoomTicks.All.Count);
        doc.RootElement.GetProperty("presets").GetProperty("field_operator").GetArrayLength().Should().BeGreaterThan(0);
        var first = doc.RootElement.GetProperty("people")[0];
        first.GetProperty("isFounder").GetBoolean().Should().BeTrue("the founder is listed first");
        first.GetProperty("personId").ValueKind.Should().Be(JsonValueKind.Null);
        first.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(new[]
        {
            "personId", "isFounder", "displayName", "phone", "startingRole", "ticks", "boundAccountName", "lastSignedInUtc", "keptAtUtc"
        });

        var history = await Ask("GET", Routes[5].Route, null, Founder());
        using var h = JsonDocument.Parse(history.Body);
        h.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(new[] { "lines", "hitLimit", "limit" });

        var report = await Ask("GET", Routes[6].Route, null, Founder());
        using var r = JsonDocument.Parse(report.Body);
        r.RootElement.GetProperty("downloads").GetProperty("notMeasuredReason").GetString().Should().Be("downloads_start_with_field_visits");
        r.RootElement.GetProperty("downloads").GetProperty("value").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task People_routes_answer_a_refusal_as_code_and_message()
    {
        var bad = await Ask("POST", Routes[1].Route, """{"displayName":"Example: Asha","phone":"123","startingRole":"viewer"}""", Founder());
        bad.Status.Should().Be(StatusCodes.Status400BadRequest);
        Code(bad.Body).Should().Be("control_room.phone_invalid");

        var founderRole = await Ask("POST", Routes[1].Route, """{"displayName":"Example: Asha","phone":"9000000052","startingRole":"founder"}""", Founder());
        founderRole.Status.Should().Be(StatusCodes.Status400BadRequest);
        Code(founderRole.Body).Should().Be("control_room.role_not_allowed");

        var range = await Ask("GET", "/shramsafal/admin/people/history?days=3", null, Founder());
        range.Status.Should().Be(StatusCodes.Status400BadRequest);

        var missing = await Ask("POST", $"/shramsafal/admin/people/{Guid.NewGuid()}/keep", "{}", Founder());
        missing.Status.Should().Be(StatusCodes.Status404NotFound);
        Code(missing.Body).Should().Be("control_room.person_not_found");
    }

    // G1 fix round 1 (M1): a null or blank tick is an unknown tick. Add and change answer 400 control_room.tick_unknown,
    // never 500, and nothing is written.
    [Fact]
    public async Task A_null_tick_is_refused_not_a_500()
    {
        var cases = new (string Method, string Route, string Body)[]
        {
            ("POST", Routes[1].Route, """{"displayName":"Example: Asha","phone":"9000000051","startingRole":"viewer","ticks":[null]}"""),
            ("POST", Routes[1].Route, """{"displayName":"Example: Asha","phone":"9000000051","startingRole":"viewer","ticks":["company_numbers",null]}"""),
            ("POST", Routes[1].Route, """{"displayName":"Example: Asha","phone":"9000000051","startingRole":"viewer","ticks":[""]}"""),
            ("POST", Routes[1].Route, """{"displayName":"Example: Asha","phone":"9000000051","startingRole":"viewer","ticks":["  "]}"""),
            ("PUT", Routes[2].Route, """{"displayName":"Example: Asha K","startingRole":"viewer","ticks":[null]}"""),
            ("PUT", Routes[2].Route, """{"displayName":"Example: Asha K","startingRole":"viewer","ticks":["company_numbers",null]}"""),
            ("PUT", Routes[2].Route, """{"displayName":"Example: Asha K","startingRole":"viewer","ticks":[""]}"""),
        };

        foreach (var (method, route, body) in cases)
        {
            var answer = await Ask(method, route, body, Founder());

            answer.Status.Should().Be(StatusCodes.Status400BadRequest, $"{method} {body}: {answer.Body}");
            Code(answer.Body).Should().Be("control_room.tick_unknown", $"{method} {body}");
            answer.Fakes.Store.Calls.Should().NotContain(new[] { "Add", "AddSeat", "Record", "SaveChangesAsync" },
                $"{method} {body}: nothing is written");
            var asha = answer.Fakes.Store.People.Should().ContainSingle($"{method} {body}: no one is added").Subject;
            asha.DisplayName.Should().Be("Example: Asha", $"{method} {body}: the listed person is unchanged");
            asha.Ticks.Should().Equal(new[] { ControlRoomTicks.CompanyNumbers });
            answer.Fakes.History.Written.Should().BeEmpty();
        }
    }

    // D2: a person is only added to a list. Nothing is texted, and nothing is queued for the console door's background
    // sender (the real queue, Task A6).
    [Fact]
    public async Task Nothing_is_sent_when_a_person_is_added()
    {
        var sms = new CountingSmsSender();
        var queue = new ControlRoomCodeQueue();

        var answer = await Ask("POST", Routes[1].Route, Routes[1].Body, Founder(), sms, queue);

        answer.Status.Should().Be(StatusCodes.Status201Created, answer.Body);
        answer.Fakes.Store.People.Should().ContainSingle(p => p.PhoneE164 == "+919000000051", "the person really was added");
        sms.Sent.Should().Be(0, "adding a person sends no text message");
        queue.Count.Should().Be(0, "adding a person queues no code either");
    }

    // ------------------------------------------------------------------
    // Harness (as AdminFarmContactsGateTests)
    // ------------------------------------------------------------------

    private sealed record Answer(int Status, string Body, Fakes Fakes);

    private sealed record Fakes(RecordingStore Store, RecordingHistory History);

    private static RouteEndpoint Endpoint(string method, string route)
    {
        var path = route.Split('?')[0];
        var routes = new TestRouteBuilder(
            new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));
        routes.MapGroup("/shramsafal").MapControlRoomEndpoints();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => e.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Contains(method)
                && RoutePatternMatches(e.RoutePattern.RawText!, path))
            .ToList();
        matches.Should().ContainSingle($"exactly one {method} {path}");
        return matches[0];
    }

    private static bool RoutePatternMatches(string pattern, string path)
    {
        var p = pattern.Split('/');
        var a = path.Split('/');
        if (p.Length != a.Length) return false;
        for (var i = 0; i < p.Length; i++)
        {
            if (p[i].StartsWith('{')) { if (!Guid.TryParse(a[i], out _)) return false; continue; }
            if (p[i] != a[i]) return false;
        }

        return true;
    }

    private static async Task<Answer> Ask(
        string method, string route, string? body, AdminScope scope, CountingSmsSender? sms = null, ControlRoomCodeQueue? queue = null)
    {
        var endpoint = Endpoint(method, route);
        var store = new RecordingStore();
        var history = new RecordingHistory();
        var directory = new EmptyDirectory();
        var misRepo = new EmptyMisRepository();
        var clock = new FixedClock();

        // A listed person for change / remove / keep, and the founder's own seat.
        var asha = ControlRoomPerson.Add(PersonId, "+919000000061", "Example: Asha", ControlRoomRole.Viewer, [ControlRoomTicks.CompanyNumbers], Caller, Now);
        store.People.Add(asha);
        store.Calls.Clear();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(new FixedSeatResolver(ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>())));
        services.AddSingleton<ISmsSender>(sms ?? new CountingSmsSender());
        services.AddSingleton(queue ?? new ControlRoomCodeQueue());
        services.AddSingleton(new ListPeopleHandler(store, directory, history));
        services.AddSingleton(new AddPersonHandler(store, directory, clock));
        services.AddSingleton(new ChangePersonHandler(store, clock));
        services.AddSingleton(new RemovePersonHandler(store, clock, new RecordingDoorSessions()));
        services.AddSingleton(new KeepPersonHandler(store, clock));
        services.AddSingleton(new GetHistoryHandler(store, directory, history, misRepo, CompanyMisExclusions.None, clock));
        services.AddSingleton(new GetTrustReportHandler(store, directory, history, misRepo, CompanyMisExclusions.None, clock));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
            Response = { Body = new MemoryStream() },
            Request =
            {
                Method = method,
                Path = route.Split('?')[0],
                QueryString = route.Contains('?') ? new QueryString("?" + route.Split('?')[1]) : QueryString.Empty,
            },
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", Caller.ToString("D")) }, authenticationType: "Test")),
        };

        if (body is not null)
        {
            ctx.Features.Set<Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature>(new BodyFeature());
            ctx.Request.ContentType = "application/json";
            ctx.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
            ctx.Request.ContentLength = ctx.Request.Body.Length;
        }

        // Route values for {id:guid}.
        var segments = ctx.Request.Path.Value!.Split('/');
        var pattern = endpoint.RoutePattern.RawText!.Split('/');
        for (var i = 0; i < pattern.Length; i++)
            if (pattern[i].StartsWith("{id")) ctx.Request.RouteValues["id"] = segments[i];

        ctx.SetEndpoint(endpoint);
        await endpoint.RequestDelegate!(ctx);
        await ctx.Response.Body.FlushAsync();

        ctx.Response.Body.Position = 0;
        using var reader = new StreamReader(ctx.Response.Body);
        return new Answer(ctx.Response.StatusCode, await reader.ReadToEndAsync(), new Fakes(store, history));
    }

    private static string Code(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("code", out var code)
            ? code.GetString() ?? "(null)"
            : "(no code in the body)";
    }

    private sealed class BodyFeature : Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature
    {
        public bool CanHaveBody => true;
    }

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => Now;
    }

    private sealed class CountingSmsSender : ISmsSender
    {
        public int Sent { get; private set; }

        public Task<Result<SmsDispatchReceipt>> SendOtpAsync(string phoneNumberInternational, string otpCode, CancellationToken cancellationToken = default)
        {
            Sent++;
            return Task.FromResult(Result.Success(new SmsDispatchReceipt("fake", "fake")));
        }

        public Task<Result<SmsDispatchReceipt>> SendCodeWithTemplateAsync(string phoneNumberInternational, string code, string templateId, CancellationToken cancellationToken = default)
        {
            Sent++;
            return Task.FromResult(Result.Success(new SmsDispatchReceipt("fake", "fake")));
        }
    }

    private sealed class RecordingStore : IControlRoomStore
    {
        public List<string> Calls { get; } = [];
        public List<ControlRoomPerson> People { get; } = [];
        private readonly Guid _founderUser = Guid.Parse("00000000-0000-0000-0000-0000000000f1");

        public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct)
        {
            Calls.Add(nameof(FindActiveByPhoneAsync));
            return Task.FromResult(People.FirstOrDefault(p => p.IsActive && p.PhoneE164 == phoneE164));
        }

        public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct)
        {
            Calls.Add(nameof(FindActiveByUserAsync));
            return Task.FromResult(People.FirstOrDefault(p => p.IsActive && p.UserId == userId));
        }

        public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct)
        {
            Calls.Add(nameof(GetAsync));
            return Task.FromResult(People.FirstOrDefault(p => p.Id == personId));
        }

        public Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct)
        {
            Calls.Add(nameof(ListActiveAsync));
            return Task.FromResult<IReadOnlyList<ControlRoomPerson>>(People.Where(p => p.IsActive).ToList());
        }

        public Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct)
        {
            Calls.Add(nameof(PlatformOrganizationIdAsync));
            return Task.FromResult(Org);
        }

        public Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct)
        {
            Calls.Add(nameof(PlatformOwnerUserIdsAsync));
            return Task.FromResult<IReadOnlyList<Guid>>([_founderUser]);
        }

        public Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct)
        {
            Calls.Add(nameof(ActivePlatformSeatOfAsync));
            return Task.FromResult<OrganizationMembership?>(null);
        }

        public void Add(ControlRoomPerson person)
        {
            Calls.Add(nameof(Add));
            People.Add(person);
        }

        public void AddSeat(OrganizationMembership seat) => Calls.Add(nameof(AddSeat));

        public void Record(ControlRoomHistoryEntry entry) => Calls.Add(nameof(Record));

        public Task SaveChangesAsync(CancellationToken ct)
        {
            Calls.Add(nameof(SaveChangesAsync));
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingHistory : IControlRoomHistory
    {
        public int Reads { get; private set; }
        public List<ControlRoomHistoryEntry> Written { get; } = [];

        public Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct)
        {
            Written.Add(entry);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct)
        {
            Reads++;
            return Task.FromResult<IReadOnlyDictionary<Guid, DateTime>>(new Dictionary<Guid, DateTime>());
        }

        public Task<HistoryRead> ReadAsync(Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct)
        {
            Reads++;
            return Task.FromResult(new HistoryRead([], false));
        }

        public Task<DateTime?> FirstRecordedAtAsync(Guid readerUserId, CancellationToken ct)
        {
            Reads++;
            return Task.FromResult<DateTime?>(null);
        }
    }

    /// <summary>Fix wave S-A4: records whose console sessions a removal ended; ends none.</summary>
    private sealed class RecordingDoorSessions : IControlRoomDoorSessions
    {
        public List<Guid> Ended { get; } = [];

        public Task<int> EndDoorSessionsAsync(Guid userId, DateTime utcNow, CancellationToken ct)
        {
            Ended.Add(userId);
            return Task.FromResult(0);
        }
    }

    private sealed class EmptyDirectory : IControlRoomPhoneDirectory
    {
        public Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct) => Task.FromResult<ControlRoomAccount?>(null);

        public Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult<ControlRoomAccount?>(new ControlRoomAccount(userId, "9000000001", "Example: Founder"));
    }

    private sealed class EmptyMisRepository : IAdminMisRepository
    {
        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<FarmNameDto>> GetFarmNamesAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyDictionary<Guid, Guid>> GetFarmOwnersAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmsListDto> GetFarmsListAsync(Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class FixedSeatResolver(ResolveResult result) : IEntitlementResolver
    {
        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct) => Task.FromResult(result);
    }

    private sealed class TestRouteBuilder(IServiceProvider services) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = services;

        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();

        public IApplicationBuilder CreateApplicationBuilder() => new ApplicationBuilder(ServiceProvider);
    }

    private sealed class RouteBuildingServices(IServiceProvider inner) : IServiceProvider, Microsoft.Extensions.DependencyInjection.IServiceProviderIsService
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(Microsoft.Extensions.DependencyInjection.IServiceProviderIsService) ? this : inner.GetService(serviceType);

        public bool IsService(Type serviceType) => serviceType.IsInterface || serviceType.Name.EndsWith("Handler", StringComparison.Ordinal);
    }
}
