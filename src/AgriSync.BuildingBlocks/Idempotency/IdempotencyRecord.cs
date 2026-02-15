namespace AgriSync.BuildingBlocks.Idempotency;

public sealed record IdempotencyRecord(
    string Key,
    DateTime CreatedOnUtc,
    DateTime? CompletedOnUtc,
    string? ResponsePayload);
