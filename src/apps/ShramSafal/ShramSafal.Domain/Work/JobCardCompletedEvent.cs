using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Work;

public sealed record JobCardCompletedEvent(
    Guid JobCardId,
    Guid LinkedDailyLogId,
    UserId CompletedByUserId,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
