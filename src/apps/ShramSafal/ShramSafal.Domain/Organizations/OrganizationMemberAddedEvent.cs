using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationMemberAddedEvent : DomainEvent
{
    public OrganizationMemberAddedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid membershipId,
        Guid organizationId,
        UserId userId,
        OrganizationRole role,
        UserId addedByUserId)
        : base(eventId, occurredOnUtc)
    {
        MembershipId = membershipId;
        OrganizationId = organizationId;
        UserId = userId;
        Role = role;
        AddedByUserId = addedByUserId;
    }

    public Guid MembershipId { get; }
    public Guid OrganizationId { get; }
    public UserId UserId { get; }
    public OrganizationRole Role { get; }
    public UserId AddedByUserId { get; }
}
