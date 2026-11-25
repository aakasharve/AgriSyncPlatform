using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.IdentityModel.Tokens;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.Creators;

namespace ShramSafal.Api.CreatorDoor;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("/creator/* with its own audience, cookie and CORS policy"); build plan slice 15 (the creator door), server half.

/// <summary>
/// How the creator door is wired into a host, in one place, so the production host and the proof hosts are wired alike:
/// <list type="bullet">
/// <item><b>Its own sign-in scheme</b> (<see cref="AuthScheme"/>): a bearer token is accepted only with the creator door's OWN audience. The main scheme accepts only the main
/// audience, so each door refuses the other's token; nothing in either scheme accepts both.</item>
/// <item><b>Its own CORS policy</b> (<see cref="CorsPolicy"/>): origins from <c>CreatorDoor:AllowedOrigins</c> only. <see cref="UseCorsKeepingCreatorDoorApart"/> runs the
/// main policy on every path EXCEPT <c>/creator</c> and this policy ONLY on <c>/creator</c>: the creator origin is never on the main list and the main list never answers
/// for a creator route.</item>
/// <item><b>The switch</b> (<see cref="UseCreatorDoorGate"/>): while <c>CreatorDoor:Enabled</c> is not true, every <c>/creator</c> request is answered 404 before CORS,
/// sign-in or any route runs, exactly as if the door were not built.</item>
/// </list>
/// </summary>
public static class CreatorDoorComposition
{
    public const string AuthScheme = "CreatorDoor";
    public const string AuthPolicy = "CreatorDoor";
    public const string CorsPolicy = "CreatorDoor";
    public const string PathPrefix = "/creator";

    /// <summary>The per-browser device id the creator web sends with sign-in and every refresh (it makes it once and keeps it).</summary>
    public const string DeviceHeader = "X-Creator-Device-Id";

    public static bool IsCreatorPath(PathString path) => path.StartsWithSegments(PathPrefix, StringComparison.OrdinalIgnoreCase);

    public static IServiceCollection AddCreatorDoor(this IServiceCollection services)
    {
        services.AddAuthentication().AddJwtBearer(AuthScheme, _ => { });
        services.AddOptions<JwtBearerOptions>(AuthScheme).Configure<CreatorDoorSigningKey, CreatorDoorOptions>((bearer, key, door) =>
        {
            // The token names its subject as "sub"; nothing is renamed on the way in.
            bearer.MapInboundClaims = false;
            bearer.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = key.Issuer,
                ValidateAudience = true,
                ValidAudience = door.Audience,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key.Key,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(30),
            };
        });

        services.AddAuthorizationBuilder().AddPolicy(AuthPolicy, policy => policy
            .AddAuthenticationSchemes(AuthScheme)
            .RequireAuthenticatedUser()
            .RequireClaim(CreatorDoorClaims.Door, CreatorDoorClaims.DoorValue));

        services.AddCors();
        services.AddOptions<CorsOptions>().Configure<CreatorDoorOptions>((cors, door) => cors.AddPolicy(CorsPolicy, policy => policy
            .WithOrigins(door.AllowedOrigins.Select(NormalizeOrigin).Where(o => o.Length > 0).ToArray())
            .WithHeaders("Content-Type", "Authorization", "X-Request-Id", DeviceHeader, "traceparent", "tracestate", "baggage")
            .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .AllowCredentials()));

        return services;
    }

    /// <summary>404 for every <c>/creator</c> request while the door is off. Place it BEFORE CORS and sign-in.</summary>
    public static IApplicationBuilder UseCreatorDoorGate(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (IsCreatorPath(context.Request.Path) && !context.RequestServices.GetRequiredService<CreatorDoorOptions>().Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next(context);
    });

    /// <summary>
    /// CORS for the whole host, in place of a bare <c>UseCors(mainPolicy)</c>: the main policy answers every path except <c>/creator</c>, unchanged; the creator door's own
    /// policy answers <c>/creator</c> and nothing else.
    /// </summary>
    public static IApplicationBuilder UseCorsKeepingCreatorDoorApart(this IApplicationBuilder app, string mainPolicy) => app
        .UseWhen(context => !IsCreatorPath(context.Request.Path), main => main.UseCors(mainPolicy))
        .UseWhen(context => IsCreatorPath(context.Request.Path), door => door.UseCors(CorsPolicy));

    /// <summary>True when the request carries an <c>Origin</c> that is one of the creator door's own.</summary>
    public static bool IsFromCreatorOrigin(HttpContext context, CreatorDoorOptions door)
    {
        var origin = NormalizeOrigin(context.Request.Headers.Origin.FirstOrDefault());
        return origin.Length > 0 && door.AllowedOrigins.Any(o => string.Equals(NormalizeOrigin(o), origin, StringComparison.OrdinalIgnoreCase));
    }

    internal static string NormalizeOrigin(string? origin) => (origin ?? string.Empty).Trim().TrimEnd('/');
}

