// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, H10, K19)
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.Bootstrapper.Endpoints;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ShramSafal.Api;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Subscriptions;
using ShramSafal.Infrastructure.Persistence;
using User.Api;
using User.Api.Endpoints;
using User.Application.Ports;
using User.Application.Ports.External;
using User.Domain.Security;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;
using DomainUser = global::User.Domain.Identity.User;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, H10). The door mark end to end, in an in-memory TestServer
/// host in the <c>AiEndpointsTests</c> shape: the REAL token issuer and the REAL JWT bearer validation (composed as
/// <c>Security/TenantDekEndpointRealPostgresTests</c> composes them), the real <c>EntitlementResolver</c> over the
/// in-memory store, the real console door and the real <c>/user/auth</c> routes over in-memory account, code and session
/// fakes, and recording fakes for every admin repository (each records the call and stops the request there). No SMS
/// leaves: the SMS sender is a counting fake. Made-up GUIDs and obviously fake numbers only.
/// </summary>
public sealed class ControlRoomDoorSessionEndToEndTests : IAsyncLifetime
{
    // A throwaway HMAC key for this in-memory host only (64 repeated characters: nothing secret, nothing to scan).
    private static readonly string JwtSigningKey = new('e', 64);
    private const string TeamTen = "9000000501";
    private const string FounderTen = "9000000502";
    private const string FpoTen = "9000000503";
    private const string OwnerTen = "9000000504";
    private const string DoorPath = "/__test/door";

    private static readonly Guid PlatformOrg = Guid.Parse("a0000000-0000-0000-0000-00000c3a6e00");
    private static readonly Guid FpoOrg = Guid.Parse("a0000000-0000-0000-0000-00000c3a6e01");
    private static readonly Guid FounderUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6e02");
    private static readonly Guid TeamUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6e03");
    private static readonly Guid FpoUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6e04");
    private static readonly Guid FarmOwner = Guid.Parse("00000000-0000-0000-0000-00000c3a6e05");
    private static readonly Guid OwnersFarm = Guid.Parse("f0000000-0000-0000-0000-00000c3a6e06");
    private static readonly Guid AnyId = Guid.Parse("c3a6e000-0000-0000-0000-000000000007");

    /// <summary>
    /// K19: routes under the two company prefixes that the door rule does not cover, each with its reason.
    /// </summary>
    private static readonly (string Prefix, string Reason)[] Exclusions =
    [
        ("/shramsafal/admin/me/scope", "it reports the state (doorSessionRequired); it is the one route that must answer"),
        ("/shramsafal/admin/sign-in/", "the anonymous door itself"),
        ("/shramsafal/admin/pii-review/", "PiiReviewEndpoints gate on their own PiiReviewerRequirement policy, a server-config allow-list, never the resolver: H10 does not apply to them by design"),
    ];

    /// <summary>The founder's own routes: a team seat is refused there by design (403) after the door check, ticks or not.</summary>
    private static readonly string[] FounderOnly =
    [
        "GET /shramsafal/admin/people", "POST /shramsafal/admin/people", "PUT /shramsafal/admin/people/{id:guid}",
        "POST /shramsafal/admin/people/{id:guid}/remove", "POST /shramsafal/admin/people/{id:guid}/keep",
        "GET /shramsafal/admin/people/history", "GET /shramsafal/admin/people/trust-report",
        "GET /shramsafal/admin/access-extensions", "POST /shramsafal/admin/access-extensions",
        "POST /shramsafal/admin/breach/report", "POST /shramsafal/admin/erasure/request",
    ];

    /// <summary>
    /// Pages no tick opens (A1's tick table has no <c>ops.voice</c> tick): the founder's alone in practice, so a team seat is
    /// refused there with 403 <c>admin_module_forbidden</c> after the door check, ticks or not.
    /// </summary>
    private static readonly string[] NoTickOpensIt =
    [
        "GET /shramsafal/admin/ops/voice", "GET /shramsafal/admin/ai-health", "GET /shramsafal/admin/ai-spend",
    ];

