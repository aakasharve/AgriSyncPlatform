using AgriSync.BuildingBlocks.Domain;

namespace AgriSync.BuildingBlocks.Events;

public abstract class DomainEvent : IDomainEvent
{
    protected DomainEvent(Guid eventId, DateTime occurredOnUtc)
    {
        EventId = eventId;
        OccurredOnUtc = occurredOnUtc;
    }

    public Guid EventId { get; }

    public DateTime OccurredOnUtc { get; }
}
