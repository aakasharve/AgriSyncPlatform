using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record SubscriptionActivatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    SubscriptionId SubscriptionId,
    OwnerAccountId OwnerAccountId,
    string PlanCode,
    DateTime ValidFromUtc,
    DateTime ValidUntilUtc,
    bool IsTrial);
