namespace AgriSync.BuildingBlocks.Events;

public abstract class IntegrationEvent
{
    protected IntegrationEvent(Guid eventId, DateTime occurredOnUtc)
    {
        EventId = eventId;
        OccurredOnUtc = occurredOnUtc;
    }

    public Guid EventId { get; }

    public DateTime OccurredOnUtc { get; }
}
