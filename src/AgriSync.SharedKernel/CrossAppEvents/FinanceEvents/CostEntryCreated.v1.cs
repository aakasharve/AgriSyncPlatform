using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.FinanceEvents;

public sealed record CostEntryCreatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    Guid CostEntryId,
    FarmId FarmId,
    UserId CreatedByUserId,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate);
