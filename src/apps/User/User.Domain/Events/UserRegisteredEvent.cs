using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Events;

public sealed class UserRegisteredEvent : DomainEvent
{
    public UserRegisteredEvent(Guid eventId, DateTime occurredOnUtc, UserId userId, string phone, string displayName)
        : base(eventId, occurredOnUtc)
    {
        UserId = userId;
        Phone = phone;
        DisplayName = displayName;
    }

    public UserId UserId { get; }
    public string Phone { get; }
    public string DisplayName { get; }
}
