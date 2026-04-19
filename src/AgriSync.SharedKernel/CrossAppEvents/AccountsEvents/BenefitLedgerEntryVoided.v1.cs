using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record BenefitLedgerEntryVoidedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    BenefitLedgerEntryId BenefitLedgerEntryId,
    OwnerAccountId OwnerAccountId,
    string Reason);
