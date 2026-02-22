using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using System.Security.Claims;
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
            PullSyncChangesHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var cursor = ParseSinceCursor(since);
            var result = await handler.HandleAsync(new PullSyncChangesQuery(cursor, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PullSyncChanges");

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

        return DateTime.TryParse(rawSince, out var parsed)
            ? parsed
            : DateTime.UnixEpoch;
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
