using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Schedules.AbandonSchedule;
using ShramSafal.Application.UseCases.Schedules.AdoptSchedule;
using ShramSafal.Application.UseCases.Schedules.CompleteSchedule;
using ShramSafal.Application.UseCases.Schedules.MigrateSchedule;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Phase 3 MIS — schedule lifecycle endpoints. Routes nest under
/// <c>/plots/{plotId}/cycles/{cycleId}</c> per the MIS plan; farmId + template
/// references ride in the body so the caller only needs plot/cycle ids in the
/// URL. Idempotency tokens (<c>clientCommandId</c>, <c>subscriptionId</c>,
/// <c>migrationEventId</c>) are optional and forwarded straight to the
/// handler, which checks them.
/// </summary>
public static class ScheduleEndpoints
{
    public static RouteGroupBuilder MapScheduleEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/adopt", async (
            Guid plotId,
            Guid cycleId,
            AdoptScheduleRequest request,
            ClaimsPrincipal user,
            AdoptScheduleHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new AdoptScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                ScheduleTemplateId: request.ScheduleTemplateId,
                ActorUserId: actorUserId,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId,
                SubscriptionId: request.SubscriptionId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AdoptSchedule");

        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/migrate", async (
            Guid plotId,
            Guid cycleId,
            MigrateScheduleRequest request,
            ClaimsPrincipal user,
            MigrateScheduleHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!Enum.TryParse<ScheduleMigrationReason>(request.Reason, ignoreCase: true, out var reason))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = $"Unknown migration reason '{request.Reason}'."
                });
            }

            var command = new MigrateScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                NewScheduleTemplateId: request.NewScheduleTemplateId,
                Reason: reason,
                ActorUserId: actorUserId,
                ReasonText: request.ReasonText,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId,
                NewSubscriptionId: request.NewSubscriptionId,
                MigrationEventId: request.MigrationEventId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("MigrateSchedule");

        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/abandon", async (
            Guid plotId,
            Guid cycleId,
            AbandonScheduleRequest request,
            ClaimsPrincipal user,
            AbandonScheduleHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new AbandonScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                ActorUserId: actorUserId,
                ReasonText: request.ReasonText,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AbandonSchedule");

        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/complete", async (
            Guid plotId,
            Guid cycleId,
            CompleteScheduleRequest request,
            ClaimsPrincipal user,
            CompleteScheduleHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CompleteScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                ActorUserId: actorUserId,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CompleteSchedule");

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

public sealed record AdoptScheduleRequest(
    Guid FarmId,
    Guid ScheduleTemplateId,
    string? ClientCommandId = null,
    Guid? SubscriptionId = null);

public sealed record MigrateScheduleRequest(
    Guid FarmId,
    Guid NewScheduleTemplateId,
    string Reason,
    string? ReasonText = null,
    string? ClientCommandId = null,
    Guid? NewSubscriptionId = null,
    Guid? MigrationEventId = null);

public sealed record AbandonScheduleRequest(
    Guid FarmId,
    string? ReasonText = null,
    string? ClientCommandId = null);

public sealed record CompleteScheduleRequest(
    Guid FarmId,
    string? ClientCommandId = null);
