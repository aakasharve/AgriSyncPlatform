using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;
using ShramSafal.Application.UseCases.Dfes.GetFarmerEngagement;

namespace ShramSafal.Api.Endpoints;

public static class DfesEndpoints
{
    // Asia/Kolkata is a fixed +05:30 offset (no DST) — mirrors
    // DailyRichnessDerivationService's local-date computation so the "today"
    // default below resolves to the same farm-local day the aggregate is keyed on.
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

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

        // GET /shramsafal/day-understanding?farmId={guid}&date=yyyy-MM-dd
        // The single farmer-facing "Day Understanding Score" (X/10) for the active
        // farm's day — DERIVED server-side from the internal lens scores. Returns
        // ONLY { score } (null when nothing scorable is logged for the day); the
        // three DFES lenses NEVER cross to the client. `date` defaults to the
        // farm-local (IST) today.
        group.MapGet("/day-understanding", async (
            Guid farmId,
            DateOnly? date,
            ClaimsPrincipal user,
            [FromServices] GetDayUnderstandingHandler handler,
            [FromServices] IClock clock,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var localDate = date ?? DateOnly.FromDateTime(clock.UtcNow + IstOffset);

            var result = await handler.HandleAsync(
                new GetDayUnderstandingQuery(farmId, localDate, actorUserId), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetDayUnderstanding");

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
