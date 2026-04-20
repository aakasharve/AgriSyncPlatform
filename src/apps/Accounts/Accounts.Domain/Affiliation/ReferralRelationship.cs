using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.Affiliation;

/// <summary>
/// Records that <see cref="ReferredOwnerAccountId"/> signed up using a code
/// issued by <see cref="ReferrerOwnerAccountId"/>.
///
/// Invariant I13: referrer == referred (by ownerAccountId) is rejected at
/// creation time (self-referral detection).
///
/// Invariant I10: only one ReferralRelationship per referred account —
/// enforced by a unique index in the DB.
/// </summary>
public sealed class ReferralRelationship
{
    private ReferralRelationship() { } // EF

    public ReferralRelationship(
        ReferralRelationshipId id,
        OwnerAccountId referrerOwnerAccountId,
        OwnerAccountId referredOwnerAccountId,
        ReferralCodeId referralCodeId,
        DateTime createdAtUtc)
    {
        if (referrerOwnerAccountId == referredOwnerAccountId)
        {
            throw new InvalidOperationException("Self-referral is not allowed (invariant I13).");
        }

        Id = id;
        ReferrerOwnerAccountId = referrerOwnerAccountId;
        ReferredOwnerAccountId = referredOwnerAccountId;
        ReferralCodeId = referralCodeId;
        Status = ReferralRelationshipStatus.Pending;
        CreatedAtUtc = createdAtUtc;
    }

    public ReferralRelationshipId Id { get; private set; }
    public OwnerAccountId ReferrerOwnerAccountId { get; private set; }
    public OwnerAccountId ReferredOwnerAccountId { get; private set; }
    public ReferralCodeId ReferralCodeId { get; private set; }
    public ReferralRelationshipStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? QualifiedAtUtc { get; private set; }

    public void MarkQualified(DateTime utcNow)
    {
        if (Status == ReferralRelationshipStatus.Qualified) return;
        Status = ReferralRelationshipStatus.Qualified;
        QualifiedAtUtc = utcNow;
    }
}

public enum ReferralRelationshipStatus { Pending = 1, Qualified = 2, Disqualified = 3 }
