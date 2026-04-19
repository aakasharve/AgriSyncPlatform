using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record SubscriptionCanceledV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    SubscriptionId SubscriptionId,
    OwnerAccountId OwnerAccountId,
    DateTime CanceledAtUtc);
