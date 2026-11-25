// spec: plr-d10-schedule-approved-spec-2026-11-23 ("/creator/* with its own audience"; acceptance: "A creator cannot reach a farm, admin, another creator's work or
// self-approval"); slice 15, server half.
//
// CROSSED TOKENS, REFUSED BOTH WAYS, BY WALKING THE ROUTE TABLE. This host signs people in exactly as production does on BOTH sides: the main bearer scheme of
// User.Api (AddUserApi: the main audience) and the creator door's own scheme (its own audience), with tokens minted by the real issuers. Every route the host maps is read
// from the host itself and asked: a creator's token on every other route, a farmer's and a staff member's token on every creator route. The host's routes are then held
// against the PRODUCTION route table (the real Bootstrapper, --list-routes): any production route this host does not map must be on a short named list of the host's own
// anonymous routes, so a new route cannot slip past the walk unseen. Real Postgres as agrisync_app.
using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Accounts.Api;
using AgriSync.Bootstrapper;
using AgriSync.Bootstrapper.Endpoints;
using Analytics.Application;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using ShramSafal.Sync.IntegrationTests.Contract;
using User.Api;
using User.Application.Ports;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Creators;

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorCrossedTokensRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    private const string MainAudience = "AgriSync.Clients";
    private const string CreatorAudience = "ShramSafal.CreatorDoor";

    /// <summary>
    /// Routes Program.cs maps inline (they exist only in the production host, so this host cannot ask them). Every one is anonymous by its own mapping
    /// (<c>.AllowAnonymous()</c> in Program.cs, or the metrics scrape) and reads no sign-in: a creator token has nothing to be refused FROM there. Anything else the
    /// production table holds and this host lacks fails the proof.
    /// </summary>
    private static readonly string[] ProductionHostOnlyAnonymousRoutes =
    [
        "GET /health",
        "GET /health/ready",
        "GET /version",
        "* /metrics",
        "POST /telemetry/client-error",
    ];

    private readonly string _signingKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));

    protected override void AddHostConfiguration(IDictionary<string, string?> settings)
    {
        base.AddHostConfiguration(settings);
        settings["Jwt:Issuer"] = "AgriSync";
        settings["Jwt:Audience"] = MainAudience;
        settings["Jwt:SigningKey"] = _signingKey; // per run, never a literal
        settings["Jwt:AccessTokenMinutes"] = "15";
        settings["Msg91:UseDevStub"] = "true";
    }

    /// <summary>The PRODUCTION sign-in wiring (no test sign-in in this host), and the modules Program.cs adds beside ShramSafal.</summary>
    protected override void AddHostAuthentication(WebApplicationBuilder builder)
    {
        builder.Services.AddUserApi(builder.Configuration);
        builder.Services.AddAccountsModule(builder.Configuration);
        builder.Services.AddAnalyticsApplication();
        builder.Services.AddAppReleaseOptions(builder.Configuration);
    }

    protected override void MapHostRoutes(WebApplication app)
    {
        app.MapUserApi();
        app.MapAccountsModuleEndpoints();
        app.MapFirstFarmBootstrapEndpoints();
        app.MapAccessExtensionAdminEndpoints();
        app.MapAnalyticsIngest();
        app.MapAdminFarmerHealth();
        app.MapAppRelease();
    }

    private string MainToken(Guid user) => HostServices.GetRequiredService<IJwtTokenService>().GenerateIdentityTokens(user, phoneVerified: true, deviceCheckPending: false).AccessToken;

    /// <summary>A token signed with the server's own key, with whatever audience and claims the test names (what a confused or hostile issuer would have to produce).</summary>
    private string Forged(string audience, Guid subject, params (string Type, string Value)[] claims)
    {
        var now = DateTime.UtcNow;
        var token = new JwtSecurityToken(
            issuer: "AgriSync",
            audience: audience,
            claims: [new Claim("sub", subject.ToString()), new Claim("phone_verified", "true"), .. claims.Select(c => new Claim(c.Type, c.Value))],
            notBefore: now.AddMinutes(-1),
            expires: now.AddMinutes(10),
            signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_signingKey)), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private sealed record Route(string Method, string Template, string Path, bool NeedsSignIn, bool IsCreatorDoor, bool TakesForm)
    {
        public string Name => $"{Method} {Template}";
    }

    private List<Route> HostRoutes() => HostServices.GetServices<EndpointDataSource>()
        .SelectMany(source => source.Endpoints)
        .OfType<RouteEndpoint>()
        .SelectMany(endpoint =>
        {
            var template = "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/');
            var needsSignIn = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is null && endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0;
            var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods is { Count: > 0 } named ? named : ["GET"];
            // A route that declares it takes a form is asked with a form: asked with JSON, routing itself answers 415 before sign-in is even looked at, which says
            // nothing about the token.
            var takesForm = endpoint.Metadata.GetMetadata<IAcceptsMetadata>()?.ContentTypes.Any(t => t.Contains("form", StringComparison.OrdinalIgnoreCase)) == true;
            return methods.Select(method => new Route(
                method, template, CreatorDoorRouteWalk.Fill(template), needsSignIn, template.StartsWith("/creator", StringComparison.OrdinalIgnoreCase), takesForm));
        })
        .DistinctBy(r => r.Name)
        .OrderBy(r => r.Name, StringComparer.Ordinal)
        .ToList();

    private async Task<HttpStatusCode> AskAsync(Route route, string? bearer)
    {
        var bodiless = route.Method is "GET" or "DELETE" or "HEAD";
        HttpContent? form = null;
        if (!bodiless && route.TakesForm)
        {
            form = new MultipartFormDataContent { { new ByteArrayContent([1, 2, 3]), "file", "walk.bin" } };
        }

        var reply = await DoorAsync(
            new HttpMethod(route.Method), route.Path, body: bodiless || form is not null ? null : "{}", bearer: bearer,
            origin: route.IsCreatorDoor ? CreatorOrigin : null, content: form);
        return reply.Status;
    }

    [Fact]
    public async Task CrossedTokens_Refused_BothWays()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureStaffAsync();
        var farmer = MainToken(Owner);
        var staff = MainToken(PlatformOwner);

        // The three sign-ins, each made the real way, each opening its own side (so a 401 below is a refusal of THAT token, not a host that refuses everyone).
        var invite = await DoorAsync(HttpMethod.Post, "/shramsafal/creator-door/creators", new { phone = PhoneA, displayName = "निर्माता" }, bearer: staff, origin: null);
        invite.Status.Should().Be(HttpStatusCode.Created, invite.Body);
        var creator = await SignInAsync(PhoneA);
        (await DoorAsync(HttpMethod.Get, "/shramsafal/farms/mine", bearer: farmer, origin: null)).Status.Should().Be(HttpStatusCode.OK, "a farmer's token opens the farmer's routes");
        (await DoorAsync(HttpMethod.Get, "/shramsafal/creator-door/creators", bearer: staff, origin: null)).Status.Should().Be(HttpStatusCode.OK, "a staff token opens the staff routes");
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.OK, "a creator's token opens the creator door");
        var creatorAudience = new JwtSecurityTokenHandler().ReadJwtToken(creator.Token).Audiences.Single();
        var farmerAudience = new JwtSecurityTokenHandler().ReadJwtToken(farmer).Audiences.Single();
        creatorAudience.Should().Be(CreatorAudience).And.NotBe(farmerAudience);
        farmerAudience.Should().Be(MainAudience);

        var routes = HostRoutes();
        var others = routes.Where(r => !r.IsCreatorDoor).ToList();
        var door = routes.Where(r => r.IsCreatorDoor).ToList();
        others.Count.Should().BeGreaterThan(150, "the host must map the modules, or the walk proves nothing");
        door.Count.Should().BeGreaterThanOrEqualTo(19);
        others.Count(r => r.NeedsSignIn).Should().BeGreaterThan(130);

        // ── a CREATOR's token on every route that is not the creator door ──
        var failures = new List<string>();
        foreach (var route in others)
        {
            var with = await AskAsync(route, creator.Token);
            if (route.NeedsSignIn)
            {
                if (with != HttpStatusCode.Unauthorized)
                {
                    failures.Add($"{route.Name}: a creator token got {(int)with}, not 401");
                }
            }
            else
            {
                // An open route: it answers exactly as it does for nobody (the token gives no identity there).
                var without = await AskAsync(route, null);
                if (with != without)
                {
                    failures.Add($"{route.Name} (open): {(int)with} with a creator token, {(int)without} without one");
                }
            }
        }

        // ── a FARMER's and a STAFF member's token on every creator-door route ──
        foreach (var route in door)
        {
            foreach (var (who, token) in new[] { ("farmer", farmer), ("staff", staff) })
            {
                var with = await AskAsync(route, token);
                if (route.NeedsSignIn)
                {
                    if (with != HttpStatusCode.Unauthorized)
                    {
                        failures.Add($"{route.Name}: a {who} token got {(int)with}, not 401");
                    }
                }
                else
                {
                    var without = await AskAsync(route, null);
                    if (with != without)
                    {
                        failures.Add($"{route.Name} (open): {(int)with} with a {who} token, {(int)without} without one");
                    }
                }
            }
        }

        Output.WriteLine($"[crossed] walked {others.Count} other routes ({others.Count(r => r.NeedsSignIn)} need sign-in) and {door.Count} creator routes ({door.Count(r => r.NeedsSignIn)} need sign-in)");
        failures.Should().BeEmpty("each door refuses the other door's token on every route");

        // ── the audience is the wall, not the claims: a token signed by this server's own key is still refused when its audience is the other door's ──
        var creatorIdOnMainAudience = Forged(MainAudience, creator.Id, ("door", "creator"));
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creatorIdOnMainAudience)).Status.Should().Be(HttpStatusCode.Unauthorized, "the main audience never opens the creator door");
        var staffIdOnCreatorAudience = Forged(CreatorAudience, PlatformOwner, ("door", "creator"));
        (await DoorAsync(HttpMethod.Get, "/shramsafal/creator-door/creators", bearer: staffIdOnCreatorAudience, origin: null)).Status
            .Should().Be(HttpStatusCode.Unauthorized, "the creator audience never opens a staff route, whoever it names");
        (await DoorAsync(HttpMethod.Get, "/shramsafal/farms/mine", bearer: Forged(CreatorAudience, Owner), origin: null)).Status.Should().Be(HttpStatusCode.Unauthorized);
        // The right audience without the door mark, or naming someone who is no creator, opens nothing either.
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: Forged(CreatorAudience, creator.Id))).Status.Should().Be(HttpStatusCode.Forbidden, "no door mark");
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: Forged(CreatorAudience, PlatformOwner, ("door", "creator")))).Status
            .Should().Be(HttpStatusCode.Unauthorized, "a staff id is not a creator");
        // Both audiences in one token: this server never issues one, and each side would read only its own; the creator side still needs a creator.
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: Forged(MainAudience, Owner))).Status.Should().Be(HttpStatusCode.Unauthorized);

        // ── the walk covered the production route table ──
        var production = ServerRouteTableTests.ReadLiveRouteTable(Output);
        var walked = routes.Select(r => r.Name).ToHashSet(StringComparer.Ordinal);
        var unwalked = production.Where(r => !walked.Contains(r)).ToList();
        Output.WriteLine($"[crossed] production table {production.Count} routes; not mapped by this host: [{string.Join(", ", unwalked)}]");
        unwalked.Should().BeSubsetOf(ProductionHostOnlyAnonymousRoutes,
            "every production route must be walked here, except the host's own anonymous routes named above (a new one must be looked at, then walked or named)");
        production.Count(r => r.Contains(" /creator/", StringComparison.Ordinal)).Should().Be(door.Count, "production serves exactly the creator routes walked here");
    }
}
