using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.AccountsEvents;

public sealed record BenefitLedgerEntryCreatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    BenefitLedgerEntryId BenefitLedgerEntryId,
    OwnerAccountId OwnerAccountId,
    string SourceType,
    Guid SourceReferenceId,
    string BenefitType,
    string Status,
    decimal Quantity,
    string Unit);
