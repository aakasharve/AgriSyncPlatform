using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.UseCases.Dfes.GetFarmerEngagement;

namespace ShramSafal.Api.Endpoints;

public static class DfesEndpoints
{
    public static RouteGroupBuilder MapDfesEndpoints(this RouteGroupBuilder group)
    {
        // GET /shramsafal/engagement?farmId={guid}
        // Read-only DFES engagement projection (streak / points / rich-day bar).
        group.MapGet("/engagement", async (
            Guid farmId,
            ClaimsPrincipal user,
            [FromServices] GetFarmerEngagementHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new GetFarmerEngagementQuery(farmId, actorUserId), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmerEngagement");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}
