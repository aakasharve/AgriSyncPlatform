using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.Affiliation;

/// <summary>
/// A unique 8-character Crockford Base32 code tied to an OwnerAccount.
/// One active code per account at a time (I10 — see §7.1.1 of the plan).
/// </summary>
public sealed class ReferralCode
{
    private ReferralCode() { } // EF

    public ReferralCode(ReferralCodeId id, OwnerAccountId ownerAccountId, string code, DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length != 8)
        {
            throw new ArgumentException("Referral code must be exactly 8 characters.", nameof(code));
        }

        Id = id;
        OwnerAccountId = ownerAccountId;
        Code = code.ToUpperInvariant();
        CreatedAtUtc = createdAtUtc;
        IsActive = true;
    }

    public ReferralCodeId Id { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public bool IsActive { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public void Deactivate() => IsActive = false;
}
