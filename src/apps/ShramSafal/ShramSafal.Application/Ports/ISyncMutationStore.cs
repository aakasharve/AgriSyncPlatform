namespace ShramSafal.Application.Ports;

public interface ISyncMutationStore
{
    Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default);

    Task<bool> TryStoreSuccessAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        string responsePayloadJson,
        DateTime processedAtUtc,
        CancellationToken ct = default);
}

public sealed record StoredSyncMutation(
    string DeviceId,
    string ClientRequestId,
    string MutationType,
    string ResponsePayloadJson,
    DateTime ProcessedAtUtc);
