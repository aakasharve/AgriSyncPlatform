using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace User.Api.Endpoints;

public static class AuthCookieOptions
{
    public const string RefreshCookieName = "agrisync_refresh";
    private const string RefreshCookiePath = "/user/auth";

    public static CookieOptions Build(IHostEnvironment env, DateTime expiresAtUtc, bool rememberDevice) => new()
    {
        HttpOnly = true,
        Secure = !env.IsDevelopment(),
        // SameSite=None requires Secure(HTTPS); local http dev would have the browser reject it.
        SameSite = env.IsDevelopment() ? SameSiteMode.Lax : SameSiteMode.None,
        Path = RefreshCookiePath,
        // Persistent only when remembered; otherwise a session cookie (cleared on browser close).
        Expires = rememberDevice ? new DateTimeOffset(expiresAtUtc, TimeSpan.Zero) : null,
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
