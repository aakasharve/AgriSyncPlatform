using System.Text.Json;

namespace ShramSafal.Application.UseCases.Sync.PushSyncBatch;

public sealed record PushSyncBatchCommand(
    string DeviceId,
    IReadOnlyList<PushSyncMutationCommand> Mutations);

public sealed record PushSyncMutationCommand(
    string ClientRequestId,
    string MutationType,
    JsonElement Payload);
