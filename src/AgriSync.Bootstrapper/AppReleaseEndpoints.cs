using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace AgriSync.Bootstrapper;

/// <summary>
/// Lane UPD-1 (founder D-53, register F43, doctrine P11) — "a newer version is available".
/// <para>
/// The app ships on Google Play AND as an APK from shramsafal.in/apk. A downloaded APK can never
/// update itself, so the phone asks THIS endpoint which version is the newest and tells the farmer.
/// The answer comes from configuration only (<c>AppRelease:*</c> in appsettings, or
/// <c>AppRelease__LatestVersion</c> etc. in the environment). Nothing here is a secret, nothing is
/// stored, and no database is touched.
/// </para>
/// <para>
/// Not configured = <c>latestVersion: null</c>, and the phone shows nothing (doctrine P4: the server
/// never invents a version it was not told about).
/// </para>
/// </summary>
public sealed class AppReleaseOptions
{
    public const string SectionName = "AppRelease";

    /// <summary>The newest released app version, e.g. <c>1.0.18</c>. Empty = none announced.</summary>
    public string? LatestVersion { get; set; }

    /// <summary>
    /// Optional. Phones below it are told the old version may stop working soon. It never blocks
    /// the app (P11); the phone only makes its card not dismissible.
    /// </summary>
    public string? MinimumVersion { get; set; }

    /// <summary>The Play listing. The phone opens it only if it is on its own allow-list.</summary>
    public string? PlayStoreUrl { get; set; }

    /// <summary>The APK download page (normally https://shramsafal.in/apk). Allow-listed on the phone.</summary>
    public string? ApkUrl { get; set; }
}

/// <summary>The wire shape: <c>{ latestVersion, minimumVersion, playStoreUrl, apkUrl }</c> (camelCase).</summary>
public sealed record AppReleaseResponse(
    string? LatestVersion,
    string? MinimumVersion,
    string? PlayStoreUrl,
    string? ApkUrl);

public static class AppReleaseEndpoints
{
    /// <summary>
    /// Mounted UNDER <c>/version</c> on purpose: <c>TenantTransactionMiddleware.SkipPathPrefixes</c>
    /// already lists <c>/version</c>, so this anonymous read never opens a per-request database
    /// transaction (it has no tenant and needs no database). Pinned by
    /// <c>AppReleaseEndpointTests.Route_sits_under_a_tenant_skip_listed_prefix</c>.
    /// </summary>
    public const string Route = "/version/app";

    /// <summary>Short-lived (five minutes): a new release reaches phones within minutes of the config change.</summary>
    public const string CacheControl = "public, max-age=300";

    public static IServiceCollection AddAppReleaseOptions(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<AppReleaseOptions>()
            .Bind(configuration.GetSection(AppReleaseOptions.SectionName));
        return services;
    }

    public static IEndpointRouteBuilder MapAppRelease(this IEndpointRouteBuilder app)
    {
        app.MapGet(Route, (
            HttpContext http,
            IOptionsMonitor<AppReleaseOptions> options,
            ILoggerFactory loggerFactory) =>
        {
            var logger = loggerFactory.CreateLogger("AgriSync.Bootstrapper.AppRelease");
            var answer = AppReleaseAnswer.From(options.CurrentValue, logger);
            http.Response.Headers.CacheControl = CacheControl;
            return Results.Ok(answer);
        })
        .WithName("GetAppRelease")
        .WithTags("System")
        .AllowAnonymous();

        return app;
    }
}

/// <summary>
/// Turns the configured values into the answer, refusing anything malformed rather than passing it
/// on: a wrong version string would make phones compare garbage, so it becomes <c>null</c> and a
/// warning names the setting to fix.
/// </summary>
public static class AppReleaseAnswer
{
    // 1 to 4 numeric parts ("1", "1.0", "1.0.18", "1.0.18.2"), each at most 5 digits.
    private static readonly Regex VersionShape = new(@"^\d{1,5}(\.\d{1,5}){0,3}$", RegexOptions.CultureInvariant);

    public static AppReleaseResponse From(AppReleaseOptions options, ILogger logger)
    {
        var playStoreUrl = ReadUrl(options.PlayStoreUrl, nameof(AppReleaseOptions.PlayStoreUrl), logger);
        var apkUrl = ReadUrl(options.ApkUrl, nameof(AppReleaseOptions.ApkUrl), logger);

        var latest = ReadVersion(options.LatestVersion, nameof(AppReleaseOptions.LatestVersion), logger);
        if (latest is null)
        {
            // Nothing announced: a minimum on its own would point the farmer at nothing.
            if (!string.IsNullOrWhiteSpace(options.MinimumVersion))
            {
                logger.LogWarning(
                    "AppRelease:MinimumVersion is set but AppRelease:LatestVersion is not; the minimum is ignored.");
            }

            return new AppReleaseResponse(null, null, playStoreUrl, apkUrl);
        }

        var minimum = ReadVersion(options.MinimumVersion, nameof(AppReleaseOptions.MinimumVersion), logger);
        if (minimum is not null && Compare(minimum, latest) > 0)
        {
            logger.LogWarning(
                "AppRelease:MinimumVersion {Minimum} is above AppRelease:LatestVersion {Latest}; the minimum is ignored.",
                minimum,
                latest);
            minimum = null;
        }

        return new AppReleaseResponse(latest, minimum, playStoreUrl, apkUrl);
    }

    /// <summary>Numeric, part by part: 1.0.10 is above 1.0.9; a missing part counts as 0.</summary>
    public static int Compare(string left, string right)
    {
        var a = Parts(left);
        var b = Parts(right);
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var x = i < a.Length ? a[i] : 0;
            var y = i < b.Length ? b[i] : 0;
            if (x != y)
            {
                return x.CompareTo(y);
            }
        }

        return 0;
    }

    private static int[] Parts(string version) =>
        version.Split('.').Select(p => int.Parse(p, NumberStyles.None, CultureInfo.InvariantCulture)).ToArray();

    private static string? ReadVersion(string? raw, string setting, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var value = raw.Trim();
        if (VersionShape.IsMatch(value))
        {
            return value;
        }

        logger.LogWarning("AppRelease:{Setting} '{Value}' is not a version like 1.0.18; it is ignored.", setting, value);
        return null;
    }

    private static string? ReadUrl(string? raw, string setting, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var value = raw.Trim();
        if (Uri.TryCreate(value, UriKind.Absolute, out _))
        {
            return value;
        }

        logger.LogWarning("AppRelease:{Setting} '{Value}' is not an absolute URL; it is ignored.", setting, value);
        return null;
    }
}
