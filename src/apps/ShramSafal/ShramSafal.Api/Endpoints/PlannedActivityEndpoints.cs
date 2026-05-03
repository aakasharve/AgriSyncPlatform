using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

namespace ShramSafal.Api.Endpoints;

public static class PlannedActivityEndpoints
{
    public static RouteGroupBuilder MapPlannedActivityEndpoints(this RouteGroupBuilder group)
    {
        // T-IGH-03-PIPELINE-ROLLOUT (OverridePlannedActivity): resolves
        // the pipeline-wrapped IHandler so the canonical
        // InvalidCommand → PlannedActivityNotFound → Forbidden ordering
        // runs before the body's idempotency / audit / save checks.
        group.MapPost("/planned-activities/{id:guid}/override", async (
            Guid id,
            OverridePlannedActivityRequest request,
            ClaimsPrincipal user,
            IHandler<OverridePlannedActivityCommand> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new OverridePlannedActivityCommand(
                PlannedActivityId: id,
                FarmId: request.FarmId,
                NewPlannedDate: request.NewPlannedDate,
                NewActivityName: request.NewActivityName,
                NewStage: request.NewStage,
                Reason: request.Reason,
                CallerUserId: actorUserId,
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("OverridePlannedActivity");

        group.MapPost("/planned-activities", async (
            AddLocalPlannedActivityRequest request,
            ClaimsPrincipal user,
            AddLocalPlannedActivityHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new AddLocalPlannedActivityCommand(
                NewActivityId: request.NewActivityId ?? Guid.NewGuid(),
                CropCycleId: request.CropCycleId,
                FarmId: request.FarmId,
                ActivityName: request.ActivityName,
                Stage: request.Stage,
                PlannedDate: request.PlannedDate,
                Reason: request.Reason,
                CallerUserId: actorUserId,
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Created() : ToErrorResult(result.Error);
        })
        .WithName("AddLocalPlannedActivity");

        group.MapPost("/planned-activities/{id:guid}/remove", async (
            Guid id,
            RemovePlannedActivityRequest request,
            ClaimsPrincipal user,
            RemovePlannedActivityHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new RemovePlannedActivityCommand(
                PlannedActivityId: id,
                FarmId: request.FarmId,
                Reason: request.Reason,
                CallerUserId: actorUserId,
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("RemovePlannedActivity");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : error.Code.EndsWith("Forbidden", StringComparison.Ordinal)
                ? Results.Forbid()
                : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record OverridePlannedActivityRequest(
    Guid FarmId,
    DateOnly? NewPlannedDate,
    string? NewActivityName,
    string? NewStage,
    string Reason,
    string? ClientCommandId = null);

public sealed record AddLocalPlannedActivityRequest(
    Guid CropCycleId,
    Guid FarmId,
    string ActivityName,
    string Stage,
    DateOnly PlannedDate,
    string Reason,
    Guid? NewActivityId = null,
    string? ClientCommandId = null);

public sealed record RemovePlannedActivityRequest(
    Guid FarmId,
    string Reason,
    string? ClientCommandId = null);
