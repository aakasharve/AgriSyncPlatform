using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using User.Api.Endpoints;
using Xunit;

namespace User.Api.Tests.Auth;

/// <summary>
/// Unit tests for <see cref="AuthCookieOptions.Build"/> and
/// <see cref="AuthCookieOptions.BuildForDelete"/> — asserts security-critical
/// cookie attributes at the value level so a regression (e.g. HttpOnly = false)
/// fails here before it reaches production.
///
/// spec: secure-remembered-device-sessions-2026-06-24
///
/// DEFERRED: Full WebApplicationFactory endpoint test (RememberedDeviceSessionsApiTests)
/// that round-trips login/refresh/logout through the hosted ASP.NET Core pipeline and
/// inspects Set-Cookie response headers is NOT built here.  Reason: no User auth
/// endpoint test harness with a live DB exists in this solution yet, and standing one
/// up is out of scope for this fix pass.  Tracking note: defer to CI / founder-test;
/// the unit tests below cover the security-attribute regression risk on AuthCookieOptions
/// itself.
/// </summary>
public sealed class AuthCookieOptionsTests
{
    // ── helpers ──────────────────────────────────────────────────────────────

    private static IHostEnvironment MakeEnv(bool isDevelopment)
    {
        var env = new FakeHostEnvironment(isDevelopment ? "Development" : "Production");
        return env;
    }

    private static readonly DateTime SampleExpiry = new(2099, 12, 31, 0, 0, 0, DateTimeKind.Utc);

