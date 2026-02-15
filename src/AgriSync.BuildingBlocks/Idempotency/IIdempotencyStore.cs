namespace AgriSync.BuildingBlocks.Idempotency;

public interface IIdempotencyStore
{
    Task<bool> TryAcquireAsync(string key, CancellationToken cancellationToken = default);

    Task MarkCompletedAsync(string key, string? responsePayload, CancellationToken cancellationToken = default);

    Task<IdempotencyRecord?> GetAsync(string key, CancellationToken cancellationToken = default);
}