    private readonly Recorder _recorder = new();
    private readonly InMemoryAccounts _accounts = new();
    private readonly InMemoryCodes _codes = new();
    private readonly InMemorySessions _sessions = new();
    private readonly CountingSms _sms = new();
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        var past = DateTime.UtcNow.AddDays(-30);
        _accounts.Add(DomainUser.Register(new UserId(TeamUser), DomainPhone.Create(TeamTen), "Example: Team", "x", past));
        _accounts.Add(DomainUser.Register(new UserId(FounderUser), DomainPhone.Create(FounderTen), "Example: Founder", "x", past));
        _accounts.Add(DomainUser.Register(new UserId(FpoUser), DomainPhone.Create(FpoTen), "Example: FPO", "x", past));
        _accounts.Add(DomainUser.Register(new UserId(FarmOwner), DomainPhone.Create(OwnerTen), "Example: Farmer", "x", past));

        _app = await BuildHostAsync();
        _client = _app.GetTestClient();

        await using var scope = _app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var now = DateTime.UtcNow;
        db.Organizations.Add(Organization.Create(PlatformOrg, "Example: Platform", OrganizationType.Platform, now));
        db.Organizations.Add(Organization.Create(FpoOrg, "Example: FPO", OrganizationType.FPO, now));
        db.OrganizationMemberships.Add(OrganizationMembership.Create(Guid.NewGuid(), PlatformOrg, new UserId(FounderUser), OrganizationRole.Owner, new UserId(FounderUser), now));
        var teamSeat = OrganizationMembership.Create(Guid.NewGuid(), PlatformOrg, new UserId(TeamUser), OrganizationRole.Employee, new UserId(FounderUser), now);
        db.OrganizationMemberships.Add(teamSeat);
        db.OrganizationMemberships.Add(OrganizationMembership.Create(Guid.NewGuid(), FpoOrg, new UserId(FpoUser), OrganizationRole.Owner, new UserId(FounderUser), now));

        // A listed person with a tick for every company page, bound to the team account.
        var person = ControlRoomPerson.Add(Guid.NewGuid(), "+91" + TeamTen, "Example: Team", ControlRoomRole.Admin,
            ControlRoomTicks.All.Select(t => t.Key), FounderUser, now);
        person.BindTo(TeamUser, teamSeat.Id, now);
        db.ControlRoomPeople.Add(person);

        db.Farms.Add(Farm.Create(new FarmId(OwnersFarm), "Example: Farm", new UserId(FarmOwner), now));
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    // ── the issuer ───────────────────────────────────────────────────────────

    [Fact]
    public void The_issuer_adds_the_door_claim_only_when_asked()
    {
        var issuer = _app.Services.GetRequiredService<IJwtTokenService>();

        var plain = Claims(issuer.GenerateIdentityTokens(TeamUser, phoneVerified: true, deviceCheckPending: false).AccessToken);
        var marked = Claims(issuer.GenerateIdentityTokens(TeamUser, phoneVerified: true, deviceCheckPending: false, controlRoomDoor: true).AccessToken);
        var password = Claims(issuer.GenerateTokens(TeamUser, TeamTen, "Example: Team", [], phoneVerified: true, deviceCheckPending: false).AccessToken);
        var passwordMarked = Claims(issuer.GenerateTokens(TeamUser, TeamTen, "Example: Team", [], phoneVerified: true, deviceCheckPending: false, controlRoomDoor: true).AccessToken);

        Types(plain).Should().Equal("sub", "jti", "phone_verified", "nbf", "exp", "iss", "aud");
        Types(password).Should().Equal("sub", "jti", "phone", "display_name", "phone_verified", "nbf", "exp", "iss", "aud");
        plain.Should().NotContain(c => c.Type == ControlRoomSessionClaims.Type);
        password.Should().NotContain(c => c.Type == ControlRoomSessionClaims.Type);

        Types(marked).Should().Equal("sub", "jti", "phone_verified", ControlRoomSessionClaims.Type, "nbf", "exp", "iss", "aud");
        Types(passwordMarked).Should().Equal("sub", "jti", "phone", "display_name", "phone_verified", ControlRoomSessionClaims.Type, "nbf", "exp", "iss", "aud");
        marked.Single(c => c.Type == ControlRoomSessionClaims.Type).Value.Should().Be("1");
        Values(marked.Where(c => c.Type is not ("jti" or "nbf" or "exp"))).Should().BeEquivalentTo(
            Values(plain.Where(c => c.Type is not ("jti" or "nbf" or "exp"))).Append($"{ControlRoomSessionClaims.Type}=1"),
            "every other claim is today's set");
    }

