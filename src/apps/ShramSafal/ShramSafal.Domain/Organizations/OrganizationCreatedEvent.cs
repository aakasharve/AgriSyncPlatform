using AgriSync.BuildingBlocks.Events;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationCreatedEvent : DomainEvent
{
    public OrganizationCreatedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid organizationId,
        string name,
        OrganizationType type)
        : base(eventId, occurredOnUtc)
    {
        OrganizationId = organizationId;
        Name = name;
        Type = type;
    }

    public Guid OrganizationId { get; }
    public string Name { get; }
    public OrganizationType Type { get; }
}
