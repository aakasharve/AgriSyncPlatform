using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
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
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var result = await handler.HandleAsync(new GetAttentionBoardQuery(actorUserId, asOf), ct);
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
    {
        return error.Code.Contains("NotFound") ? Results.NotFound(error.Description)
            : error.Code.Contains("Forbidden") ? Results.Forbid()
            : Results.BadRequest(error.Description);
    }
}
