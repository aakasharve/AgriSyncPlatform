using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B polymorphic same-FarmId join (ADR 0023 §1.3) between a `from` farm
/// operation and exactly one target: another operation (<see cref="ToOperationId"/>)
/// OR a cost entry (<see cref="ToCostEntryId"/>). Both endpoints must share FarmId —
/// enforced in <see cref="Create"/> (and at the DB layer via a CHECK on the
/// denormalized <see cref="FromFarmId"/>/<see cref="ToFarmId"/> guard columns).
/// No Provenance, no version chain (structural link).
/// </summary>
public sealed class EventLink : Entity<Guid>
{
    private EventLink() : base(Guid.Empty) { } // EF Core

    private EventLink(
        Guid id, FarmId fromFarmId, FarmId toFarmId, Guid fromOperationId,
        Guid? toOperationId, Guid? toCostEntryId, LinkKind linkKind, DateTime createdAtUtc)
        : base(id)
    {
        FromFarmId = fromFarmId;
        ToFarmId = toFarmId;
        FromOperationId = fromOperationId;
        ToOperationId = toOperationId;
        ToCostEntryId = toCostEntryId;
        LinkKind = linkKind;
        CreatedAtUtc = createdAtUtc;
    }

    public FarmId FromFarmId { get; private set; }
    public FarmId ToFarmId { get; private set; }
    public Guid FromOperationId { get; private set; }
    public Guid? ToOperationId { get; private set; }
    public Guid? ToCostEntryId { get; private set; }
    public LinkKind LinkKind { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static EventLink Create(
        Guid id, FarmId fromFarmId, FarmId toFarmId, Guid fromOperationId,
        Guid? toOperationId, Guid? toCostEntryId, LinkKind linkKind, DateTime createdAtUtc)
    {
        // XOR — exactly one target (operation OR cost entry).
        if ((toOperationId is null) == (toCostEntryId is null))
            throw new ArgumentException(
                "Exactly one of toOperationId or toCostEntryId must be set.", nameof(toOperationId));

        // Same-FarmId integrity (ADR §1.3) — both endpoints share the farm.
        if (fromFarmId != toFarmId)
            throw new ArgumentException(
                "EventLink endpoints must share the same FarmId.", nameof(toFarmId));

        return new EventLink(
            id, fromFarmId, toFarmId, fromOperationId, toOperationId, toCostEntryId, linkKind, createdAtUtc);
    }
}
