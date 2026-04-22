using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationFarmScopeRevokedEvent : DomainEvent
{
    public OrganizationFarmScopeRevokedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid scopeId,
        Guid organizationId,
        FarmId farmId,
        UserId revokedByUserId)
        : base(eventId, occurredOnUtc)
    {
        ScopeId = scopeId;
        OrganizationId = organizationId;
        FarmId = farmId;
        RevokedByUserId = revokedByUserId;
    }

    public Guid ScopeId { get; }
    public Guid OrganizationId { get; }
    public FarmId FarmId { get; }
    public UserId RevokedByUserId { get; }
}
