using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Work;

/// <summary>
/// Raised when a job card is cancelled.
/// </summary>
public sealed record JobCardCancelledEvent(
    Guid JobCardId,
    UserId CancelledByUserId,
    AppRole CancellerRole,
    string Reason,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
