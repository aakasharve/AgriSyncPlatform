using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.UserEvents;

public sealed record MembershipChangedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    UserId UserId,
    AppId AppId,
    string Role,
    bool IsRevoked);
