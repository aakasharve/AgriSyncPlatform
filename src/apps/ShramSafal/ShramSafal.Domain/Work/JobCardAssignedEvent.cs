using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Work;

public sealed record JobCardAssignedEvent(
    Guid JobCardId,
    UserId AssignedWorkerUserId,
    UserId AssignedByUserId,
    AppRole AssignerRole,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
