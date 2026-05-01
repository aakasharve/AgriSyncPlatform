using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Api.Endpoints;

public static class LogsEndpoints
{
    public static RouteGroupBuilder MapLogsEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/logs", async (
            CreateDailyLogRequest request,
            ClaimsPrincipal user,
            CreateDailyLogHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CreateDailyLogCommand(
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                actorUserId,
                actorUserId,
                request.LogDate,
                request.Location?.ToDomain(),
                request.DeviceId,
                request.ClientRequestId,
                DailyLogId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateDailyLog")
        .RequireAuthorization();

        group.MapPost("/logs/{id:guid}/tasks", async (
            Guid id,
            AddLogTaskRequest request,
            ClaimsPrincipal user,
            AddLogTaskHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new AddLogTaskCommand(
                id,
                request.ActivityType,
                request.Notes,
                request.OccurredAtUtc,
                LogTaskId: null,
                ActorUserId: actorUserId,
                ActorRole: EndpointActorContext.GetActorRole(user));
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AddLogTask")
        .RequireAuthorization();

        // T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): this endpoint resolves
        // the PIPELINE-WRAPPED handler (IHandler<VerifyLogCommand,
        // DailyLogDto>). Caller-shape validation (DailyLogId /
        // VerifiedByUserId / explicit-but-empty VerificationEventId) +
        // strict owner-tier authorization (EnsureCanVerify) run as
        // pipeline behaviors before the handler body. The invalid-status
        // parse → 401 is intentionally preserved verbatim from the
        // pre-rollout shape; tightening to 400 would be a contract
        // change tracked separately.
        group.MapPost("/logs/{id:guid}/verify", async (
            Guid id,
            VerifyLogRequest request,
            ClaimsPrincipal user,
            IHandler<VerifyLogCommand, DailyLogDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!Enum.TryParse<VerificationStatus>(request.Status, true, out var status))
            {
                return Results.Unauthorized();
            }

            var command = new VerifyLogCommand(
                id,
                status,
                request.Reason,
                actorUserId,
                VerificationEventId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("VerifyLog")
        .RequireAuthorization();

        group.MapGet("/logs/{id:guid}/transitions", async (
            Guid id,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var log = await repository.GetDailyLogByIdAsync(id, ct);
            if (log is null)
            {
                return Results.NotFound(new
                {
                    error = "ShramSafal.DailyLogNotFound",
                    message = "Daily log was not found."
                });
            }

            var canReadFarm = await repository.IsUserMemberOfFarmAsync((Guid)log.FarmId, callerUserId, ct);
            if (!canReadFarm)
            {
                return Results.Forbid();
            }

            var callerRole = await repository.GetUserRoleForFarmAsync((Guid)log.FarmId, callerUserId, ct);
            if (callerRole is null)
            {
                return Results.Forbid();
            }
            var resolvedCallerRole = callerRole.Value;

            var currentStatus = log.CurrentVerificationStatus;
            var availableTransitions = VerificationStateMachine
                .GetAvailableTransitions(currentStatus, resolvedCallerRole)
                .Select(status => status.ToString())
                .ToArray();

            return Results.Ok(new
            {
                currentStatus = currentStatus.ToString(),
                availableTransitions
            });
        })
        .WithName("GetLogVerificationTransitions")
        .RequireAuthorization();

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

public sealed record CreateDailyLogRequest(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    DateOnly LogDate,
    LocationRequest? Location,
    string? DeviceId,
    string? ClientRequestId);

public sealed record AddLogTaskRequest(
    string ActivityType,
    string? Notes,
    DateTime? OccurredAtUtc = null);

public sealed record VerifyLogRequest(
    string Status,
    string? Reason);

public sealed record LocationRequest(
    decimal Latitude,
    decimal Longitude,
    decimal AccuracyMeters,
    decimal? Altitude,
    DateTime CapturedAtUtc,
    string Provider,
    string PermissionState)
{
    public LocationSnapshot ToDomain() =>
        new()
        {
            Latitude = Latitude,
            Longitude = Longitude,
            AccuracyMeters = AccuracyMeters,
            Altitude = Altitude,
            CapturedAtUtc = CapturedAtUtc,
            Provider = Provider,
            PermissionState = PermissionState
        };
}

