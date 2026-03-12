using System.Security.Claims;
using System.Globalization;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;

namespace ShramSafal.Api.Endpoints;

public static class SyncEndpoints
{
    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/sync")
            .WithTags("Sync")
            .RequireAuthorization();

        group.MapPost("/push", async (
            SyncPushRequest request,
            ClaimsPrincipal user,
            PushSyncBatchHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var actorRole = EndpointActorContext.GetActorRole(user);
            var mutations = request.Mutations ?? [];
            var command = new PushSyncBatchCommand(
                request.DeviceId,
                actorUserId,
                actorRole,
                mutations
                    .Select(m => new PushSyncMutationCommand(
                        m.ClientCommandId ?? m.ClientRequestId,
                        m.MutationType,
                        m.Payload.Clone()))
                    .ToList());

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PushSyncBatch");

        group.MapGet("/pull", async (
            string? since,
            ClaimsPrincipal user,
            ILoggerFactory loggerFactory,
            PullSyncChangesHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            DateTime cursor;
            try
            {
                cursor = ParseSinceCursor(since);
            }
            catch (FormatException ex)
            {
                loggerFactory
                    .CreateLogger("ShramSafal.Api.Endpoints.SyncEndpoints")
                    .LogWarning(ex, "Invalid sync cursor received for /sync/pull. Raw since value: {Since}", since);

                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidSyncCursor",
                    message = "Invalid sync cursor. Expected ISO 8601 UTC (for example, 2026-03-12T10:30:00Z)."
                });
            }

            var result = await handler.HandleAsync(new PullSyncChangesQuery(cursor, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PullSyncChanges")
        .WithSummary("Pull sync changes since an ISO 8601 UTC cursor, or 0 for a full sync.");

        return endpoints;
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

    private static DateTime ParseSinceCursor(string? rawSince)
    {
        if (string.IsNullOrWhiteSpace(rawSince) || rawSince.Trim() == "0")
        {
            return DateTime.UnixEpoch;
        }

        if (DateTime.TryParseExact(
                rawSince.Trim(),
                ["o", "yyyy-MM-ddTHH:mm:ss.fffffffZ", "yyyy-MM-ddTHH:mm:ssZ"],
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed;
        }

        throw new FormatException($"Invalid sync cursor format: '{rawSince}'. Expected ISO 8601 UTC (e.g., 2026-03-12T10:30:00Z).");
    }
}

public sealed record SyncPushRequest(
    string DeviceId,
    IReadOnlyList<SyncPushMutationRequest> Mutations);

public sealed record SyncPushMutationRequest(
    string ClientRequestId,
    string? ClientCommandId,
    string MutationType,
    JsonElement Payload);
