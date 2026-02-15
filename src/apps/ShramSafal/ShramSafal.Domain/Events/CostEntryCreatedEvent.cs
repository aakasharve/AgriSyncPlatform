using AgriSync.BuildingBlocks.Events;

namespace ShramSafal.Domain.Events;

public sealed class CostEntryCreatedEvent : DomainEvent
{
    public CostEntryCreatedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid costEntryId,
        decimal amount,
        string currencyCode)
        : base(eventId, occurredOnUtc)
    {
        CostEntryId = costEntryId;
        Amount = amount;
        CurrencyCode = currencyCode;
    }

    public Guid CostEntryId { get; }
    public decimal Amount { get; }
    public string CurrencyCode { get; }
}

