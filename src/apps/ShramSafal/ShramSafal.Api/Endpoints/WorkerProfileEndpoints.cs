using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Work.GetWorkerProfile;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// CEI Phase 4 §4.8 — HTTP surface for worker profile + ReliabilityScore.
/// </summary>
public static class WorkerProfileEndpoints
{
    public static RouteGroupBuilder MapWorkerProfileEndpoints(this RouteGroupBuilder group)
    {
        // GET /workers/{userId}/profile?farmId=... → 200
        group.MapGet("/workers/{userId:guid}/profile", async (
            Guid userId,
            Guid? farmId,
            ClaimsPrincipal user,
            GetWorkerProfileHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var query = new GetWorkerProfileQuery(
                WorkerUserId: new UserId(userId),
                CallerUserId: new UserId(actorUserId),
                ScopedFarmId: farmId);

            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetWorkerProfile");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
            return Results.Forbid();

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}
