using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Tests;

public sealed class TestInstanceWaivedEvent : DomainEvent
{
    public TestInstanceWaivedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid testInstanceId,
        UserId waivedByUserId,
        string waivedReason)
        : base(eventId, occurredOnUtc)
    {
        TestInstanceId = testInstanceId;
        WaivedByUserId = waivedByUserId;
        WaivedReason = waivedReason;
    }

    public Guid TestInstanceId { get; }
    public UserId WaivedByUserId { get; }
    public string WaivedReason { get; }
}
