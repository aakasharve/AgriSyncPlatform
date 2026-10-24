using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace User.Api.Endpoints;

public static class AuthCookieOptions
{
    public const string RefreshCookieName = "agrisync_refresh";
    private const string RefreshCookiePath = "/user/auth";

    /// <summary>
    /// Environments that are served over plain http://localhost and never face a real user:
    /// local Development and the "CI" environment the e2e workflow boots the API in.
    /// Chromium treats http://localhost as a secure context and stores Secure cookies there;
    /// WebKit (Safari engine) does not, so a Secure refresh cookie is silently dropped and
    /// every remembered boot lands on the login page. Production, Staging and any other
    /// environment keep Secure + SameSite=None.
    /// </summary>
    private static bool IsPlainHttpLocalEnvironment(IHostEnvironment env) =>
        env.IsDevelopment() || env.IsEnvironment("CI");

    /// <param name="refreshExpiresAtUtc">
    /// The REFRESH credential's expiry (RefreshTokenPolicy.Lifetime, ~30 days), NOT the
    /// ~15-minute access-token expiry. The cookie is the web refresh credential, so it must
    /// live exactly as long as the stored row; borrowing the access expiry signed remembered
    /// web users out after a short offline spell although their server session was valid.
    /// </param>
    public static CookieOptions Build(IHostEnvironment env, DateTime refreshExpiresAtUtc, bool rememberDevice) => new()
    {
        HttpOnly = true,
        Secure = !IsPlainHttpLocalEnvironment(env),
        // SameSite=None requires Secure(HTTPS); local http dev would have the browser reject it.
        SameSite = IsPlainHttpLocalEnvironment(env) ? SameSiteMode.Lax : SameSiteMode.None,
        Path = RefreshCookiePath,
        // Persistent only when remembered; otherwise a session cookie (cleared on browser close).
        Expires = rememberDevice ? new DateTimeOffset(DateTime.SpecifyKind(refreshExpiresAtUtc, DateTimeKind.Utc), TimeSpan.Zero) : null,
        IsEssential = true,
    };

    public static CookieOptions BuildForDelete(IHostEnvironment env) => new()
    {
        HttpOnly = true,
        Secure = !IsPlainHttpLocalEnvironment(env),
        SameSite = IsPlainHttpLocalEnvironment(env) ? SameSiteMode.Lax : SameSiteMode.None,
        Path = RefreshCookiePath,
        IsEssential = true,
    };
}
