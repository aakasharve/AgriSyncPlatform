using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.UserEvents;

public sealed record UserUpdatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    UserId UserId,
    string DisplayName,
    bool IsActive);
