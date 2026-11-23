using System.Text.Json;
using FluentAssertions;
using User.Domain.Security;
using Xunit;

namespace User.Api.Tests.Auth;

/// <summary>
/// Which response shape each sign-in route gives, for each combination of the
/// <c>X-Client-Platform</c> and <c>Origin</c> request headers.
///
/// <para>The native shape (refresh token in the body, and the body token accepted when no cookie is
/// sent) is for the installed Android app: it sends <c>X-Client-Platform: android</c> with the origin
/// of its bundled page (<c>https://localhost</c>), or the capacitor origin, or no origin at all. A
/// request that comes from one of the configured web hosts always gets the cookie-only shape,
/// whatever the platform header says. Every route that distinguishes the two goes through the
/// same helper, so each is covered here.</para>
///
/// <para>The real routes and handlers run; only the persistence ports are in-memory
/// (see <see cref="AuthRouteHost"/>).</para>
/// </summary>
public sealed class NativeClientDetectionRouteTests(AuthRouteHost host) : IClassFixture<AuthRouteHost>
{
    private const string Android = "android";

    /// <summary>(platform header, Origin header, expected: native shape?)</summary>
    public static TheoryData<string?, string?, bool> Scenarios => new()
    {
        // The platform header with a configured web origin is a browser request: cookie-only shape.
        { Android, "https://app.shramsafal.in", false },
        { Android, "https://shramsafal.in", false },
        { Android, "https://admin.shramsafal.in", false },
        // The installed app: its own origins, or none.
        { Android, "https://localhost", true },
        { Android, "capacitor://localhost", true },
        { Android, null, true },
        // Without the platform header the request has always been a web request.
        { null, "https://app.shramsafal.in", false },
        { null, "https://localhost", false },
        { null, null, false },
    };

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Register_body_follows_the_client_kind(string? platform, string? origin, bool native)
    {
        var reply = await host.PostAsync(
            "/user/auth/register",
            new { phone = AuthRouteHost.NewPhone(), password = AuthRouteHost.Password, displayName = "Test User" },
            platform, origin);

        reply.Status.Should().Be(200, reply.Raw);
        reply.BodyHasRefreshToken.Should().Be(native, reply.Raw);
        reply.SetsRefreshCookie.Should().BeTrue("the cookie is set for every client kind");
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Login_body_follows_the_client_kind(string? platform, string? origin, bool native)
    {
        var (phone, _) = host.SeedUser();

        var reply = await host.PostAsync("/user/auth/login", new { phone, password = AuthRouteHost.Password }, platform, origin);

        reply.Status.Should().Be(200, reply.Raw);
        reply.BodyHasRefreshToken.Should().Be(native, reply.Raw);
        reply.SetsRefreshCookie.Should().BeTrue();
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task VerifyOtp_body_follows_the_client_kind(string? platform, string? origin, bool native)
    {
        var phone = host.SeedOtpFor(AuthRouteHost.NewPhone());

        var reply = await host.PostAsync("/user/auth/verify-otp", new { phone, otp = AuthRouteHost.Otp, displayName = "Test User" }, platform, origin);

        reply.Status.Should().Be(200, reply.Raw);
        reply.BodyHasRefreshToken.Should().Be(native, reply.Raw);
        reply.SetsRefreshCookie.Should().BeTrue();
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Refresh_body_follows_the_client_kind_when_the_cookie_carries_the_token(string? platform, string? origin, bool native)
    {
        var (raw, _) = host.SeedSession();

        var reply = await host.PostAsync("/user/auth/refresh", new { }, platform, origin, cookieToken: raw);

        reply.Status.Should().Be(200, reply.Raw);
        reply.BodyHasRefreshToken.Should().Be(native, reply.Raw);
        reply.SetsRefreshCookie.Should().BeTrue();
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Refresh_accepts_a_body_token_only_for_the_native_client(string? platform, string? origin, bool native)
    {
        var (raw, _) = host.SeedSession();

        var reply = await host.PostAsync("/user/auth/refresh", new { refreshToken = raw }, platform, origin);

        reply.Status.Should().Be(native ? 200 : 401, reply.Raw);
        if (native)
        {
            reply.BodyHasRefreshToken.Should().BeTrue();
        }
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task DeviceCheck_accepts_a_body_token_only_for_the_native_client(string? platform, string? origin, bool native)
    {
        var (raw, _) = host.SeedSession(hold: DeviceCheckState.AskedAfterSmsCode);

        var reply = await host.PostAsync("/user/auth/device-check", new { answer = "yes", refreshToken = raw }, platform, origin);

        reply.Status.Should().Be(native ? 200 : 401, reply.Raw);
        if (native)
        {
            reply.Body.GetProperty("outcome").GetString().Should().Be("confirmed");
        }
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task DeviceCheck_with_the_cookie_works_for_every_client_kind(string? platform, string? origin, bool native)
    {
        _ = native;
        var (raw, _) = host.SeedSession(hold: DeviceCheckState.AskedAfterSmsCode);

        var reply = await host.PostAsync("/user/auth/device-check", new { answer = "yes" }, platform, origin, cookieToken: raw);

        reply.Status.Should().Be(200, reply.Raw);
        reply.Body.GetProperty("outcome").GetString().Should().Be("confirmed");
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Logout_ends_the_session_from_a_body_token_only_for_the_native_client(string? platform, string? origin, bool native)
    {
        var (raw, _) = host.SeedSession();

        var reply = await host.PostAsync("/user/auth/logout", new { refreshToken = raw }, platform, origin);

        reply.Status.Should().Be(200, reply.Raw);
        host.Sessions.Find(raw)!.IsRevoked.Should().Be(native, "only the native client's body token is honoured");
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Logout_with_the_cookie_ends_the_session_for_every_client_kind(string? platform, string? origin, bool native)
    {
        _ = native;
        var (raw, _) = host.SeedSession();

        var reply = await host.PostAsync("/user/auth/logout", new { }, platform, origin, cookieToken: raw);

        reply.Status.Should().Be(200, reply.Raw);
        host.Sessions.Find(raw)!.IsRevoked.Should().BeTrue();
    }
}

/// <summary>
/// How the configured origin list is read: it is the same <c>Cors:AllowedOrigins</c> list the CORS
/// policy uses, so the same spelling variants it accepts count here, and the development origins
/// that are not the app's own count as web.
/// </summary>
public sealed class NativeClientDetectionConfigTests
{
    private const string Android = "android";

    private static async Task<bool> IsNativeAsync(AuthRouteHost host, string? origin)
    {
        var (raw, _) = host.SeedSession();
        var reply = await host.PostAsync("/user/auth/refresh", new { refreshToken = raw }, Android, origin);
        return reply.Status == 200 && reply.BodyHasRefreshToken;
    }

    [Theory]
    [InlineData("https://app.shramsafal.in", false)]
    [InlineData("https://APP.shramsafal.in", false)]
    [InlineData("https://localhost", true)]
    [InlineData(null, true)]
    public async Task A_trailing_slash_in_the_configured_list_does_not_change_the_result(string? origin, bool native)
    {
        var host = new AuthRouteHost(["https://app.shramsafal.in/", "https://localhost/", "capacitor://localhost"]);
        await host.InitializeAsync();
        try
        {
            (await IsNativeAsync(host, origin)).Should().Be(native);
        }
        finally
        {
            await host.DisposeAsync();
        }
    }

    [Theory]
    [InlineData("http://localhost:5173", false)]
    [InlineData("http://127.0.0.1:5173", false)]
    [InlineData("http://localhost", true)]
    [InlineData("capacitor://localhost", true)]
    [InlineData(null, true)]
    public async Task Development_origins_other_than_the_apps_own_count_as_web(string? origin, bool native)
    {
        var host = new AuthRouteHost(
            ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost", "capacitor://localhost"]);
        await host.InitializeAsync();
        try
        {
            (await IsNativeAsync(host, origin)).Should().Be(native);
        }
        finally
        {
            await host.DisposeAsync();
        }
    }
}
