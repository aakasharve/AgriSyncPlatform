using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record GrowthEventAppendedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    GrowthEventId GrowthEventId,
    OwnerAccountId OwnerAccountId,
    FarmId? FarmId,
    UserId? UserId,
    string EventType,
    Guid ReferenceId);
