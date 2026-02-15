using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.UserEvents;

public sealed record UserCreatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    UserId UserId,
    string Phone,
    string DisplayName,
    bool IsActive);
