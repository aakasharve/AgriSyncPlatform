using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Api.Endpoints;

public static class LogsEndpoints
{
    public static RouteGroupBuilder MapLogsEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/logs", async (
            CreateDailyLogRequest request,
            CreateDailyLogHandler handler,
            CancellationToken ct) =>
        {
            var command = new CreateDailyLogCommand(
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                request.OperatorUserId,
                request.LogDate,
                request.DeviceId,
                request.ClientRequestId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateDailyLog");

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
        .WithName("AddLogTask");

        group.MapPost("/logs/{id:guid}/verify", async (
            Guid id,
            VerifyLogRequest request,
            VerifyLogHandler handler,
            CancellationToken ct) =>
        {
            if (!Enum.TryParse<VerificationStatus>(request.Status, true, out var status))
            {
                return Results.BadRequest(new { error = "ShramSafal.InvalidVerificationStatus", message = "Status must be Approved or Rejected." });
            }

            var command = new VerifyLogCommand(id, status, request.Reason, request.VerifiedByUserId);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("VerifyLog");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record CreateDailyLogRequest(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid OperatorUserId,
    DateOnly LogDate,
    string? DeviceId,
    string? ClientRequestId);

public sealed record AddLogTaskRequest(
    string ActivityType,
    string? Notes,
    DateTime? OccurredAtUtc = null);

public sealed record VerifyLogRequest(
    string Status,
    string? Reason,
    Guid VerifiedByUserId);

