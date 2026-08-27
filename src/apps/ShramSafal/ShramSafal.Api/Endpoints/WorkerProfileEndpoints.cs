using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Work.GetWorkerProfile;
using ShramSafal.Application.UseCases.Work.GetWorkerReputation;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// CEI Phase 4 §4.8 — HTTP surface for worker profile + ReliabilityScore.
///
/// <para>spec: dfes-companion-2026-07-11 (wave-4.4) — two routes that look alike and are
/// opposites. <c>/profile</c> is TIER 1: one farm's operational record of its own work,
/// which never leaves that farm. <c>/reputation</c> is TIERS 2+3: the employers' own words
/// and the counts Shram Safal derived, the only worker data designed to travel, and only
/// on the worker's own recorded consent.</para>
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

        // GET /workers/{userId}/reputation → 200
        //
        // Tiers 2 + 3 only. NOTE the missing farmId parameter, and do not add one: a
        // reputation is not a per-farm view, and a farm id here would let a caller name
        // someone else's farm and read its record of the man — the tier-1 leak this whole
        // model closes.
        group.MapGet("/workers/{userId:guid}/reputation", async (
            Guid userId,
            ClaimsPrincipal user,
            GetWorkerReputationHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var query = new GetWorkerReputationQuery(
                WorkerUserId: new UserId(userId),
                CallerUserId: new UserId(actorUserId));

            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetWorkerReputation");

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
