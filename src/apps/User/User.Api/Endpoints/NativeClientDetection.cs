namespace User.Api.Endpoints;

/// <summary>
/// The one place that decides whether an auth request is from the installed native (Android) app,
/// which gets the refresh token in the response body and may present it in a request body, or from
/// a web client, which relies on the HttpOnly cookie alone. Every auth route that distinguishes the
/// two calls <see cref="IsNativeClient"/>.
///
/// <para>The platform header (<c>X-Client-Platform: android</c>) is the claim. It is not enough on its
/// own: a request that carries an <c>Origin</c> header naming one of the web hosts this API
/// serves is a web request whatever the header says. The installed app's own origins
/// (<c>https://localhost</c>, <c>capacitor://localhost</c>) and a request with no <c>Origin</c> at all
/// keep the native shape, so installed app versions are unaffected.</para>
///
/// <para>The web hosts are not listed here: they are the origins in the same
/// <c>Cors:AllowedOrigins</c> configuration the CORS policy reads (Bootstrapper Program.cs), minus the
/// app's own origins.</para>
/// </summary>
internal static class NativeClientDetection
{
    private const string PlatformHeader = "X-Client-Platform";
    private const string NativePlatform = "android";

    /// <summary>Same key the CORS policy reads in Program.cs.</summary>
    private const string AllowedOriginsKey = "Cors:AllowedOrigins";

    /// <summary>Origins the installed app (or a native shell) sends; these are never web hosts, even when listed for CORS.</summary>
    private static readonly string[] AppOrigins =
    [
        "https://localhost",
        "http://localhost",
        "capacitor://localhost",
    ];

    public static bool IsNativeClient(HttpContext ctx) =>
        string.Equals(
            ctx.Request.Headers[PlatformHeader].FirstOrDefault(),
            NativePlatform,
            StringComparison.OrdinalIgnoreCase)
        && !IsFromConfiguredWebOrigin(ctx);

    private static bool IsFromConfiguredWebOrigin(HttpContext ctx)
    {
        var requestOrigins = ctx.Request.Headers["Origin"];
        if (requestOrigins.Count == 0)
        {
            return false;
        }

        var webOrigins = ctx.RequestServices.GetRequiredService<IConfiguration>()
            .GetSection(AllowedOriginsKey)
            .GetChildren()
            .Select(child => Normalize(child.Value))
            .Where(origin => origin.Length > 0 && !AppOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return requestOrigins.Any(origin => webOrigins.Contains(Normalize(origin)));
    }

    // CORS accepts a configured origin with or without a trailing slash; so does this.
    private static string Normalize(string? origin) => (origin ?? string.Empty).Trim().TrimEnd('/');
}
