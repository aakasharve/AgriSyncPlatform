using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

public sealed class ScheduleTemplateClonedEvent : DomainEvent
{
    public ScheduleTemplateClonedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid newTemplateId,
        Guid derivedFromTemplateId,
        UserId newOwnerUserId,
        string reason)
        : base(eventId, occurredOnUtc)
    {
        NewTemplateId = newTemplateId;
        DerivedFromTemplateId = derivedFromTemplateId;
        NewOwnerUserId = newOwnerUserId;
        Reason = reason;
    }

    public Guid NewTemplateId { get; }
    public Guid DerivedFromTemplateId { get; }
    public UserId NewOwnerUserId { get; }
    public string Reason { get; }
}
