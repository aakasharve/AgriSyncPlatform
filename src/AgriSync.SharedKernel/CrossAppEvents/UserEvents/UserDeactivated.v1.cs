using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.UserEvents;

public sealed record UserDeactivatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    UserId UserId,
    string Reason);
