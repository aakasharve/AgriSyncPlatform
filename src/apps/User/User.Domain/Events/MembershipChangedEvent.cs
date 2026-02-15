using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Events;

public sealed class MembershipChangedEvent : DomainEvent
{
    public MembershipChangedEvent(Guid eventId, DateTime occurredOnUtc, UserId userId, string appId, string role)
        : base(eventId, occurredOnUtc)
    {
        UserId = userId;
        AppId = appId;
        Role = role;
    }

    public UserId UserId { get; }
    public string AppId { get; }
    public string Role { get; }
}
