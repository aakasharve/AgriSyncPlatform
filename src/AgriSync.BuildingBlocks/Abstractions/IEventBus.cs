using AgriSync.BuildingBlocks.Events;

namespace AgriSync.BuildingBlocks.Abstractions;

public interface IEventBus
{
    Task PublishAsync(IntegrationEvent integrationEvent, CancellationToken cancellationToken = default);
}
