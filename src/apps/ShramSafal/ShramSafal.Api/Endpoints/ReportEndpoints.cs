using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Reports.GetFarmWeekMis;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Phase 6 Owner MIS — per-farm weekly report endpoint.
/// Requires Trialing or Active subscription (MisRead entitlement gate).
/// Workers see Forbidden. Free-trial-expired owners see Forbidden with a
/// "upgrade to view reports" error code the frontend can check.
/// </summary>
public static class ReportEndpoints
{
    public static RouteGroupBuilder MapReportEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/reports/farm-week/{farmId:guid}", async (
            Guid farmId,
            ClaimsPrincipal user,
            GetFarmWeekMisHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new GetFarmWeekMisQuery(farmId, actorUserId), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmWeekMis");

        return group;
    }

    private static IResult ToErrorResult(Error error) =>
        error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : error.Code.EndsWith("Forbidden", StringComparison.Ordinal)
                ? Results.Forbid()
                : Results.BadRequest(new { error = error.Code, message = error.Description });
}
