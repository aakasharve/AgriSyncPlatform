// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85)
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Auth.DeviceCheck;

/// <summary>
/// The server half of the new-phone question. A phone the account has not confirmed holds an access token with
/// <c>device_check = pending</c> (<see cref="DeviceCheckClaims"/>). Such a token is refused on EVERY route that is not
/// anonymous, with HTTP 403 <c>auth.device_unconfirmed</c>: the sync pull, every REST read, every write, and
/// <c>logout-all</c> (so a stranger's phone can never sign the owner's phones out, D-85). Only the account's display
/// name, returned by the sign-in answer itself, reaches such a phone.
///
/// <para><b>Anonymous routes</b> (sign-in, refresh, logout, the answer route, health, version, the pre-login consent
/// tick) stay open, but the held token's identity is REMOVED before they run: a route that reads the caller when a
/// token happens to be present (the consent tick records "who" from the token) sees nobody, exactly as for a phone
/// that sent no token. So a held phone can never write in the account's name either.</para>
///
/// <para>Must run after <c>UseAuthentication</c> (the principal is read) and before <c>UseAuthorization</c>, so the
/// refusal carries its own code rather than a policy's bare 403.</para>
/// </summary>
public sealed class DeviceCheckGateMiddleware(RequestDelegate next, ILogger<DeviceCheckGateMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (!IsHeld(context.User))
        {
            await next(context);
            return;
        }

        if (context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is not null)
        {
            // An open route: it runs, but for nobody.
            context.User = new ClaimsPrincipal(new ClaimsIdentity());
            await next(context);
            return;
        }

        logger.LogInformation(
            "New-phone question not yet answered: {Method} {Path} refused with {Code}.",
            context.Request.Method,
            context.Request.Path,
            DeviceCheckClaims.UnconfirmedErrorCode);

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = DeviceCheckClaims.UnconfirmedErrorCode,
            message = "This phone has not yet confirmed that this account is yours.",
        });
    }

    /// <summary>True for a signed-in principal whose token says the phone has not answered yet.</summary>
    public static bool IsHeld(ClaimsPrincipal? user) =>
        user?.Identity?.IsAuthenticated == true
        && user.HasClaim(DeviceCheckClaims.Type, DeviceCheckClaims.Pending);
}

public static class DeviceCheckGateExtensions
{
    /// <summary>Adds <see cref="DeviceCheckGateMiddleware"/>; call between <c>UseAuthentication</c> and <c>UseAuthorization</c>.</summary>
    public static IApplicationBuilder UseDeviceCheckGate(this IApplicationBuilder app) =>
        app.UseMiddleware<DeviceCheckGateMiddleware>();
}
