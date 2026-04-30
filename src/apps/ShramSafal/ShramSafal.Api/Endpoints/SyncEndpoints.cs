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
            HttpContext httpContext,
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
            // Sub-plan 02 Task 11: forward the X-App-Version header into the
            // command so the handler can reject mutations that require a
            // newer client than the one talking to us.
            var appVersion = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
            var command = new PushSyncBatchCommand(
                request.DeviceId,
                actorUserId,
                actorRole,
                mutations
                    .Select(m => new PushSyncMutationCommand(
                        m.ClientCommandId ?? m.ClientRequestId,
                        m.MutationType,
                        m.Payload.Clone()))
                    .ToList(),
                AppVersion: string.IsNullOrWhiteSpace(appVersion) ? null : appVersion);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PushSyncBatch");

        group.MapGet("/pull", async (
            HttpContext httpContext,
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
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            // Sub-plan 03 Task 10: surface degraded components as the
            // X-Degraded response header (comma-separated component
            // names) so frontend SDK / proxy logs can detect partial
            // data without parsing the body. The body itself also
            // carries DegradedComponents (with Description + ErrorCode)
            // for richer UI rendering.
            var payload = result.Value!;
            if (payload.DegradedComponents is { Count: > 0 } components)
            {
                httpContext.Response.Headers["X-Degraded"] =
                    string.Join(",", components.Select(c => c.ComponentName));
            }
            return Results.Ok(payload);
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
