using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.Affiliation;

/// <summary>
/// A benefit earned (or voided) as a result of a <see cref="GrowthEvent"/>.
///
/// V1: badge-only — no monetary value committed until reward math is locked
/// (plan §7.2.3 open question). Status: EarnedLocked → Released (when
/// payment provider is wired) | Voided (on worker revocation grace window).
/// </summary>
public sealed class BenefitLedgerEntry
{
    private BenefitLedgerEntry() { } // EF

    public BenefitLedgerEntry(
        BenefitLedgerEntryId id,
        OwnerAccountId ownerAccountId,
        GrowthEventId sourceGrowthEventId,
        BenefitStatus status,
        string benefitType,
        int quantity,
        string unit,
        DateTime createdAtUtc)
    {
        Id = id;
        OwnerAccountId = ownerAccountId;
        SourceGrowthEventId = sourceGrowthEventId;
        Status = status;
        BenefitType = benefitType;
        Quantity = quantity;
        Unit = unit;
        CreatedAtUtc = createdAtUtc;
    }

    public BenefitLedgerEntryId Id { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public GrowthEventId SourceGrowthEventId { get; private set; }
    public BenefitStatus Status { get; private set; }
    public string BenefitType { get; private set; } = string.Empty;
    public int Quantity { get; private set; }
    public string Unit { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? StatusChangedAtUtc { get; private set; }

    public void Release(DateTime utcNow)
    {
        Status = BenefitStatus.Released;
        StatusChangedAtUtc = utcNow;
    }

    public void Void(DateTime utcNow)
    {
        Status = BenefitStatus.Voided;
        StatusChangedAtUtc = utcNow;
    }
}

public enum BenefitStatus { EarnedLocked = 1, Released = 2, Voided = 3 }
