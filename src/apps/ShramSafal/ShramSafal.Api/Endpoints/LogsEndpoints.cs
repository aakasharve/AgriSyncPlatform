using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Location;

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
            if (!TryGetCallerContext(user, out var callerUserId, out _))
            {
                return Results.Unauthorized();
            }

            var command = new CreateDailyLogCommand(
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                callerUserId,
                request.OperatorUserId,
                request.LogDate,
                request.DeviceId,
                request.ClientRequestId,
                null,
                request.Location);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateDailyLog")
        .RequireAuthorization();

        group.MapPost("/logs/{id:guid}/tasks", async (
            Guid id,
            AddLogTaskRequest request,
            AddLogTaskHandler handler,
            CancellationToken ct) =>
        {
            var command = new AddLogTaskCommand(id, request.ActivityType, request.Notes, request.OccurredAtUtc);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AddLogTask")
        .RequireAuthorization();

        group.MapPost("/logs/{id:guid}/verify", async (
            Guid id,
            VerifyLogRequest request,
            ClaimsPrincipal user,
            VerifyLogHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerContext(user, out var callerUserId, out var callerRole))
            {
                return Results.Unauthorized();
            }

            if (!Enum.TryParse<VerificationStatus>(request.TargetStatus, true, out var targetStatus))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidVerificationStatus",
                    message = "targetStatus must be one of: Draft, Confirmed, Verified, Disputed, CorrectionPending."
                });
            }

            var command = new VerifyLogCommand(id, targetStatus, request.Reason, callerUserId, callerRole);
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
            if (!TryGetCallerContext(user, out _, out var callerRole))
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

            var currentStatus = log.CurrentVerificationStatus;
            var availableTransitions = VerificationStateMachine
                .GetAvailableTransitions(currentStatus, callerRole)
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
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    private static bool TryGetCallerContext(ClaimsPrincipal user, out Guid callerUserId, out AppRole callerRole)
    {
        callerUserId = Guid.Empty;
        callerRole = AppRole.Worker;

        var sub = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (sub is null || !Guid.TryParse(sub, out callerUserId))
        {
            return false;
        }

        var memberships = user.FindAll("membership");
        foreach (var membershipClaim in memberships)
        {
            var value = membershipClaim.Value;
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            var tokens = value.Split(':', 2, StringSplitOptions.TrimEntries);
            if (tokens.Length != 2)
            {
                continue;
            }

            if (!tokens[0].Equals("shramsafal", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (Enum.TryParse<AppRole>(tokens[1], true, out callerRole))
            {
                return true;
            }
        }

        return false;
    }
}

public sealed record CreateDailyLogRequest(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid OperatorUserId,
    DateOnly LogDate,
    string? DeviceId,
    string? ClientRequestId,
    LocationSnapshot? Location = null);

public sealed record AddLogTaskRequest(
    string ActivityType,
    string? Notes,
    DateTime? OccurredAtUtc = null);

public sealed record VerifyLogRequest(
    string TargetStatus,
    string? Reason);
