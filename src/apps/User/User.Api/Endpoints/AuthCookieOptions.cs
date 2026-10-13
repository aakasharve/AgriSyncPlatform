using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace User.Api.Endpoints;

public static class AuthCookieOptions
{
    public const string RefreshCookieName = "agrisync_refresh";
    private const string RefreshCookiePath = "/user/auth";

    /// <param name="refreshExpiresAtUtc">
    /// The REFRESH credential's expiry (RefreshTokenPolicy.Lifetime, ~30 days), NOT the
    /// ~15-minute access-token expiry. The cookie is the web refresh credential, so it must
    /// live exactly as long as the stored row; borrowing the access expiry signed remembered
    /// web users out after a short offline spell although their server session was valid.
    /// </param>
    public static CookieOptions Build(IHostEnvironment env, DateTime refreshExpiresAtUtc, bool rememberDevice) => new()
    {
        HttpOnly = true,
        Secure = !env.IsDevelopment(),
        // SameSite=None requires Secure(HTTPS); local http dev would have the browser reject it.
        SameSite = env.IsDevelopment() ? SameSiteMode.Lax : SameSiteMode.None,
        Path = RefreshCookiePath,
        // Persistent only when remembered; otherwise a session cookie (cleared on browser close).
        Expires = rememberDevice ? new DateTimeOffset(DateTime.SpecifyKind(refreshExpiresAtUtc, DateTimeKind.Utc), TimeSpan.Zero) : null,
        IsEssential = true,
    };

    public static CookieOptions BuildForDelete(IHostEnvironment env) => new()
    {
        HttpOnly = true,
        Secure = !env.IsDevelopment(),
        SameSite = env.IsDevelopment() ? SameSiteMode.Lax : SameSiteMode.None,
        Path = RefreshCookiePath,
        IsEssential = true,
    };
}
