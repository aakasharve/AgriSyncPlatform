namespace ShramSafal.Infrastructure.Persistence;

internal sealed class SyncMutationRecord
{
    private SyncMutationRecord() { } // EF Core

    public SyncMutationRecord(
        Guid id,
        string deviceId,
        string clientRequestId,
        string mutationType,
        string responsePayloadJson,
        DateTime processedAtUtc)
    {
        Id = id;
        DeviceId = deviceId;
        ClientRequestId = clientRequestId;
        MutationType = mutationType;
        ResponsePayloadJson = responsePayloadJson;
        ProcessedAtUtc = processedAtUtc;
    }

    public Guid Id { get; private set; }
    public string DeviceId { get; private set; } = string.Empty;
    public string ClientRequestId { get; private set; } = string.Empty;
    public string MutationType { get; private set; } = string.Empty;
    public string ResponsePayloadJson { get; private set; } = string.Empty;
    public DateTime ProcessedAtUtc { get; private set; }
}
