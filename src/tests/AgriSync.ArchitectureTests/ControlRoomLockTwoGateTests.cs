// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4)
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using AgriSync.Bootstrapper;
using AgriSync.Bootstrapper.Composition;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Admin.GetAppVersions;
using ShramSafal.Application.UseCases.Admin.GetCohortPatterns;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
using ShramSafal.Application.UseCases.Admin.GetFarmerHealth;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Application.UseCases.Admin.GetSilentChurn;
using ShramSafal.Application.UseCases.Admin.GetSuffering;
using ShramSafal.Application.UseCases.Admin.GetUsersList;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Subscriptions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4). Lock 2 of every company route: the module tick, then the
/// Platform seat (an FPO owner holds some of the same modules and is refused), and farmers' phone numbers behind the
/// <c>farmer_phones</c> tick. The gates live in the route delegates, so these tests run them: the production mappings on
/// a hand-made route builder, a fixed seat in place of the resolver, the real handlers over ports that record what they
/// were asked. No web server (except the cache and History-failure tests, an in-memory one), no database.
///
/// <para>
/// Made-up ids and one obviously fake phone number (<c>9000001234</c>). The silent-farms list needs a relational context
/// to reach its phones; its phone rule is proved on a real database
/// (<c>SilentFarmsRealPostgresTests</c>).
/// </para>
/// </summary>
public sealed class ControlRoomLockTwoGateTests
{
    private const string Phone = "9000001234";
    private const string Hidden = "**redacted**";

    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000a4001");
    private static readonly Guid Org = Guid.Parse("a0000000-0000-0000-0000-0000000a4001");
    private static readonly Guid Farm1 = Guid.Parse("a4f10000-0000-0000-0000-000000000001");
    private static readonly Guid Person = Guid.Parse("b0000000-0000-0000-0000-0000000a4001");

    /// <summary>06:30 UTC on 14 Nov 2026 = 12:00 India time.</summary>
    private static readonly DateTime Now = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    /// <summary>One company route: where it is, what opens it, and whether an FPO owner holds that module.</summary>
    public sealed record RouteCase(
        string Name, string Pattern, string Path, string Query, string Tick, string Module, bool FpoOwnerHoldsModule)
    {
        public override string ToString() => Name;
    }

    private static readonly RouteCase[] Cases =
    [
        new("voice-check", "/shramsafal/admin/ops/voice-check", "/shramsafal/admin/ops/voice-check", "",
            ControlRoomTicks.ServerHealth, ModuleKey.OpsLive, false),
        new("wvfd", "/shramsafal/admin/metrics/wvfd", "/shramsafal/admin/metrics/wvfd", "?weeks=4",
            ControlRoomTicks.CompanyNumbers, ModuleKey.MetricsNsm, true),
        new("farms", "/shramsafal/admin/farms", "/shramsafal/admin/farms", "?page=1&pageSize=20",
            ControlRoomTicks.AllFarms, ModuleKey.FarmsList, true),
        new("contacts", "/shramsafal/admin/farms/contacts", "/shramsafal/admin/farms/contacts", $"?ids={Farm1:D}",
            ControlRoomTicks.AllFarms, ModuleKey.FarmsList, true),
        new("silent-churn", "/shramsafal/admin/farms/silent-churn", "/shramsafal/admin/farms/silent-churn", "",
            ControlRoomTicks.FarmsToCall, ModuleKey.FarmsSilentChurn, true),
        new("suffering", "/shramsafal/admin/farms/suffering", "/shramsafal/admin/farms/suffering", "",
            ControlRoomTicks.FarmsToCall, ModuleKey.FarmsSuffering, true),
        new("users", "/shramsafal/admin/users", "/shramsafal/admin/users", "?page=1&pageSize=20",
            ControlRoomTicks.Users, ModuleKey.AdminUsers, false),
        new("mis-company", "/shramsafal/admin/mis/company", "/shramsafal/admin/mis/company", "",
            ControlRoomTicks.CompanyNumbers, ModuleKey.MetricsNsm, true),
        new("cohort", "/admin/farmer-health/cohort", "/admin/farmer-health/cohort", "",
            ControlRoomTicks.FarmerHealth, ModuleKey.FarmerHealth, false),
        new("farmer-health", "/admin/farmer-health/{farmId:guid}", $"/admin/farmer-health/{Farm1:D}", "",
            ControlRoomTicks.FarmerHealth, ModuleKey.FarmerHealth, false),
    ];

