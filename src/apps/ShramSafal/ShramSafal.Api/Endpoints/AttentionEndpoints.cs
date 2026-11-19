using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// CEI Phase 1 §4.2 — Attention Board endpoint.
/// Returns a ranked list of plots that need attention for the calling user.
/// Cache-Control: private, max-age=60 (client-side only).
/// </summary>
public static class AttentionEndpoints
{
    public static RouteGroupBuilder MapAttentionEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/attention", async (
            DateTime? asOf,
            ClaimsPrincipal user,
            GetAttentionBoardHandler handler,
            ICallerUserTenantScope userScope,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane MU-3 fix 1 (review item 12) — the board spans every farm of the caller, so it is read under his OWN
            // user scope (the route opened none: its first read failed closed, 500 for everyone). The handler keeps
            // only the farms whose seat reads the overview (a कामगार's does not), as the pull does.
            var result = await userScope.RunForCallerAsync(
                actorUserId, token => handler.HandleAsync(new GetAttentionBoardQuery(actorUserId, asOf), token), ct);
            if (!result.IsSuccess)
                return ToErrorResult(result.Error);

            // Cache-Control: private, max-age=60 (nice-to-have, CEI Phase 1)
            httpContext.Response.Headers.CacheControl = "private, max-age=60";
            return Results.Ok(result.Value);
        })
        .WithName("GetAttentionBoard");

        return group;
    }

    private static IResult ToErrorResult(Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(Error error)
    {
        return error.Code.Contains("NotFound") ? Results.NotFound(error.Description)
            : error.Code.Contains("Forbidden") ? Results.Forbid()
            : Results.BadRequest(error.Description);
    }
}
