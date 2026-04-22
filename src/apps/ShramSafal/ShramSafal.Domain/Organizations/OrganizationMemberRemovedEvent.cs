using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationMemberRemovedEvent : DomainEvent
{
    public OrganizationMemberRemovedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid membershipId,
        Guid organizationId,
        UserId userId,
        UserId removedByUserId)
        : base(eventId, occurredOnUtc)
    {
        MembershipId = membershipId;
        OrganizationId = organizationId;
        UserId = userId;
        RemovedByUserId = removedByUserId;
    }

    public Guid MembershipId { get; }
    public Guid OrganizationId { get; }
    public UserId UserId { get; }
    public UserId RemovedByUserId { get; }
}
