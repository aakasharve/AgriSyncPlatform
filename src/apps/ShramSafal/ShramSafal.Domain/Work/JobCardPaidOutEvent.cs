using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Work;

/// <summary>
/// CEI-I8: raised when a job card is marked as paid out, linking it to a CostEntry.
/// </summary>
public sealed record JobCardPaidOutEvent(
    Guid JobCardId,
    Guid PayoutCostEntryId,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
