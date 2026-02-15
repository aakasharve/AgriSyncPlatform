using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;

namespace ShramSafal.Api.Endpoints;

public static class SyncEndpoints
{
    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/sync").WithTags("Sync");

        group.MapPost("/push", async (
            SyncPushRequest request,
            PushSyncBatchHandler handler,
            CancellationToken ct) =>
        {
            var mutations = request.Mutations ?? [];
            var command = new PushSyncBatchCommand(
                request.DeviceId,
                mutations
                    .Select(m => new PushSyncMutationCommand(
                        m.ClientRequestId,
                        m.MutationType,
                        m.Payload.Clone()))
                    .ToList());

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PushSyncBatch");

        group.MapGet("/pull", async (
            DateTime? since,
            PullSyncChangesHandler handler,
            CancellationToken ct) =>
        {
            var cursor = since ?? DateTime.UnixEpoch;
            var result = await handler.HandleAsync(new PullSyncChangesQuery(cursor), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PullSyncChanges");

        return endpoints;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record SyncPushRequest(
    string DeviceId,
    IReadOnlyList<SyncPushMutationRequest> Mutations);

public sealed record SyncPushMutationRequest(
    string ClientRequestId,
    string MutationType,
    JsonElement Payload);
