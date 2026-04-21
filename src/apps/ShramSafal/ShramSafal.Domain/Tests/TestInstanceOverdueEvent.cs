using AgriSync.BuildingBlocks.Events;

namespace ShramSafal.Domain.Tests;

public sealed class TestInstanceOverdueEvent : DomainEvent
{
    public TestInstanceOverdueEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid testInstanceId)
        : base(eventId, occurredOnUtc)
    {
        TestInstanceId = testInstanceId;
    }

    public Guid TestInstanceId { get; }
}
