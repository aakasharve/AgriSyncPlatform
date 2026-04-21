using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Tests;

public sealed class TestInstanceCollectedEvent : DomainEvent
{
    public TestInstanceCollectedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid testInstanceId,
        UserId collectedByUserId)
        : base(eventId, occurredOnUtc)
    {
        TestInstanceId = testInstanceId;
        CollectedByUserId = collectedByUserId;
    }

    public Guid TestInstanceId { get; }
    public UserId CollectedByUserId { get; }
}