    // ── the mark through real bearer validation (ruling 3) ──────────────────

    [Fact]
    public async Task A_door_issued_token_is_a_session_that_began_at_the_door()
    {
        var token = await DoorSignInAsync(TeamTen);

        var probe = await ProbeAsync(token.AccessToken);

        probe.BeganAtTheDoor.Should().BeTrue();
        probe.Marks.Should().Equal("1");

        // The mark rides the refresh of that session (the refresh request names a farmer's platform: the row decides).
        var refreshed = await PostAsync("/user/auth/refresh", """{"platform":"android"}""", cookie: token.Cookie);
        refreshed.StatusCode.Should().Be(HttpStatusCode.OK);
        var again = await ProbeAsync(await AccessTokenOf(refreshed));
        again.BeganAtTheDoor.Should().BeTrue("the mark rides every refresh of a door session");
    }

    [Theory]
    [InlineData(" Control-Room-Door ")]
    [InlineData("control-room-door")]
    [InlineData("android")]
    [InlineData(null)]
    public async Task A_farmer_issued_token_is_never_a_door_session(string? platform)
    {
        var token = await FarmerSignInAsync(TeamTen, platform);

        var probe = await ProbeAsync(token.AccessToken);

        probe.BeganAtTheDoor.Should().BeFalse($"platform {platform ?? "(none)"} through /user/auth never marks a session");
        probe.Marks.Should().BeEmpty();

        var refreshed = await PostAsync("/user/auth/refresh", "{}", cookie: token.Cookie);
        (await ProbeAsync(await AccessTokenOf(refreshed))).BeganAtTheDoor.Should().BeFalse("nor does its refresh");
    }

    // ── the cross-lane contract the console reads (ruling 3) ────────────────

    [Fact]
    public async Task The_console_contract_door_session_required_and_controlRoom()
    {
        var farmer = await FarmerSignInAsync(TeamTen, "web");

        var refused = await GetAsync("/shramsafal/admin/farms?page=1&pageSize=20", farmer.AccessToken);
        refused.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await CodeOf(refused)).Should().Be(ControlRoomSessionClaims.RequiredErrorCode);

        var scopeWithout = await ScopeAsync(farmer.AccessToken);
        scopeWithout.GetProperty("controlRoom").GetProperty("doorSessionRequired").GetBoolean().Should().BeTrue();

        var door = await DoorSignInAsync(TeamTen);
        var scopeWith = await ScopeAsync(door.AccessToken);
        scopeWith.GetProperty("controlRoom").GetProperty("doorSessionRequired").GetBoolean().Should().BeFalse();
        scopeWith.GetProperty("controlRoom").GetProperty("ticks").GetArrayLength().Should().Be(ControlRoomTicks.All.Count);

