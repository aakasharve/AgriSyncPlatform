namespace AgriSync.BuildingBlocks.Persistence.Outbox;

public interface IOutboxPublisher
{
    Task PublishAsync(OutboxMessage message, CancellationToken cancellationToken = default);
}
