using System.Text.Json;

namespace ShramSafal.Application.UseCases.Sync.PushSyncBatch;

public sealed record PushSyncBatchCommand(
    string DeviceId,
    Guid AuthenticatedUserId,
    string? ActorRole,
    IReadOnlyList<PushSyncMutationCommand> Mutations,
    // Sub-plan 02 Task 11: client-stamped app version (X-App-Version header).
    // Optional — old clients that don't send the header reach the handler with
    // null and bypass the min-version gate. Once Sub-plan 04 ships the
    // updated mobile-web build everywhere, the gate becomes mandatory.
    string? AppVersion = null);

public sealed record PushSyncMutationCommand(
    string ClientRequestId,
    string MutationType,
    JsonElement Payload);