    private static RouteCase Case(string name) => Cases.Single(c => c.Name == name);

    public static TheoryData<string> AllRoutes => new(Cases.Select(c => c.Name));

    public static TheoryData<string> PhoneRoutes => new("farms", "users", "contacts", "farmer-health");

    public static TheoryData<string> FpoPlatformOnlyRoutes => new(Cases.Where(c => c.FpoOwnerHoldsModule).Select(c => c.Name));

    public static TheoryData<string> FpoNoModuleRoutes => new(Cases.Where(c => !c.FpoOwnerHoldsModule).Select(c => c.Name));

    // ------------------------------------------------------------------
    // Lock 2: the module tick, then the Platform seat
    // ------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AllRoutes))]
    public async Task Every_company_route_refuses_a_team_seat_without_its_tick(string name)
    {
        var c = Case(name);
        var ports = new Ports();

        // visits.mine opens none of the company modules.
        var answer = await Ask(c, TeamSeat(ControlRoomTicks.MyVisits), ports);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden, answer.Body);
        Code(answer.Body).Should().Be("admin_module_forbidden");
        ports.Calls.Should().Be(0, "nothing is read for a refused seat");
        answer.History.Entries.Should().BeEmpty();
    }

    [Theory]
    [MemberData(nameof(AllRoutes))]
    public async Task Every_company_route_answers_a_team_seat_with_its_tick(string name)
    {
        var c = Case(name);
        var ports = new Ports();
        var seat = TeamSeat(c.Tick);
        seat.CanRead(c.Module).Should().BeTrue("the tick opens the module");
        seat.IsPlatformAdmin.Should().BeFalse("this is a team seat, not the founder");

        var answer = await Ask(c, seat, ports);

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        ports.Calls.Should().BeGreaterThan(0, "the handler was reached and read");
    }

    [Theory]
    [MemberData(nameof(FpoPlatformOnlyRoutes))]
    public async Task An_fpo_owner_is_still_refused_the_company_lists(string name)
    {
        var c = Case(name);
        var ports = new Ports();
        var fpoOwner = FpoOwner();
        fpoOwner.CanRead(c.Module).Should().BeTrue("this is the seat the case is about: it holds the module");

        var answer = await Ask(c, fpoOwner, ports);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden, answer.Body);
        Code(answer.Body).Should().Be("admin_platform_only");
        ports.Calls.Should().Be(0);
        answer.Body.Should().NotContain(Phone);
    }

    [Theory]
    [MemberData(nameof(FpoNoModuleRoutes))]
    public async Task An_fpo_owner_without_the_module_is_refused_by_the_module(string name)
    {
        var c = Case(name);
        var ports = new Ports();
        var fpoOwner = FpoOwner();
        fpoOwner.CanRead(c.Module).Should().BeFalse("an FPO owner does not hold this module");

        var answer = await Ask(c, fpoOwner, ports);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden, answer.Body);
        Code(answer.Body).Should().Be("admin_module_forbidden");
        ports.Calls.Should().Be(0);
    }

    [Theory]
    [InlineData("cohort")]
    [InlineData("farmer-health")]
    public async Task A_non_platform_seat_holding_farmer_health_is_refused_the_cross_farm_pages(string name)
    {
        var c = Case(name);
        var ports = new Ports();
        var fpoWithTick = new AdminScope(
            Org, OrganizationType.FPO, OrganizationRole.Owner, ControlRoomTicks.ModulesFor([ControlRoomTicks.FarmerHealth]),
            IsPlatformAdmin: false);
        fpoWithTick.CanRead(ModuleKey.FarmerHealth).Should().BeTrue("the seat holds the module; only the Platform-seat gate refuses");

        var answer = await Ask(c, fpoWithTick, ports);

        answer.Status.Should().Be(StatusCodes.Status403Forbidden, answer.Body);
        Code(answer.Body).Should().Be("admin_platform_only");
        ports.Calls.Should().Be(0);
    }

    // spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4, AM7): the route maps the seat to who may read names.
    [Fact]
    public async Task App_versions_shows_counts_but_hides_names_without_all_farms()
    {
        var ops = new AppVersionsOps();

        // The Viewer preset: company_numbers and server_health.
        var answer = await AskAppVersions(TeamSeat(ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth), ops);

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        using var doc = JsonDocument.Parse(answer.Body);
        var data = doc.RootElement.GetProperty("data");
        data.GetProperty("versions").GetArrayLength().Should().Be(2);
        data.GetProperty("onOlderVersions").GetArrayLength().Should().Be(0);
        data.GetProperty("onOlderVersionsHiddenReason").GetString().Should().Be("needs_all_farms");
        ops.NameCalls.Should().Be(0, "no name is read");
        ops.FarmNameCalls.Should().Be(0, "the cross-farm factory is not opened");
        answer.Body.Should().NotContain("Example Ramesh");
    }

    [Fact]
    public async Task App_versions_names_people_with_all_farms()
    {
        var ops = new AppVersionsOps();

        var answer = await AskAppVersions(TeamSeat(ControlRoomTicks.ServerHealth, ControlRoomTicks.AllFarms), ops);

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        using var doc = JsonDocument.Parse(answer.Body);
        var data = doc.RootElement.GetProperty("data");
        data.GetProperty("onOlderVersions").EnumerateArray().Select(p => p.GetProperty("name").GetString())
            .Should().Equal("Example Ramesh");
        data.GetProperty("onOlderVersionsHiddenReason").ValueKind.Should().Be(JsonValueKind.Null);
        ops.NameCalls.Should().Be(1);
    }

    [Fact]
    public async Task Contacts_are_opened_by_any_of_the_three_farm_modules_and_not_by_visits_assign()
    {
        var c = Case("contacts");
        foreach (var tick in new[] { ControlRoomTicks.AllFarms, ControlRoomTicks.FarmsToCall })
        {
            var ports = new Ports();
            var answer = await Ask(c, TeamSeat(tick), ports);
            answer.Status.Should().Be(StatusCodes.Status200OK, $"{tick}: {answer.Body}");
            ports.Calls.Should().Be(1);
        }

        var refusedPorts = new Ports();
        var refused = await Ask(c, TeamSeat(ControlRoomTicks.GiveVisits), refusedPorts);
        refused.Status.Should().Be(StatusCodes.Status403Forbidden, "K21: visits.assign is not a farm-name module");
        Code(refused.Body).Should().Be("admin_module_forbidden");
        refusedPorts.Calls.Should().Be(0);
    }

    // ------------------------------------------------------------------
    // H10: no route answers a seat that needs a door session
    // ------------------------------------------------------------------

    [Fact]
    public async Task Every_company_route_refuses_a_seat_that_needs_a_door_session()
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        routes.MapAdminFarmerHealth();

        var endpoints = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText != "/shramsafal/admin/me/scope")
            .ToList();
        endpoints.Should().NotBeEmpty();
        endpoints.Select(e => e.RoutePattern.RawText).Should().Contain(Cases.Select(c => c.Pattern),
            "every company route is among the enumerated routes");

        var allTicks = ControlRoomTicks.All.Select(t => t.Key).ToArray();
        var doorSeat = TeamSeat(allTicks) with { DoorSessionRequired = true };

        foreach (var endpoint in endpoints)
        {
            // Every handler the route asks for is an object that was never constructed: any call into one fails the test.
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IEntitlementResolver>(new FixedSeatResolver(doorSeat));
            RegisterUnconstructedHandlers(services, endpoint);

            var ctx = NewContext(
                services.BuildServiceProvider(), endpoint, "GET", endpoint.RoutePattern.RawText!,
                "?page=1&pageSize=20&weeks=4&days=7&minutes=10&hours=24&limit=20&ids=" + Farm1.ToString("D"));
            foreach (var parameter in endpoint.RoutePattern.Parameters)
            {
                ctx.Request.RouteValues[parameter.Name] = Farm1.ToString("D");
            }

            await endpoint.RequestDelegate!(ctx);
            var (status, body) = await ReadAsync(ctx);

            var route = endpoint.RoutePattern.RawText;
            status.Should().Be(StatusCodes.Status401Unauthorized, $"{route}: {body}");
            Code(body).Should().Be("control_room.door_session_required", route);
        }
    }

    // ------------------------------------------------------------------
    // Phones: hidden without the tick, shown and recorded with it
    // ------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(PhoneRoutes))]
    public async Task Phones_are_hidden_without_the_phone_tick(string name)
    {
        var c = Case(name);
        var ports = new Ports();

        var answer = await Ask(c, TeamSeat(c.Tick), ports);

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        answer.Body.Should().NotContain(Phone, "the fake's phone digits appear nowhere in the body");
        var phones = PhoneFields(c, answer.Body);
        phones.Should().NotBeEmpty("the answer carries the phone field");
        phones.Should().OnlyContain(p => p == Hidden, "every phone field equals the hidden marker");
        answer.History.Entries.Should().BeEmpty("no phone was sent, so no phone look is written");
    }

    [Theory]
    [MemberData(nameof(PhoneRoutes))]
    public async Task Phones_are_shown_and_recorded_with_the_phone_tick(string name)
    {
        var c = Case(name);
        var ports = new Ports();
        var person = ControlRoomPerson.Add(
            Person, "+919000000099", "Example Teammate", ControlRoomRole.Admin,
            [c.Tick, ControlRoomTicks.FarmerPhones], Admin, Now);

        var answer = await Ask(c, TeamSeat(c.Tick, ControlRoomTicks.FarmerPhones), ports, person);

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        PhoneFields(c, answer.Body).Should().Equal(new[] { Phone });

        var entry = answer.History.Entries.Should().ContainSingle("exactly one phones_shown row").Subject;
        entry.Action.Should().Be(ControlRoomHistoryAction.PhonesShown);
        entry.ActorUserId.Should().Be(Admin);
        entry.SubjectId.Should().Be(Person, "the subject is the reader's active person id (K10)");
        if (name == "users")
        {
            ControlRoomPhoneFakesJson.Get<int>(entry.Payload, "personCount").Should().Be(1);
            ControlRoomPhoneFakesJson.Get<int>(entry.Payload, "count").Should().Be(1);
        }
        else
        {
            ControlRoomPhoneFakesJson.FarmIds(entry.Payload).Should().Equal(new[] { Farm1 }, "the row names the farm whose phone was sent");
            ControlRoomPhoneFakesJson.Get<int>(entry.Payload, "count").Should().Be(1);
        }
    }

    [Theory]
    [MemberData(nameof(PhoneRoutes))]
    public async Task The_founder_has_no_person_row_so_the_subject_is_his_own_user_id(string name)
    {
        var c = Case(name);

        var answer = await Ask(c, FounderSeat(), new Ports());

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        PhoneFields(c, answer.Body).Should().Equal(new[] { Phone });
        answer.History.Entries.Should().ContainSingle().Which.SubjectId.Should().Be(Admin);
    }

    [Fact]
    public async Task A_farm_with_no_phone_on_record_writes_no_history_row()
    {
        var c = Case("contacts");
        var ports = new Ports { PhoneOnRecord = null };

        var answer = await Ask(c, FounderSeat(), ports);

        answer.Status.Should().Be(StatusCodes.Status200OK, answer.Body);
        answer.History.Entries.Should().BeEmpty("a blank phone is not a real phone");
    }

    [Fact]
    public async Task Users_search_does_not_match_phone_digits_without_the_phone_tick()
    {
        var c = Case("users");

        // A seat with the users tick and no phone tick: the digits find nobody, and the repository was told not to match phones.
        var without = new Ports();
        var refused = await Ask(c with { Query = $"?page=1&pageSize=20&search={Phone}" }, TeamSeat(ControlRoomTicks.Users), without);

        refused.Status.Should().Be(StatusCodes.Status200OK, refused.Body);
        without.LastMatchPhone.Should().BeFalse();
        using (var doc = JsonDocument.Parse(refused.Body))
        {
            doc.RootElement.GetProperty("data").GetProperty("items").GetArrayLength().Should().Be(0);
            doc.RootElement.GetProperty("data").GetProperty("totalCount").GetInt32().Should().Be(0);
        }

        refused.Body.Should().NotContain(Phone);
        refused.History.Entries.Should().BeEmpty();

        // With the phone tick the row is found, and its phone look is written.
        var with = new Ports();
        var found = await Ask(
            c with { Query = $"?page=1&pageSize=20&search={Phone}" },
            TeamSeat(ControlRoomTicks.Users, ControlRoomTicks.FarmerPhones), with);

        found.Status.Should().Be(StatusCodes.Status200OK, found.Body);
        with.LastMatchPhone.Should().BeTrue();
        PhoneFields(c, found.Body).Should().Equal(new[] { Phone });
        found.History.Entries.Should().ContainSingle().Which.Action.Should().Be(ControlRoomHistoryAction.PhonesShown);
    }

    [Theory]
    [MemberData(nameof(PhoneRoutes))]
    public async Task A_history_failure_sends_no_phone(string name)
    {
        var c = Case(name);
        var ports = new Ports();
        using var host = await StartHostAsync(ports, new RecordingControlRoomHistory { Throw = true },
            new FixedControlRoomStore(), ("founder", Admin, FounderSeat()));

        var client = host.GetTestClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, c.Path + c.Query);
        request.Headers.Authorization = new("Bearer", "founder");
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        ((int)response.StatusCode).Should().Be(StatusCodes.Status500InternalServerError);
        body.Should().NotContain(Phone, "the phone is sent only after its History row is written");
    }

    // ------------------------------------------------------------------
    // Review Focus 2 / D1: an authenticated admin answer is never served from the cache
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_authenticated_admin_answer_is_never_served_from_the_cache()
    {
        var ports = new Ports();
        var phoneless = TeamSeat(ControlRoomTicks.AllFarms);
        var teamUser = Guid.Parse("99999999-0000-0000-0000-0000000a4002");
        using var host = await StartHostAsync(ports, new RecordingControlRoomHistory(), new FixedControlRoomStore(),
            ("founder", Admin, FounderSeat()), ("team", teamUser, phoneless));
        var client = host.GetTestClient();

        async Task<string> GetAs(string token)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/shramsafal/admin/farms?page=1&pageSize=20");
            request.Headers.Authorization = new("Bearer", token);
            var response = await client.SendAsync(request);
            response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
            return await response.Content.ReadAsStringAsync();
        }

        var first = await GetAs("founder");
        var second = await GetAs("team");

        first.Should().Contain(Phone, "the founder is served the phone (this proves the test can see one)");
        second.Should().NotContain(Phone, "the phone-less seat is never served the founder's cached answer");
        ports.Calls.Should().Be(2, "both requests reached the handler: neither was answered from the output cache");
    }

    // ------------------------------------------------------------------
    // Harness (as AdminCompanyMisGateTests)
    // ------------------------------------------------------------------

    private static AdminScope TeamSeat(params string[] ticks) =>
        new(Org, OrganizationType.Platform, OrganizationRole.Employee, ControlRoomTicks.ModulesFor(ticks), IsPlatformAdmin: false);

    private static AdminScope FounderSeat() =>
        new(Org, OrganizationType.Platform, OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner), IsPlatformAdmin: true);

    private static AdminScope FpoOwner() =>
        new(Org, OrganizationType.FPO, OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Owner), IsPlatformAdmin: false);

    private static TestRouteBuilder NewRouteBuilder() =>
        new(new RouteBuildingServices(new ServiceCollection().AddLogging().BuildServiceProvider()));

    private static RouteEndpoint EndpointOf(RouteCase c)
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        routes.MapAdminFarmerHealth();

        var matches = routes.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, c.Pattern, StringComparison.Ordinal))
            .ToList();

        matches.Should().ContainSingle($"the admin routes must map exactly one {c.Pattern}");
        return matches[0];
    }

    private static async Task<Answer> Ask(RouteCase c, AdminScope scope, Ports ports, ControlRoomPerson? person = null)
    {
        var endpoint = EndpointOf(c);
        var history = new RecordingControlRoomHistory();
        var store = new FixedControlRoomStore(person);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(
            new FixedSeatResolver(scope));
        AddHandlers(services, ports, history, store);

        var ctx = NewContext(services.BuildServiceProvider(), endpoint, "GET", c.Path, c.Query);
        foreach (var parameter in endpoint.RoutePattern.Parameters)
        {
            ctx.Request.RouteValues[parameter.Name] = Farm1.ToString("D");
        }

        await endpoint.RequestDelegate!(ctx);
        var (status, body) = await ReadAsync(ctx);
        return new Answer(status, body, history);
    }

    private static async Task<Answer> AskAppVersions(AdminScope scope, AppVersionsOps ops)
    {
        const string route = "/shramsafal/admin/ops/app-versions";
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        var endpoint = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == route);

        var history = new RecordingControlRoomHistory();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEntitlementResolver>(new FixedSeatResolver(scope));
        AddHandlers(services, new Ports(), history, new FixedControlRoomStore(), ops);

        var ctx = NewContext(services.BuildServiceProvider(), endpoint, "GET", route, "?days=7");
        await endpoint.RequestDelegate!(ctx);
        var (status, body) = await ReadAsync(ctx);
        return new Answer(status, body, history);
    }

    private static DefaultHttpContext NewContext(
        IServiceProvider services, RouteEndpoint endpoint, string method, string path, string query)
    {
        var ctx = new DefaultHttpContext
        {
            RequestServices = services,
            Response = { Body = new MemoryStream() },
            Request = { Method = method, Path = path, QueryString = new QueryString(query) },
            User = new ClaimsPrincipal(new ClaimsIdentity(
                new[] { new Claim("sub", Admin.ToString("D")) }, authenticationType: "Test")),
        };
        ctx.SetEndpoint(endpoint);
        return ctx;
    }

    private static async Task<(int Status, string Body)> ReadAsync(HttpContext ctx)
    {
        await ctx.Response.Body.FlushAsync();
        ctx.Response.Body.Position = 0;
        using var streamReader = new StreamReader(ctx.Response.Body);
        return (ctx.Response.StatusCode, await streamReader.ReadToEndAsync());
    }

    /// <summary>The real handlers over one recording set of ports.</summary>
    private static void AddHandlers(
        IServiceCollection services, Ports ports, RecordingControlRoomHistory history, FixedControlRoomStore store,
        AppVersionsOps? appOps = null)
    {
        var ops = appOps ?? new AppVersionsOps();
        var clock = new FixedClock(Now);
        services.AddSingleton(new GetVoiceCheckHandler(ports, CompanyMisExclusions.None, clock));
        services.AddSingleton(new GetWvfdHistoryHandler(ports, CompanyMisExclusions.None, clock));
        services.AddSingleton(new GetFarmsListHandler(ports, history, store));
        services.AddSingleton(new GetFarmContactsHandler(ports, history, store));
        services.AddSingleton(new GetSilentChurnHandler(
            ports, ports, ports, history, store,
            new DbContext(new DbContextOptionsBuilder<DbContext>().Options), CompanyMisExclusions.None, clock));
        services.AddSingleton(new GetSufferingHandler(ports));
        services.AddSingleton(new GetUsersListHandler(ports, history, store));
        services.AddSingleton(new GetCompanyMisHandler(ports, ops, CompanyMisExclusions.None, clock));
        services.AddSingleton(new GetFarmerHealthHandler(ports, new PassThroughRedactor(), new NoAuditEmitter(), history, store));
        services.AddSingleton(new GetCohortPatternsHandler(ports, new PassThroughRedactor(), new NoAuditEmitter()));
        services.AddSingleton(new GetAppVersionsHandler(ops, clock));
    }

    /// <summary>Registers, for every class a route asks for, an instance that was never constructed.</summary>
    private static void RegisterUnconstructedHandlers(IServiceCollection services, RouteEndpoint endpoint)
    {
        var method = endpoint.Metadata.GetMetadata<MethodInfo>();
        method.Should().NotBeNull($"{endpoint.RoutePattern.RawText} is a delegate route");

        foreach (var parameter in method!.GetParameters())
        {
            var type = parameter.ParameterType;
            if (type.IsValueType || type == typeof(string) || type == typeof(HttpContext)
                || type == typeof(CancellationToken) || type == typeof(IEntitlementResolver)
                || type == typeof(ILoggerFactory) || type.IsInterface || type.IsAbstract)
            {
                continue;
            }

            services.AddSingleton(type, RuntimeHelpers.GetUninitializedObject(type));
        }
    }

    private static IReadOnlyList<string?> PhoneFields(RouteCase c, string body)
    {
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        return c.Name switch
        {
            "farms" => root.GetProperty("data").GetProperty("items").EnumerateArray()
                .Select(i => i.GetProperty("ownerPhone").GetString()).ToList(),
            "users" => root.GetProperty("data").GetProperty("items").EnumerateArray()
                .Select(i => i.GetProperty("phone").GetString()).ToList(),
            "contacts" => root.EnumerateArray().Select(i => i.GetProperty("ownerPhone").GetString()).ToList(),
            "farmer-health" => [root.GetProperty("phone").GetString()],
            _ => throw new ArgumentOutOfRangeException(nameof(c)),
        };
    }

    private static string Code(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("code", out var code)
            ? code.GetString() ?? "(null)"
            : "(no code in the body)";
    }

    /// <summary>
    /// An in-memory server with the real <see cref="AdminOutputCacheConfig.AddAdminOutputCachePolicies"/>, the output cache
    /// before authentication as in <c>Program.cs</c>, and a bearer token that names a user and a seat.
    /// </summary>
    private static async Task<IHost> StartHostAsync(
        Ports ports, RecordingControlRoomHistory history, FixedControlRoomStore store,
        params (string Token, Guid UserId, AdminScope Scope)[] users)
    {
        var routes = NewRouteBuilder();
        routes.MapGroup("/shramsafal").MapAdminEndpoints();
        routes.MapAdminFarmerHealth();
        var endpoints = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>().ToList();

        var byToken = users.ToDictionary(u => u.Token, u => u.UserId);
        var byUser = users.ToDictionary(u => u.UserId, u => u.Scope);

        return await new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddLogging();
                    services.AddRouting();
                    services.AddProblemDetails();
                    services.AddExceptionHandler<GlobalExceptionHandler>();
                    services.AddOutputCache(opts => opts.AddAdminOutputCachePolicies());
                    services.AddAuthentication("Test")
                        .AddScheme<AuthenticationSchemeOptions, BearerTokenHandler>("Test", _ => { });
                    services.AddAuthorization();
                    services.AddSingleton(byToken);
                    services.AddSingleton<IEntitlementResolver>(new SeatByUserResolver(byUser));
                    foreach (var endpoint in endpoints)
                    {
                        RegisterUnconstructedHandlers(services, endpoint);
                    }

                    AddHandlers(services, ports, history, store);
                })
                .Configure(app =>
                {
                    // The order of Program.cs: the output cache sits before authentication.
                    app.UseExceptionHandler();
                    app.UseRouting();
                    app.UseOutputCache();
                    app.UseAuthentication();
                    app.UseAuthorization();
                    app.UseEndpoints(e =>
                    {
                        e.MapGroup("/shramsafal").MapAdminEndpoints();
                        e.MapAdminFarmerHealth();
                    });
                }))
            .StartAsync();
    }

    private sealed record Answer(int Status, string Body, RecordingControlRoomHistory History);

    private sealed class BearerTokenHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
        Dictionary<string, Guid> tokens)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var header = Request.Headers.Authorization.ToString();
            if (!header.StartsWith("Bearer ", StringComparison.Ordinal)
                || !tokens.TryGetValue(header["Bearer ".Length..], out var userId))
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            var principal = new ClaimsPrincipal(new ClaimsIdentity(
                new[] { new Claim("sub", userId.ToString("D")) }, "Test"));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, "Test")));
        }
    }

    private sealed class SeatByUserResolver(Dictionary<Guid, AdminScope> seats) : IEntitlementResolver
    {
        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct) =>
            Task.FromResult(seats.TryGetValue(userId.Value, out var scope)
                ? ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>())
                : ResolveResult.Unauthorized());
    }

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

    private sealed class FixedSeatResolver(AdminScope scope) : IEntitlementResolver
    {
        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct) =>
            Task.FromResult(ResolveResult.Resolved(scope, Array.Empty<MembershipSummary>()));
    }

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
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

    /// <summary>
    /// The ops reads the company handlers use: when app.seen rows began (Company MIS), and the app-versions reads, counting
    /// how many times the people-reading ones were called. Everything else throws.
    /// </summary>
    private sealed class AppVersionsOps : IAdminOpsRepository
    {
        private static readonly Guid Sunita = Guid.Parse("a4a00000-0000-0000-0000-000000000001");
        private static readonly Guid Ramesh = Guid.Parse("a4a00000-0000-0000-0000-000000000002");

        public int NameCalls { get; private set; }

        public int FarmNameCalls { get; private set; }

        public Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default) =>
            Task.FromResult<DateTime?>(Now.AddDays(-6));

        public Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AppSeenRow>>(
                [new AppSeenRow(Sunita, "1.0.18", Now.AddHours(-1)), new AppSeenRow(Ramesh, "1.0.17", Now.AddDays(-2))]);

        public Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            Task.FromResult(new SignInDevices(2, 0, 0));

        public Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
            IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            NameCalls++;
            return Task.FromResult<IReadOnlyDictionary<Guid, string?>>(
                new Dictionary<Guid, string?> { [Ramesh] = "Example Ramesh" });
        }

        public Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            FarmNameCalls++;
            return Task.FromResult<IReadOnlyDictionary<Guid, IReadOnlyList<string>>>(
                new Dictionary<Guid, IReadOnlyList<string>> { [Ramesh] = ["Example Farm"] });
        }

        public Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default) => throw new NotSupportedException();

        public Task<OpsErrorsPageDto> GetErrorsPagedAsync(
            int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// Every port the company routes read through, in one recorder. Each read counts as one call. The farm, the user and
    /// the drilldown carry <see cref="Phone"/>; the company readers list no farm.
    /// </summary>
    private sealed class Ports
        : ICompanyMisReader, IConfirmedFarmDaysReader, IAdminMisRepository, ISubscriptionReader, IAdminFarmerHealthRepository,
          IAdminCohortPatternsRepository
    {
        public int Calls { get; private set; }

        public bool? LastMatchPhone { get; private set; }

        /// <summary>The phone every record carries; null is a record with no phone.</summary>
        public string? PhoneOnRecord { get; init; } = Phone;

        public Task<CompanyMisRows> ReadForCompanyMisAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime additionsSinceUtc, DateTime countedAtUtc,
            IReadOnlySet<Guid> excludedUserIds, CancellationToken ct = default) =>
            ReadAsync(adminUserId, sinceUtc, countedAtUtc, excludedUserIds, ct);

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(new CompanyMisRows(
                0, 0,
                Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>(), Array.Empty<MisMembershipRow>(),
                Array.Empty<MisPlotRow>(), Array.Empty<MisVoiceJobRow>(), Array.Empty<MisUserRow>(),
                Array.Empty<MisFpoScopeRow>()));
        }

        public Task<ConfirmedFarmDaysRows> ReadAllAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default)
        {
            Calls++;
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
            Calls++;
            var farm = new FarmSummaryDto(
                Farm1, "Example Farm", PhoneOnRecord ?? "—", null, null, null, null, null, 0, null, Now);
            return Task.FromResult(new FarmsListDto([farm], 1, page, pageSize));
        }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult<IReadOnlyList<FarmContactDto>>(
                farmIds.Select(id => new FarmContactDto(id, "Example Farm", PhoneOnRecord, Guid.NewGuid())).ToList());
        }

        public Task<IReadOnlyList<FarmNameDto>> GetFarmNamesAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, Guid>> GetFarmOwnersAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult<IReadOnlyList<SufferingItemDto>>(Array.Empty<SufferingItemDto>());
        }

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default)
        {
            Calls++;
            LastMatchPhone = matchPhone;

            var user = new UserSummaryDto(Guid.NewGuid(), PhoneOnRecord ?? "—", "Example Person", null, [], Now, null);
            var found = string.IsNullOrWhiteSpace(search)
                || user.DisplayName!.Contains(search, StringComparison.OrdinalIgnoreCase)
                || (matchPhone && user.Phone.Contains(search, StringComparison.Ordinal));
            IReadOnlyList<UserSummaryDto> items = found ? [user] : [];
            return Task.FromResult(new UsersListDto(items, items.Count, page, pageSize));
        }

        public Task<SubscriptionProjection?> GetByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult<SubscriptionProjection?>(null);
        }

        public Task<AccessExtensionProjection?> GetActiveAccessExtensionAsync(
            OwnerAccountId ownerAccountId, DateTime asOfUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<CohortPatternsDto> GetAsync(AdminScope scope, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(new CohortPatternsDto([], [], [], [], [], [], []));
        }

        public Task<FarmerHealthDto?> GetAsync(Guid farmId, AdminScope scope, Guid adminUserId, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult<FarmerHealthDto?>(new FarmerHealthDto(
                FarmId: farmId,
                FarmerName: "Example Owner",
                Phone: PhoneOnRecord,
                Score: null,
                Timeline: Array.Empty<FarmerHealthTimelineDto>(),
                SyncState: null,
                AiHealth: null,
                Verifications: new FarmerHealthVerificationCountsDto(0, 0, 0, 0, 0),
                WorkerSummary: Array.Empty<FarmerHealthWorkerSummaryDto>(),
                FarmName: "Example Farm"));
        }
    }
}
