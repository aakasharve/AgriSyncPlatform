using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Work;

public sealed record JobCardCreatedEvent(
    Guid JobCardId,
    FarmId FarmId,
    Guid PlotId,
    UserId CreatedByUserId,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