    // ── Build() — HttpOnly ────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Build_always_sets_HttpOnly(bool isDevelopment)
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment), SampleExpiry, rememberDevice: true);
        opts.HttpOnly.Should().BeTrue("the refresh cookie must always be HttpOnly");
    }

    // ── Build() — Secure ─────────────────────────────────────────────────────

    [Fact]
    public void Build_sets_Secure_false_in_Development()
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: true), SampleExpiry, rememberDevice: true);
        opts.Secure.Should().BeFalse("local http dev would have the browser reject a Secure cookie");
    }

    [Fact]
    public void Build_sets_Secure_true_in_Production()
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: false), SampleExpiry, rememberDevice: true);
        opts.Secure.Should().BeTrue("the refresh cookie must require HTTPS in production");
    }

    [Fact]
    public void Build_in_CI_environment_is_http_local_compatible_for_webkit()
    {
        var opts = AuthCookieOptions.Build(new FakeHostEnvironment("CI"), SampleExpiry, rememberDevice: true);
        opts.Secure.Should().BeFalse("WebKit drops Secure cookies on http://localhost; the e2e API runs as CI");
        opts.SameSite.Should().Be(SameSiteMode.Lax);
        opts.HttpOnly.Should().BeTrue();
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Build_stays_Secure_SameSiteNone_outside_Development_and_CI(string envName)
    {
        var opts = AuthCookieOptions.Build(new FakeHostEnvironment(envName), SampleExpiry, rememberDevice: true);
        opts.Secure.Should().BeTrue();
        opts.SameSite.Should().Be(SameSiteMode.None);
        AuthCookieOptions.BuildForDelete(new FakeHostEnvironment(envName)).Secure.Should().BeTrue();
    }

    // ── Build() — SameSite ────────────────────────────────────────────────────

    [Fact]
    public void Build_sets_SameSite_Lax_in_Development()
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: true), SampleExpiry, rememberDevice: true);
        opts.SameSite.Should().Be(SameSiteMode.Lax,
            "SameSite=None requires Secure/HTTPS; local dev must use Lax instead");
    }

    [Fact]
    public void Build_sets_SameSite_None_in_Production()
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: false), SampleExpiry, rememberDevice: true);
        opts.SameSite.Should().Be(SameSiteMode.None,
            "SameSite=None is required so the cookie is sent on cross-site refresh calls from the SPA");
    }

    // ── Build() — Path ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Build_sets_Path_to_user_auth(bool isDevelopment)
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment), SampleExpiry, rememberDevice: true);
        opts.Path.Should().Be("/user/auth",
            "scoping the cookie to /user/auth prevents it from being sent on unrelated API calls");
    }

    // ── Build() — Expires / rememberDevice ────────────────────────────────────

    [Fact]
    public void Build_sets_Expires_when_rememberDevice_is_true()
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: false), SampleExpiry, rememberDevice: true);
        opts.Expires.Should().NotBeNull("a remembered-device session must be persistent across browser restarts");
        opts.Expires!.Value.UtcDateTime.Should().Be(SampleExpiry,
            "Expires must equal the token's ExpiresAtUtc so they expire together");
    }

    [Fact]
    public void Build_leaves_Expires_null_when_rememberDevice_is_false()
    {
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: false), SampleExpiry, rememberDevice: false);
        opts.Expires.Should().BeNull(
            "without rememberDevice the cookie is a session cookie cleared when the browser closes");
    }

    // ── Build() — lifetime follows the REFRESH credential, not the access token ──
    // spec: 2026-08-25-prod-cutover-waves. The endpoints used to pass the access
    // token's ~15-minute ExpiresAtUtc, so a remembered web user lost the cookie
    // (and the session) after a short offline spell although the DB row lived 30 days.

    [Fact]
    public void Build_Expires_is_the_refresh_expiry_even_when_far_past_the_access_expiry()
    {
        var now = new DateTime(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);
        var refreshExpiry = now.Add(User.Application.UseCases.Auth.Session.RefreshTokenPolicy.Lifetime);
        var opts = AuthCookieOptions.Build(MakeEnv(isDevelopment: false), refreshExpiry, rememberDevice: true);
        opts.Expires!.Value.UtcDateTime.Should().Be(now.AddDays(30));
        opts.Expires!.Value.UtcDateTime.Should().BeAfter(now.AddMinutes(15).AddDays(29));
    }

    [Fact]
    public void Endpoints_stamp_the_cookie_with_RefreshExpiresAtUtc_never_the_access_ExpiresAtUtc()
    {
        var path = FindUp("src/apps/User/User.Api/Endpoints/AuthEndpoints.cs");
        var source = File.ReadAllText(path);
        source.Should().NotContain("AuthCookieOptions.Build(env, result.Value.ExpiresAtUtc",
            "ExpiresAtUtc is the ~15 min access-token expiry");
        System.Text.RegularExpressions.Regex.Matches(source, @"AuthCookieOptions\.Build\(env, result\.Value!?\.RefreshExpiresAtUtc")
            .Count.Should().Be(4, "register, login, verify-otp and refresh all set the cookie");
    }

    private static string FindUp(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, relative.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(relative);
    }

    // ── BuildForDelete() ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void BuildForDelete_sets_HttpOnly(bool isDevelopment)
    {
        var opts = AuthCookieOptions.BuildForDelete(MakeEnv(isDevelopment));
        opts.HttpOnly.Should().BeTrue();
    }

    [Fact]
    public void BuildForDelete_sets_Path_to_user_auth()
    {
        var opts = AuthCookieOptions.BuildForDelete(MakeEnv(isDevelopment: false));
        opts.Path.Should().Be("/user/auth",
            "the delete options must match the cookie Path exactly or the browser will not clear it");
    }

    [Fact]
    public void BuildForDelete_sets_Secure_true_in_Production()
    {
        var opts = AuthCookieOptions.BuildForDelete(MakeEnv(isDevelopment: false));
        opts.Secure.Should().BeTrue();
    }

    [Fact]
    public void BuildForDelete_sets_Secure_false_in_Development()
    {
        var opts = AuthCookieOptions.BuildForDelete(MakeEnv(isDevelopment: true));
        opts.Secure.Should().BeFalse();
    }

    [Fact]
    public void BuildForDelete_sets_SameSite_None_in_Production()
    {
        var opts = AuthCookieOptions.BuildForDelete(MakeEnv(isDevelopment: false));
        opts.SameSite.Should().Be(SameSiteMode.None,
            "SameSite must match the original cookie attribute so the browser clears it");
    }

    [Fact]
    public void BuildForDelete_sets_SameSite_Lax_in_Development()
    {
        var opts = AuthCookieOptions.BuildForDelete(MakeEnv(isDevelopment: true));
        opts.SameSite.Should().Be(SameSiteMode.Lax);
    }

    // ── fake IHostEnvironment ─────────────────────────────────────────────────

    private sealed class FakeHostEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "Test";
        public string ContentRootPath { get; set; } = "/";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