        var fpo = await FarmerSignInAsync(FpoTen, "web");
        var scopeFpo = await ScopeAsync(fpo.AccessToken);
        scopeFpo.GetProperty("controlRoom").ValueKind.Should().Be(JsonValueKind.Null, "an FPO seat is not a control-room seat");
        scopeFpo.GetProperty("scope").GetProperty("orgType").GetString().Should().Be("FPO");
    }

    // ── every company route ─────────────────────────────────────────────────

    [Fact]
    public async Task A_listed_persons_password_born_token_is_refused_on_every_company_route()
    {
        var issuer = _app.Services.GetRequiredService<IJwtTokenService>();
        var passwordBorn = issuer.GenerateTokens(TeamUser, TeamTen, "Example: Team", [], phoneVerified: true, deviceCheckPending: false).AccessToken;
        var doorBorn = issuer.GenerateIdentityTokens(TeamUser, phoneVerified: true, deviceCheckPending: false, controlRoomDoor: true).AccessToken;

        var routes = CompanyRoutes();
        routes.Should().HaveCountGreaterThan(20, "the sweep sees the mapped company routes, not a hand list");
        routes.Select(r => r.Key).Should().Contain(FounderOnly, "every founder-only route is mapped in this host");

        foreach (var route in routes)
        {
            _recorder.Clear();
            var answer = await SendAsync(route, passwordBorn);
            answer.StatusCode.Should().Be(HttpStatusCode.Unauthorized, route.Key);
            (await CodeOf(answer)).Should().Be(ControlRoomSessionClaims.RequiredErrorCode, route.Key);
            _recorder.Calls.Should().BeEmpty($"{route.Key}: no repository is reached with a password-born token");
        }

        foreach (var route in routes)
        {
            _recorder.Clear();
            var answer = await SendAsync(route, doorBorn);
            var body = await answer.Content.ReadAsStringAsync();
            body.Should().NotContain(ControlRoomSessionClaims.RequiredErrorCode, route.Key);
            if (FounderOnly.Contains(route.Key))
            {
                answer.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{route.Key} is the founder's alone: {body}");
                _recorder.Calls.Should().BeEmpty(route.Key);
            }
            else if (NoTickOpensIt.Contains(route.Key))
            {
                answer.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{route.Key}: no tick opens it: {body}");
                (await CodeOf(answer)).Should().Be("admin_module_forbidden", route.Key);
                _recorder.Calls.Should().BeEmpty(route.Key);
            }
            else
            {
                _recorder.Calls.Should().NotBeEmpty($"{route.Key} passes every gate and reaches the repository ({(int)answer.StatusCode}: {body})");
            }
        }

        // The schedule-check routes refuse the password-born token with their existing refusal; the door-born token passes.
        foreach (var (method, path, json) in new[]
                 {
                     ("GET", "/shramsafal/schedule-templates/checks/waiting", (string?)null),
                     ("POST", $"/shramsafal/schedule-templates/{AnyId}/check", """{"decision":"approve"}"""),
                 })
        {
            var refused = await SendAsync(new Route(method, path, json), passwordBorn);
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{method} {path}");
            var passed = await SendAsync(new Route(method, path, json), doorBorn);
            passed.StatusCode.Should().NotBe(HttpStatusCode.Forbidden, $"{method} {path}: {await passed.Content.ReadAsStringAsync()}");
        }
    }

    [Fact]
    public async Task A_farmer_token_is_not_touched_by_the_door_rule()
    {
        var token = _app.Services.GetRequiredService<IJwtTokenService>()
            .GenerateIdentityTokens(FarmOwner, phoneVerified: true, deviceCheckPending: false).AccessToken;

        var answer = await GetAsync("/shramsafal/farms/mine", token);

        answer.StatusCode.Should().Be(HttpStatusCode.OK, await answer.Content.ReadAsStringAsync());
        using var doc = JsonDocument.Parse(await answer.Content.ReadAsStringAsync());
        doc.RootElement.EnumerateArray().Select(f => f.GetProperty("farmId").GetGuid()).Should().Contain(OwnersFarm);
    }

    // ── sign-ins through the real routes ────────────────────────────────────

    private sealed record Token(string AccessToken, string Cookie);

    private async Task<Token> DoorSignInAsync(string tenDigits)
    {
        _codes.Seed(tenDigits, "123456");
        var answer = await PostAsync(ControlRoomSignInEndpoints.CheckCodeRoute,
            $$"""{"phone":"{{tenDigits}}","otp":"123456","deviceId":"console-e2e","platform":"web"}""");
        answer.StatusCode.Should().Be(HttpStatusCode.OK, await answer.Content.ReadAsStringAsync());
        return new Token(await AccessTokenOf(answer), CookieOf(answer));
    }

    private async Task<Token> FarmerSignInAsync(string tenDigits, string? platform)
    {
        _codes.Seed(tenDigits, "654321");
        var platformJson = platform is null ? "null" : JsonSerializer.Serialize(platform);
        var answer = await PostAsync("/user/auth/verify-otp",
            $$"""{"phone":"{{tenDigits}}","otp":"654321","deviceId":"phone-e2e","platform":{{platformJson}}}""");
        answer.StatusCode.Should().Be(HttpStatusCode.OK, await answer.Content.ReadAsStringAsync());
        return new Token(await AccessTokenOf(answer), CookieOf(answer));
    }

    // ── HTTP helpers ────────────────────────────────────────────────────────

    private sealed record Route(string Method, string Path, string? Body)
    {
        public string Key { get; init; } = $"{Method} {Path}";
    }

    private sealed record Probe(bool BeganAtTheDoor, IReadOnlyList<string> Marks);

    private List<Route> CompanyRoutes()
    {
        var query = $"?page=1&pageSize=20&days=7&weeks=4&minutes=60&ids={AnyId}&ownerAccountId={AnyId}";
        return _app.Services.GetServices<EndpointDataSource>()
            .SelectMany(s => s.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText is { } raw
                && (raw.StartsWith("/shramsafal/admin", StringComparison.Ordinal) || raw.StartsWith("/admin/farmer-health", StringComparison.Ordinal))
                && !Exclusions.Any(x => raw.StartsWith(x.Prefix, StringComparison.Ordinal)))
            .SelectMany(e => e.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Select(method =>
            {
                var raw = e.RoutePattern.RawText!;
                var path = System.Text.RegularExpressions.Regex.Replace(raw, @"\{[^}]+\}", AnyId.ToString());
                return new Route(method, method == "GET" ? path + query : path, method == "GET" ? null : "{}") { Key = $"{method} {raw}" };
            }))
            .DistinctBy(r => r.Key)
            .OrderBy(r => r.Key, StringComparer.Ordinal)
            .ToList();
    }

    private async Task<HttpResponseMessage> SendAsync(Route route, string accessToken)
    {
        using var request = new HttpRequestMessage(new HttpMethod(route.Method), route.Path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (route.Body is not null)
        {
            request.Content = new StringContent(route.Body, Encoding.UTF8, "application/json");
        }

        return await _client.SendAsync(request);
    }

    private Task<HttpResponseMessage> GetAsync(string path, string accessToken) => SendAsync(new Route("GET", path, null), accessToken);

    private async Task<HttpResponseMessage> PostAsync(string path, string json, string? cookie = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        return await _client.SendAsync(request);
    }

    private async Task<Probe> ProbeAsync(string accessToken)
    {
        var answer = await GetAsync(DoorPath, accessToken);
        answer.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await answer.Content.ReadAsStringAsync());
        return new Probe(
            doc.RootElement.GetProperty("beganAtTheDoor").GetBoolean(),
            doc.RootElement.GetProperty("marks").EnumerateArray().Select(m => m.GetString()!).ToList());
    }

    private async Task<JsonElement> ScopeAsync(string accessToken)
    {
        var answer = await GetAsync("/shramsafal/admin/me/scope", accessToken);
        answer.StatusCode.Should().Be(HttpStatusCode.OK, await answer.Content.ReadAsStringAsync());
        using var doc = JsonDocument.Parse(await answer.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private static async Task<string> AccessTokenOf(HttpResponseMessage answer)
    {
        using var doc = JsonDocument.Parse(await answer.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("accessToken").GetString()!;
    }

    private static string CookieOf(HttpResponseMessage answer) =>
        answer.Headers.GetValues("Set-Cookie").Single().Split(';')[0];

    private static async Task<string?> CodeOf(HttpResponseMessage answer)
    {
        var body = await answer.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static IReadOnlyList<Claim> Claims(string accessToken) => new JwtSecurityTokenHandler().ReadJwtToken(accessToken).Claims.ToList();

    private static IReadOnlyList<string> Types(IEnumerable<Claim> claims) => claims.Select(c => c.Type).ToList();

    private static IEnumerable<string> Values(IEnumerable<Claim> claims) => claims.Select(c => $"{c.Type}={c.Value}");

    // ── the host ────────────────────────────────────────────────────────────

    private async Task<WebApplication> BuildHostAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        var storage = Path.Combine(Path.GetTempPath(), "agrisync-a6-e2e", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=1;Database=none;Username=none;Password=none",
            ["ConnectionStrings:UserDb"] = "Host=localhost;Port=1;Database=none;Username=none;Password=none",
            ["ShramSafal:Storage:DataDirectory"] = storage,
            ["Jwt:Issuer"] = "AgriSync",
            ["Jwt:Audience"] = "AgriSync.Clients",
            ["Jwt:SigningKey"] = JwtSigningKey,
            ["Jwt:AccessTokenMinutes"] = "15",
        });

        // The REAL token validation and the REAL token issuer, and the real /user/auth handlers, composed as Program.cs
        // composes them (AddUserApi = AddUserInfrastructure + AddJwtTokenValidation + the handlers).
        builder.Services.AddUserApi(builder.Configuration);
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"a6-e2e-analytics-{Guid.NewGuid()}"));
        builder.Services.AddShramSafalApi(builder.Configuration);

        // The User module's tables are in-memory fakes; the SMS sender counts and never sends.
        builder.Services.RemoveAll<IUserRepository>();
        builder.Services.AddSingleton<IUserRepository>(_accounts);
        builder.Services.RemoveAll<IOtpChallengeRepository>();
        builder.Services.AddSingleton<IOtpChallengeRepository>(_codes);
        builder.Services.RemoveAll<IRefreshTokenRepository>();
        builder.Services.AddSingleton<IRefreshTokenRepository>(_sessions);
        builder.Services.RemoveAll<IPasswordHasher>();
        builder.Services.AddSingleton<IPasswordHasher, PlainHasher>();
        builder.Services.RemoveAll<ISmsSender>();
        builder.Services.AddSingleton<ISmsSender>(_sms);

        // ShramSafal's store is in-memory (as AiEndpointsTests); the resolver, the people store and History are real.
        builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
        builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
        var root = new InMemoryDatabaseRoot();
        var dbName = $"a6-e2e-{Guid.NewGuid()}";
        builder.Services.AddDbContext<ShramSafalDbContext>(o => o.UseInMemoryDatabase(dbName, root));
        builder.Services.RemoveAll<AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory<ShramSafalDbContext>>();
        builder.Services.AddScoped<AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory<ShramSafalDbContext>>(_ =>
            new SameStoreAdminDbContextFactory(new DbContextOptionsBuilder<ShramSafalDbContext>().UseInMemoryDatabase(dbName, root).Options));
        builder.Services.AddDbContext<AccountsDbContext>(o => o.UseInMemoryDatabase($"a6-e2e-accounts-{Guid.NewGuid()}"));

        // Recording fakes for every admin repository: each records the call and stops the request there.
        Replace<IAdminOpsRepository>(builder.Services);
        Replace<IAdminMisRepository>(builder.Services);
        Replace<ICompanyMisReader>(builder.Services);
        Replace<IAdminAiObservabilityRepository>(builder.Services);
        Replace<IAdminFarmerHealthRepository>(builder.Services);
        Replace<IAdminCohortPatternsRepository>(builder.Services);
        Replace<IConfirmedFarmDaysReader>(builder.Services);
        builder.Services.RemoveAll<ISubscriptionReader>();
        builder.Services.AddSingleton<ISubscriptionReader, NoSubscriptions>();

        // The console door, as Program.cs registers it.
        builder.Services.AddScoped<IControlRoomPhoneDirectory, ControlRoomPhoneDirectory>();
        builder.Services.AddSingleton<ControlRoomCodeQueue>();
        builder.Services.AddSingleton(TimeProvider.System);

        var app = builder.Build();
        app.Use(async (ctx, next) =>
        {
            try
            {
                await next();
            }
            catch (ReachedTheFakeException)
            {
                ctx.Response.StatusCode = 299;
            }
        });
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapShramSafalApi();
        app.MapAdminFarmerHealth();
        app.MapAccessExtensionAdminEndpoints();
        app.MapControlRoomSignInEndpoints(TimeSpan.Zero);
        app.MapAuthEndpoints();
        app.MapGet(DoorPath, (IControlRoomSession session, ClaimsPrincipal user) => Results.Ok(new
        {
            beganAtTheDoor = session.BeganAtTheDoor,
            marks = user.FindAll(ControlRoomSessionClaims.Type).Select(c => c.Value).ToList(),
        })).RequireAuthorization();

        await app.StartAsync();
        return app;
    }

    private void Replace<T>(IServiceCollection services) where T : class
    {
        services.RemoveAll<T>();
        services.AddSingleton(RecordingProxy.For<T>(_recorder));
    }

    // ── fakes ───────────────────────────────────────────────────────────────

    private sealed class Recorder
    {
        private readonly ConcurrentQueue<string> _calls = new();

        public IReadOnlyList<string> Calls => _calls.ToList();

        public void Add(string call) => _calls.Enqueue(call);

        public void Clear() => _calls.Clear();
    }

    private sealed class ReachedTheFakeException(string call) : Exception($"Reached the recording fake: {call}");

    /// <summary>A recording fake of any admin repository: it records the call and stops the request there.</summary>
    internal class RecordingProxy : DispatchProxy
    {
        private Recorder _recorder = null!;
        private string _name = string.Empty;

        public static T For<T>(object recorder) where T : class
        {
            var proxy = Create<T, RecordingProxy>();
            var self = (RecordingProxy)(object)proxy;
            self._recorder = (Recorder)recorder;
            self._name = typeof(T).Name;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            var call = $"{_name}.{targetMethod!.Name}";
            _recorder.Add(call);
            throw new ReachedTheFakeException(call);
        }
    }

    private sealed class NoSubscriptions : ISubscriptionReader
    {
        public Task<SubscriptionProjection?> GetByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default) =>
            Task.FromResult<SubscriptionProjection?>(null);

        public Task<AccessExtensionProjection?> GetActiveAccessExtensionAsync(OwnerAccountId ownerAccountId, DateTime asOfUtc, CancellationToken ct = default) =>
            Task.FromResult<AccessExtensionProjection?>(null);
    }

    private sealed class PlainHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "h:" + plainText;
        public bool Verify(string plainText, string hash) => hash == "h:" + plainText;
    }

    private sealed class CountingSms : ISmsSender
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

    private sealed class InMemoryCodes : IOtpChallengeRepository
    {
        private readonly List<OtpChallenge> _rows = [];

        public void Seed(string tenDigits, string code)
        {
            lock (_rows)
            {
                foreach (var old in _rows.Where(r => r.PhoneNumberNormalized == tenDigits && r.IsPending))
                {
                    old.ExpireManually(DateTime.UtcNow);
                }

                _rows.Add(OtpChallenge.Issue(Guid.NewGuid(), tenDigits, "h:" + code, DateTime.UtcNow, TimeSpan.FromMinutes(5), 5));
            }
        }

        public Task AddAsync(OtpChallenge challenge, CancellationToken ct = default)
        {
            lock (_rows) _rows.Add(challenge);
            return Task.CompletedTask;
        }

        public Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, CancellationToken ct = default)
        {
            lock (_rows) return Task.FromResult(_rows.LastOrDefault(r => r.PhoneNumberNormalized == phoneNumberNormalized && r.IsPending));
        }

        public Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(0);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class InMemoryAccounts : IUserRepository
    {
        private readonly List<DomainUser> _users = [];

        public void Add(DomainUser user) => _users.Add(user);

        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult(_users.FirstOrDefault(u => u.Id.Value == id));
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(_users.FirstOrDefault(u => u.Phone.Value == phone));
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(_users.Any(u => u.Phone.Value == phone));

        public Task AddAsync(DomainUser user, CancellationToken ct = default)
        {
            _users.Add(user);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class InMemorySessions : IRefreshTokenRepository
    {
        private readonly List<DomainRefreshToken> _rows = [];

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default)
        {
            lock (_rows) return Task.FromResult(_rows.FirstOrDefault(t => t.TokenHash == tokenHash));
        }

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
        {
            lock (_rows) _rows.Add(refreshToken);
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;

        // Every phone is known here: no sign-in is held for the new-phone question.
        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => Task.FromResult(true);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
