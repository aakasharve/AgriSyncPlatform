using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record ReferralRelationshipCreatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    ReferralRelationshipId ReferralRelationshipId,
    OwnerAccountId ReferrerOwnerAccountId,
    OwnerAccountId ReferredOwnerAccountId,
    ReferralCodeId ReferralCodeId);
