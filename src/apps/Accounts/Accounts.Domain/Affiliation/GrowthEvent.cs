using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.Affiliation;

/// <summary>
/// Immutable record of a growth signal produced by the affiliation engine.
/// Append-only — no UPDATE or DELETE (I11 variant; enforced at DB layer).
///
/// One GrowthEvent per (EventType, ReferenceId) — duplicate prevention
/// enforced by a unique index so de-dup survives retried handlers.
/// </summary>
public sealed class GrowthEvent
{
    private GrowthEvent() { } // EF

    public GrowthEvent(
        GrowthEventId id,
        OwnerAccountId ownerAccountId,
        GrowthEventType eventType,
        Guid referenceId,
        string? metadata,
        DateTime occurredAtUtc)
    {
        Id = id;
        OwnerAccountId = ownerAccountId;
        EventType = eventType;
        ReferenceId = referenceId;
        Metadata = metadata;
        OccurredAtUtc = occurredAtUtc;
    }

    public GrowthEventId Id { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public GrowthEventType EventType { get; private set; }
    /// <summary>Domain-specific anchor ID (e.g. ReferralRelationshipId, FarmMembershipId).</summary>
    public Guid ReferenceId { get; private set; }
    public string? Metadata { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
}

public enum GrowthEventType
{
    FarmerReferred = 1,
    ReferralQualified = 2,
    WorkerActivated = 3,
    WorkerRetained30d = 4,
}
