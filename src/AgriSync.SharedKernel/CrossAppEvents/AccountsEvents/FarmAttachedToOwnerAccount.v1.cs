using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record FarmAttachedToOwnerAccountV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    FarmId FarmId,
    OwnerAccountId OwnerAccountId);
