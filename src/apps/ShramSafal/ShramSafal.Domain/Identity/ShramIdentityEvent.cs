using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID, rule R5. One append-only identity event: a card issued, a
/// link or unlink, a phone added or verified, a number moved, a card reissued, a merge or its undo, a PIN recorded, an
/// erasure asked, cancelled or done — who did it, when, on which farm record, and how it was proven.
/// </summary>
/// <remarks>
/// <para><b>Farm-scoped (F8).</b> Unlike the person tables, an event belongs to the farm whose owner acted: it carries a
/// direct <see cref="FarmId"/> and sits under that farm's FORCE-RLS policy, so farm B never reads farm A's history about
/// him (R10). It is APPEND-ONLY BY PRIVILEGE: the app role may SELECT and INSERT, never UPDATE, DELETE or TRUNCATE.</para>
/// <para>It never holds a name, a number or a PIN — ids, the kind, the proof and the time only.</para>
/// <para>An undo is a NEW event naming the one it reverses (<see cref="ReversesEventId"/>), never an edit (P3).</para>
/// </remarks>
public sealed class ShramIdentityEvent : Entity<Guid>
{
    private ShramIdentityEvent() : base(Guid.Empty) { } // EF Core

    private ShramIdentityEvent(
        Guid id, Guid farmId, Guid? fieldOperatorId, Guid personId, Guid? otherPersonId, IdentityEventKind kind,
        IdentityProof proof, Guid actorUserId, DateTime occurredAtUtc, Guid? reversesEventId)
        : base(id)
    {
        FarmId = farmId;
        FieldOperatorId = fieldOperatorId;
        PersonId = personId;
        OtherPersonId = otherPersonId;
        Kind = kind;
        Proof = proof;
        ActorUserId = actorUserId;
        OccurredAtUtc = occurredAtUtc;
        ReversesEventId = reversesEventId;
    }

    public Guid FarmId { get; private set; }
    public Guid? FieldOperatorId { get; private set; }

    /// <summary>The person the farm record points at AFTER the event (for an unlink: the one it went back to).</summary>
    public Guid PersonId { get; private set; }

    /// <summary>The other person in a link, unlink or merge: the one the record pointed at BEFORE.</summary>
    public Guid? OtherPersonId { get; private set; }

    public IdentityEventKind Kind { get; private set; }
    public IdentityProof Proof { get; private set; }
    public Guid ActorUserId { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
    public Guid? ReversesEventId { get; private set; }

    public static ShramIdentityEvent Record(
        Guid id, Guid farmId, Guid? fieldOperatorId, Guid personId, IdentityEventKind kind, IdentityProof proof,
        Guid actorUserId, DateTime occurredAtUtc, Guid? otherPersonId = null, Guid? reversesEventId = null)
    {
        if (id == Guid.Empty || farmId == Guid.Empty || personId == Guid.Empty)
        {
            throw new ArgumentException("An identity event names its farm and its person.");
        }

        return new ShramIdentityEvent(id, farmId, fieldOperatorId, personId, otherPersonId, kind, proof, actorUserId, occurredAtUtc, reversesEventId);
    }
}
