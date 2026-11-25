// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Creators: invite only ..., own session"; "/creator/* with its own audience, cookie and CORS policy"); slice 15, server half.
//
// The door itself: the switch, who may sign in, where the refresh credential lives, and which origins are answered. Real Postgres as agrisync_app, the real host.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.CreatorDoor;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Creators;

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorSwitchOffRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    protected override bool DoorOn => false;

    [Fact]
    public async Task Door_Off_Answers404()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Every creator route the host maps, read from the host itself (not a hand list).
        var routes = HostServices.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => (e.RoutePattern.RawText ?? string.Empty).StartsWith("/creator", StringComparison.OrdinalIgnoreCase))
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["GET"])
                .Select(method => (Method: method, Path: CreatorDoorRouteWalk.Fill(e.RoutePattern.RawText!))))
            .Distinct()
            .ToList();
        routes.Count.Should().BeGreaterThanOrEqualTo(19, "the door's routes are mapped even while it is off (they are in the route table)");

        foreach (var (method, path) in routes)
        {
            (await DoorAsync(new HttpMethod(method), path, body: "{}")).Status
                .Should().Be(HttpStatusCode.NotFound, $"{method} {path} with no token, door off");
            (await DoorAsync(new HttpMethod(method), path, body: "{}", bearer: "not-a-token", cookie: "anything", deviceId: NewDeviceId())).Status
                .Should().Be(HttpStatusCode.NotFound, $"{method} {path} with a token and a cookie, door off");
        }

        // A path under /creator that is no route, and a browser preflight: 404, and no CORS answer at all.
        (await DoorAsync(HttpMethod.Get, "/creator/anything-at-all")).Status.Should().Be(HttpStatusCode.NotFound);
        var preflight = await DoorAsync(HttpMethod.Options, "/creator/profile", headers: new Dictionary<string, string> { ["Access-Control-Request-Method"] = "GET" });
        preflight.Status.Should().Be(HttpStatusCode.NotFound);
        preflight.Headers.Contains("Access-Control-Allow-Origin").Should().BeFalse("a switched-off door answers no origin");

        // The staff side of the door is off too, and nothing was written anywhere.
        await EnsureStaffAsync();
        var (invite, _) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/creator-door/creators", PlatformOwner, new { phone = PhoneA, displayName = "निर्माता" });
        invite.Should().Be(HttpStatusCode.NotFound);
        var (list, _) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/creator-door/submissions", PlatformOwner, null);
        list.Should().Be(HttpStatusCode.NotFound);
        (await ScalarAsync("SELECT (SELECT count(*) FROM ssf.creator_profiles) + (SELECT count(*) FROM ssf.creator_sign_in_codes) + (SELECT count(*) FROM ssf.creator_sessions)"))
            .Should().Be("0");
        Codes.For(PhoneA).Should().BeEmpty("no SMS leaves a switched-off door");

        // The rest of the server is as it was: a farmer's route still answers.
        var (farms, farmsBody) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/farms/mine", Owner, null);
        farms.Should().Be(HttpStatusCode.OK, farmsBody);
    }
}

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorSignInRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    private const string Uninvited = "6000015099";
    private const string Calm = "If this number is invited, a code has been sent to it by SMS.";

    [Fact]
    public async Task UninvitedPhone_SameAnswer()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await InviteAsync(PhoneA);
        var revoked = await InviteAsync(PhoneB);
        var (revoke, revokeBody) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/creator-door/creators/{revoked}/revoke", PlatformOwner, null);
        revoke.Should().Be(HttpStatusCode.OK, revokeBody);

        // Asking for a code: the invited phone, a phone never invited and a revoked one get the very same answer.
        var invited = await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneA });
        var unknown = await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = Uninvited });
        var gone = await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneB });
        foreach (var reply in new[] { invited, unknown, gone })
        {
            reply.Status.Should().Be(HttpStatusCode.OK);
            reply.Body.Should().Be(invited.Body, "the answer must not say who is invited");
            reply.Message.Should().Be(Calm);
        }

        // Only the invited phone was sent anything, and only its code was stored.
        Codes.For(PhoneA).Should().HaveCount(1);
        Codes.For(Uninvited).Should().BeEmpty();
        Codes.For(PhoneB).Should().BeEmpty();
        (await ScalarAsync("SELECT string_agg(DISTINCT phone, ',') FROM ssf.creator_sign_in_codes")).Should().Be(PhoneA);

        // Verifying: a wrong code on the invited phone and any code on the others get the very same refusal.
        var device = NewDeviceId();
        var wrong = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = PhoneA, code = "000000" }, deviceId: device);
        var unknownVerify = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = Uninvited, code = Codes.For(PhoneA)[0] }, deviceId: device);
        var goneVerify = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = PhoneB, code = Codes.For(PhoneA)[0] }, deviceId: device);
        foreach (var reply in new[] { wrong, unknownVerify, goneVerify })
        {
            reply.Status.Should().Be(HttpStatusCode.Unauthorized);
            reply.Body.Should().Be(wrong.Body);
            reply.Error.Should().Be("Creator.SignInFailed");
            reply.RefreshCookie.Should().BeNull("a refused sign-in sets no cookie");
        }

        // The right code still works after one wrong try, and only once.
        var ok = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = PhoneA, code = Codes.For(PhoneA)[0] }, deviceId: device);
        ok.Status.Should().Be(HttpStatusCode.OK, ok.Body);
        var again = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = PhoneA, code = Codes.For(PhoneA)[0] }, deviceId: device);
        again.Status.Should().Be(HttpStatusCode.Unauthorized, "a code is used once");

        // The SMS ceiling of this door: five codes to one phone in a day; the sixth ask gets the same calm answer and no SMS.
        for (var i = 0; i < 4; i++)
        {
            (await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneA })).Body.Should().Be(invited.Body);
        }

        Codes.For(PhoneA).Should().HaveCount(5);
        var sixth = await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneA });
        sixth.Status.Should().Be(HttpStatusCode.OK);
        sixth.Body.Should().Be(invited.Body);
        Codes.For(PhoneA).Should().HaveCount(5, "the ceiling sends no sixth SMS");

        // A malformed number is told so (that says nothing about anyone).
        (await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = "12345" })).Error.Should().Be("Creator.InvalidPhone");

        // The farmer door's code never opens this door: its tables are untouched by all of the above.
        (await ScalarAsync("SELECT count(*) FROM public.otp_challenges WHERE phone_number_normalized IN ('6000015001', '6000015002', '6000015099')")).Should().Be("0");
    }

    [Fact]
    public async Task RefreshToken_NeverInBody()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await InviteAsync(PhoneA);
        var device = NewDeviceId();

        // Sign-in, asked the way the Android app asks the farmer door for a body credential: this door has no such path.
        await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneA });
        var native = new Dictionary<string, string> { ["X-Client-Platform"] = "android" };
        var verify = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = PhoneA, code = Codes.For(PhoneA)[0] }, deviceId: device, headers: native);
        verify.Status.Should().Be(HttpStatusCode.OK, verify.Body);
        var cookie = verify.RefreshCookie!;
        cookie.Should().NotBeNullOrEmpty();
        AssertBodyHoldsNoCredential(verify, cookie);

        // A refresh: the same.
        var refresh = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: cookie, deviceId: device, headers: native);
        refresh.Status.Should().Be(HttpStatusCode.OK, refresh.Body);
        var rotated = refresh.RefreshCookie!;
        rotated.Should().NotBeNullOrEmpty().And.NotBe(cookie, "each refresh replaces the credential");
        AssertBodyHoldsNoCredential(refresh, rotated);

        // And it cannot be PRESENTED in a body or a header either: only the cookie is read.
        var inBody = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", new { refreshToken = rotated }, deviceId: device, headers: native);
        inBody.Status.Should().Be(HttpStatusCode.Unauthorized);
        var inHeader = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", deviceId: device, headers: new Dictionary<string, string> { ["Authorization"] = $"Bearer {rotated}" });
        inHeader.Status.Should().Be(HttpStatusCode.Unauthorized);

        // The database holds only its hash.
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_sessions WHERE token_hash = @t", ("t", rotated))).Should().Be("0");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_sessions WHERE token_hash ~ '^[0-9a-f]{64}$'")).Should().Be("1");
    }

    private static void AssertBodyHoldsNoCredential(Reply reply, string credential)
    {
        reply.Json.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["creatorId", "accessToken", "expiresAtUtc"], "the body has no field for the refresh credential");
        reply.Body.Should().NotContain(credential);
        reply.Body.ToLowerInvariant().Should().NotContain("refresh");
    }

    [Fact]
    public async Task CreatorCookie_OwnNameAndPath()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await InviteAsync(PhoneA);
        var device = NewDeviceId();
        await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneA });
        var verify = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone = PhoneA, code = Codes.For(PhoneA)[0] }, deviceId: device);
        verify.Status.Should().Be(HttpStatusCode.OK, verify.Body);

        // Its own name and its own path; HttpOnly, Secure, SameSite=Strict (this host is not plain-http local development).
        var setCookie = verify.SetCookies.Should().ContainSingle().Subject;
        var parts = setCookie.Split(';').Select(p => p.Trim().ToLowerInvariant()).ToList();
        setCookie.Should().StartWith("shramsafal_creator_refresh=");
        setCookie.Should().NotContain("agrisync_refresh");
        parts.Should().Contain("path=/creator/auth").And.Contain("httponly").And.Contain("secure").And.Contain("samesite=strict");
        parts.Should().NotContain(p => p.StartsWith("path=/user", StringComparison.Ordinal));
        parts.Should().Contain(p => p.StartsWith("expires=", StringComparison.Ordinal));
        var first = verify.RefreshCookie!;

        // Without the device id the browser sent at sign-in: refused (a cookie alone is not enough). The session ends.
        var noDevice = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: first);
        noDevice.Status.Should().Be(HttpStatusCode.Unauthorized);
        noDevice.RefreshCookie.Should().BeEmpty("a refused refresh clears the cookie");
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: first, deviceId: device)).Status
            .Should().Be(HttpStatusCode.Unauthorized, "the session ended when its credential came without its device");

        // A fresh sign-in; a refresh from ANOTHER device id ends that session too (a copied cookie is useless elsewhere).
        var creator = await SignInAsync(PhoneA, device);
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: creator.Cookie, deviceId: NewDeviceId())).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: creator.Cookie, deviceId: device)).Status.Should().Be(HttpStatusCode.Unauthorized);

        // Same device: it works, the credential is replaced, and the old one is dead.
        creator = await SignInAsync(PhoneA, device);
        var refresh = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: creator.Cookie, deviceId: device);
        refresh.Status.Should().Be(HttpStatusCode.OK, refresh.Body);
        var second = refresh.RefreshCookie!;
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: creator.Cookie, deviceId: device)).Status.Should().Be(HttpStatusCode.Unauthorized, "the old credential");
        var newToken = refresh.Json.GetProperty("accessToken").GetString()!;
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: newToken)).Status.Should().Be(HttpStatusCode.OK);

        // Only a request from the creator door's own origin may use the cookie routes: none, the main app's, or any other is refused before anything is read.
        foreach (var origin in new string?[] { null, MainOrigin, "https://evil.example" })
        {
            var refused = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: second, deviceId: device, origin: origin);
            refused.Status.Should().Be(HttpStatusCode.Forbidden, $"origin {origin ?? "(none)"}");
            refused.Error.Should().Be("Creator.OriginRefused");
        }

        // The credential survived those refusals (they never reached it); sign-out ends it and clears the cookie.
        var third = await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: second, deviceId: device);
        third.Status.Should().Be(HttpStatusCode.OK, third.Body);
        var signOut = await DoorAsync(HttpMethod.Post, "/creator/auth/logout", cookie: third.RefreshCookie, deviceId: device);
        signOut.Status.Should().Be(HttpStatusCode.OK);
        signOut.RefreshCookie.Should().BeEmpty();
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: third.RefreshCookie, deviceId: device)).Status.Should().Be(HttpStatusCode.Unauthorized);

        // The farmer door's cookie name means nothing here.
        using var request = new HttpRequestMessage(HttpMethod.Post, "/creator/auth/refresh");
        request.Headers.Add("Cookie", $"agrisync_refresh={third.RefreshCookie}");
        request.Headers.Add("Origin", CreatorOrigin);
        request.Headers.Add(DeviceHeader, device);
        using var farmerCookie = await SendRawAsync(request);
        farmerCookie.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreatorCors_OnlyOnCreatorRoutes()
    {
        await AssertAppRoleIsNotVacuousAsync();
        static Dictionary<string, string> Preflight(string method = "GET") => new() { ["Access-Control-Request-Method"] = method, ["Access-Control-Request-Headers"] = "authorization" };
        static string? Allowed(Reply reply) => reply.Headers.TryGetValues("Access-Control-Allow-Origin", out var v) ? v.Single() : null;

        // A creator route: the creator origin is answered, with credentials; the main app's origin and a stranger are not.
        var doorFromDoor = await DoorAsync(HttpMethod.Options, "/creator/profile", origin: CreatorOrigin, headers: Preflight());
        Allowed(doorFromDoor).Should().Be(CreatorOrigin);
        doorFromDoor.Headers.GetValues("Access-Control-Allow-Credentials").Single().Should().Be("true");
        Allowed(await DoorAsync(HttpMethod.Options, "/creator/profile", origin: MainOrigin, headers: Preflight())).Should().BeNull("the main list never answers for a creator route");
        Allowed(await DoorAsync(HttpMethod.Options, "/creator/auth/refresh", origin: MainOrigin, headers: Preflight("POST"))).Should().BeNull();
        Allowed(await DoorAsync(HttpMethod.Options, "/creator/profile", origin: "https://evil.example", headers: Preflight())).Should().BeNull();
        Allowed(await DoorAsync(HttpMethod.Options, "/creator/no-such-route", origin: MainOrigin, headers: Preflight())).Should().BeNull("not even for a path under /creator that is no route");

        // Every other route: the main origin is answered as before; the creator origin never is.
        foreach (var path in new[] { "/shramsafal/farms/mine", "/sync/pull", "/shramsafal/creator-door/creators", "/shramsafal/schedule-templates/import/format-2" })
        {
            Allowed(await DoorAsync(HttpMethod.Options, path, origin: MainOrigin, headers: Preflight())).Should().Be(MainOrigin, path);
            Allowed(await DoorAsync(HttpMethod.Options, path, origin: CreatorOrigin, headers: Preflight())).Should().BeNull($"the creator origin is not on the main list ({path})");
        }

        // A real (not preflight) creator request carries the header for its own origin only.
        var creator = await InvitedCreatorAsync();
        Allowed(await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creator.Token, origin: CreatorOrigin)).Should().Be(CreatorOrigin);
        Allowed(await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creator.Token, origin: MainOrigin)).Should().BeNull();

        // The device header the creator web must send is allowed by the door's policy and by nothing else.
        var withDevice = await DoorAsync(HttpMethod.Options, "/creator/auth/refresh", origin: CreatorOrigin,
            headers: new Dictionary<string, string> { ["Access-Control-Request-Method"] = "POST", ["Access-Control-Request-Headers"] = "x-creator-device-id,content-type" });
        Allowed(withDevice).Should().Be(CreatorOrigin);
        string.Join(',', withDevice.Headers.GetValues("Access-Control-Allow-Headers")).ToLowerInvariant().Should().Contain("x-creator-device-id");
    }

    [Fact]
    public void StartupGuard_Refuses_AnUnsafeDoor_WithWords()
    {
        var builtIn = HostServices.GetRequiredService<ICreatorFileScanner>();
        builtIn.IsBuiltIn.Should().BeTrue("the module's default scanner is the built-in check");
        var real = new NamedScanner();
        const string Real = "https://schedule.shramsafal.in";
        static CreatorDoorOptions Door(string? origin, bool on = true, string terms = "2026-12") =>
            new() { Enabled = on, TermsVersion = terms, AllowedOrigins = origin is null ? [] : [origin] };
        string[] main = ["https://app.shramsafal.in", "https://shramsafal.in", "capacitor://localhost"];

        // Off (the default): nothing is checked, in any environment, whatever else is set.
        CreatorDoorStartupGuard.EnsureSafe(isProduction: true, new CreatorDoorOptions(), main, builtIn);
        CreatorDoorStartupGuard.EnsureSafe(isProduction: true, Door("http://localhost:5174", on: false, terms: ""), main, builtIn);

        // On, anywhere: a creator origin that is also on the main list.
        var shared = () => CreatorDoorStartupGuard.EnsureSafe(isProduction: false, Door("https://app.shramsafal.in/"), main, real);
        shared.Should().Throw<InvalidOperationException>().WithMessage("*BOTH CreatorDoor:AllowedOrigins and Cors:AllowedOrigins*did not start*");

        // On, in Production: only the built-in check; no origin or a plain-http one; no terms.
        var scanner = () => CreatorDoorStartupGuard.EnsureSafe(isProduction: true, Door(Real), main, builtIn);
        scanner.Should().Throw<InvalidOperationException>().WithMessage("*only the built-in file check, which is not an anti-virus*did not start*");
        var noOrigin = () => CreatorDoorStartupGuard.EnsureSafe(isProduction: true, Door(null), main, real);
        noOrigin.Should().Throw<InvalidOperationException>().WithMessage("*empty or holds an origin that is not https*");
        var http = () => CreatorDoorStartupGuard.EnsureSafe(isProduction: true, Door("http://schedule.shramsafal.in"), main, real);
        http.Should().Throw<InvalidOperationException>().WithMessage("*not https*");
        var terms = () => CreatorDoorStartupGuard.EnsureSafe(isProduction: true, Door(Real, terms: " "), main, real);
        terms.Should().Throw<InvalidOperationException>().WithMessage("*no creator terms version is set*");

        // On, in Production, with everything the founder must decide in place: it starts. Outside Production the built-in check may serve.
        CreatorDoorStartupGuard.EnsureSafe(isProduction: true, Door(Real), main, real);
        CreatorDoorStartupGuard.EnsureSafe(isProduction: false, Door("http://localhost:5174", terms: ""), main, builtIn);
    }

    private sealed class NamedScanner : ICreatorFileScanner
    {
        public string Name => "a-real-scanner";
        public bool IsBuiltIn => false;

        public Task<CreatorScanResult> ScanAsync(ReadOnlyMemory<byte> bytes, string fileName, System.Threading.CancellationToken ct = default) =>
            Task.FromResult(new CreatorScanResult(CreatorScanVerdict.Clean, Name, null));
    }
}

/// <summary>Turns a route template into a path a request can name: every parameter gets a value of its kind.</summary>
internal static class CreatorDoorRouteWalk
{
    public static string Fill(string template) => System.Text.RegularExpressions.Regex.Replace(template, @"\{\*{0,2}([^}:?=]+)(?::([^}?=]+))?[^}]*\}", match =>
    {
        var constraint = match.Groups[2].Success ? match.Groups[2].Value.ToLowerInvariant() : string.Empty;
        return constraint switch
        {
            var c when c.StartsWith("int", StringComparison.Ordinal) || c.StartsWith("long", StringComparison.Ordinal) => "1",
            var c when c.StartsWith("bool", StringComparison.Ordinal) => "true",
            var c when c.StartsWith("datetime", StringComparison.Ordinal) => "2026-11-25",
            _ => "5c150000-0000-4000-8000-0000000000aa",
        };
    });
}
