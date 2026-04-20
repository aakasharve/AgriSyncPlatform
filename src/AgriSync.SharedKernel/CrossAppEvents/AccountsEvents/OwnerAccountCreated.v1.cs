using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record OwnerAccountCreatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    OwnerAccountId OwnerAccountId,
    UserId PrimaryOwnerUserId,
    string AccountName,
    string AccountType);
