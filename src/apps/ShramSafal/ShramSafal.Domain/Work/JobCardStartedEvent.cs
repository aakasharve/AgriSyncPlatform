using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Work;

/// <summary>
/// Raised when a job card transitions from Assigned to InProgress.
/// </summary>
public sealed record JobCardStartedEvent(
    Guid JobCardId,
    UserId WorkerUserId,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
