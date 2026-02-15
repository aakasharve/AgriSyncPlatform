using AgriSync.BuildingBlocks.Events;

namespace ShramSafal.Domain.Events;

public sealed class CostEntryCorrectedEvent : DomainEvent
{
    public CostEntryCorrectedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid costEntryId,
        Guid correctionId,
        decimal correctedAmount,
        string currencyCode)
        : base(eventId, occurredOnUtc)
    {
        CostEntryId = costEntryId;
        CorrectionId = correctionId;
        CorrectedAmount = correctedAmount;
        CurrencyCode = currencyCode;
    }

    public Guid CostEntryId { get; }
    public Guid CorrectionId { get; }
    public decimal CorrectedAmount { get; }
    public string CurrencyCode { get; }
}

