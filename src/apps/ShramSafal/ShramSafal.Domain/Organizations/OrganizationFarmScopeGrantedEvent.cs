using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Organizations;

public sealed class OrganizationFarmScopeGrantedEvent : DomainEvent
{
    public OrganizationFarmScopeGrantedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid scopeId,
        Guid organizationId,
        FarmId farmId,
        FarmScopeSource source,
        UserId grantedByUserId)
        : base(eventId, occurredOnUtc)
    {
        ScopeId = scopeId;
        OrganizationId = organizationId;
        FarmId = farmId;
        Source = source;
        GrantedByUserId = grantedByUserId;
    }

    public Guid ScopeId { get; }
    public Guid OrganizationId { get; }
    public FarmId FarmId { get; }
    public FarmScopeSource Source { get; }
    public UserId GrantedByUserId { get; }
}
