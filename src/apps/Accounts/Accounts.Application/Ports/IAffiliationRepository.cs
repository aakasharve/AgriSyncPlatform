using Accounts.Domain.Affiliation;
using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Application.Ports;

public interface IAffiliationRepository
{
    // Referral codes
    Task<ReferralCode?> GetActiveCodeByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default);
    Task<ReferralCode?> GetActiveCodeByValueAsync(string code, CancellationToken ct = default);
    Task AddReferralCodeAsync(ReferralCode code, CancellationToken ct = default);

    // Referral relationships
    Task<ReferralRelationship?> GetByReferredAccountAsync(OwnerAccountId referredOwnerAccountId, CancellationToken ct = default);
    Task<bool> ReferralRelationshipExistsAsync(OwnerAccountId referredOwnerAccountId, CancellationToken ct = default);
    Task AddReferralRelationshipAsync(ReferralRelationship relationship, CancellationToken ct = default);
    Task<List<ReferralRelationship>> GetPendingByReferrerAsync(OwnerAccountId referrerOwnerAccountId, CancellationToken ct = default);

    // Growth events (I11 — append-only + de-dup by ReferenceId + EventType)
    Task<bool> GrowthEventExistsAsync(GrowthEventType eventType, Guid referenceId, CancellationToken ct = default);
    Task AddGrowthEventAsync(GrowthEvent evt, CancellationToken ct = default);
    Task<List<GrowthEvent>> GetGrowthEventsForOwnerAsync(OwnerAccountId ownerAccountId, int limit, CancellationToken ct = default);

    // Benefit ledger
    Task AddBenefitLedgerEntryAsync(BenefitLedgerEntry entry, CancellationToken ct = default);
    Task<List<BenefitLedgerEntry>> GetBenefitEntriesForOwnerAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default);

    // Referral stats for /me/context affiliation block
    Task<(int referralsTotal, int referralsQualified, int benefitsEarned)> GetAffiliationStatsAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