/// <summary>
/// The host refuses to START with the creator door switched on in a way that is not safe. Asked once, after the host is built, before it serves.
/// <list type="bullet">
/// <item>Any environment: a creator origin that is also on the main CORS list (the two lists must never share an origin).</item>
/// <item>Production: no creator origin, or one that is not https; the built-in file check as the only scanner (it is not an anti-virus); no creator terms version.</item>
/// </list>
/// With the door off (the default) it checks nothing and changes nothing.
/// </summary>
public static class CreatorDoorStartupGuard
{
    public static void EnsureSafe(bool isProduction, CreatorDoorOptions door, IEnumerable<string> mainCorsOrigins, ICreatorFileScanner scanner)
    {
        if (!door.Enabled)
        {
            return;
        }

        var doorOrigins = door.AllowedOrigins.Select(CreatorDoorComposition.NormalizeOrigin).Where(o => o.Length > 0).ToList();
        var shared = doorOrigins.Intersect(mainCorsOrigins.Select(CreatorDoorComposition.NormalizeOrigin), StringComparer.OrdinalIgnoreCase).ToList();
        if (shared.Count > 0)
        {
            throw new InvalidOperationException(
                $"The creator door is switched on, but {string.Join(", ", shared)} is listed in BOTH CreatorDoor:AllowedOrigins and Cors:AllowedOrigins. "
                + "The creator origin must never be on the main list. Remove it from Cors:AllowedOrigins. The host did not start.");
        }

        if (!isProduction)
        {
            return;
        }

        if (doorOrigins.Count == 0 || doorOrigins.Any(o => !o.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException(
                "The creator door is switched on in Production, but CreatorDoor:AllowedOrigins is empty or holds an origin that is not https. The host did not start.");
        }

        if (scanner.IsBuiltIn)
        {
            throw new InvalidOperationException(
                "The creator door is switched on in Production with only the built-in file check, which is not an anti-virus. "
                + "Configure a real scanner (the founder's decision) or switch the door off (CreatorDoor:Enabled=false). The host did not start.");
        }

        if (string.IsNullOrWhiteSpace(door.TermsVersion))
        {
            throw new InvalidOperationException(
                "The creator door is switched on in Production, but no creator terms version is set (CreatorDoor:TermsVersion). "
                + "Publish the terms (the founder's decision) and set their version, or switch the door off. The host did not start.");
        }
    }
}

/// <summary>
/// The creator door's refresh cookie: its OWN name and its OWN path (never <c>agrisync_refresh</c>, never <c>/user/auth</c>), so the browser sends it only to this door's
/// sign-in routes and the farmer's routes never see it. HttpOnly always; Secure and SameSite=Strict everywhere except plain-http local development (and the CI environment
/// the e2e workflow boots), where a Secure cookie would be dropped. The credential is in this cookie and nowhere else: no route returns it in a body.
/// </summary>
public static class CreatorDoorCookie
{
    public const string Name = "shramsafal_creator_refresh";
    public const string Path = "/creator/auth";

    private static bool IsPlainHttpLocal(IHostEnvironment env) => env.IsDevelopment() || env.IsEnvironment("CI");

    public static CookieOptions Build(IHostEnvironment env, DateTime refreshExpiresAtUtc) => new()
    {
        HttpOnly = true,
        Secure = !IsPlainHttpLocal(env),
        SameSite = IsPlainHttpLocal(env) ? SameSiteMode.Lax : SameSiteMode.Strict,
        Path = Path,
        Expires = new DateTimeOffset(DateTime.SpecifyKind(refreshExpiresAtUtc, DateTimeKind.Utc), TimeSpan.Zero),
        IsEssential = true,
    };

    public static CookieOptions BuildForDelete(IHostEnvironment env) => new()
    {
        HttpOnly = true,
        Secure = !IsPlainHttpLocal(env),
        SameSite = IsPlainHttpLocal(env) ? SameSiteMode.Lax : SameSiteMode.Strict,
        Path = Path,
        IsEssential = true,
    };
}
