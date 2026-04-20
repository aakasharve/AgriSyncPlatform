using Accounts.Application.Ports;
using Accounts.Domain.Affiliation;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;

namespace Accounts.Infrastructure.Persistence.Repositories;

internal sealed class AffiliationRepository(AccountsDbContext dbContext) : IAffiliationRepository
{
    public Task<ReferralCode?> GetActiveCodeByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default) =>
        dbContext.ReferralCodes.FirstOrDefaultAsync(c => c.OwnerAccountId == ownerAccountId && c.IsActive, ct)!;

    public Task<ReferralCode?> GetActiveCodeByValueAsync(string code, CancellationToken ct = default) =>
        dbContext.ReferralCodes.FirstOrDefaultAsync(c => c.Code == code.ToUpperInvariant() && c.IsActive, ct)!;

    public async Task AddReferralCodeAsync(ReferralCode code, CancellationToken ct = default) =>
        await dbContext.ReferralCodes.AddAsync(code, ct);

    public Task<ReferralRelationship?> GetByReferredAccountAsync(OwnerAccountId referredOwnerAccountId, CancellationToken ct = default) =>
        dbContext.ReferralRelationships.FirstOrDefaultAsync(r => r.ReferredOwnerAccountId == referredOwnerAccountId, ct)!;

    public Task<bool> ReferralRelationshipExistsAsync(OwnerAccountId referredOwnerAccountId, CancellationToken ct = default) =>
        dbContext.ReferralRelationships.AnyAsync(r => r.ReferredOwnerAccountId == referredOwnerAccountId, ct);

    public async Task AddReferralRelationshipAsync(ReferralRelationship relationship, CancellationToken ct = default) =>
        await dbContext.ReferralRelationships.AddAsync(relationship, ct);

    public Task<List<ReferralRelationship>> GetPendingByReferrerAsync(OwnerAccountId referrerOwnerAccountId, CancellationToken ct = default) =>
        dbContext.ReferralRelationships
            .Where(r => r.ReferrerOwnerAccountId == referrerOwnerAccountId && r.Status == ReferralRelationshipStatus.Pending)
            .ToListAsync(ct);

    public Task<bool> GrowthEventExistsAsync(GrowthEventType eventType, Guid referenceId, CancellationToken ct = default) =>
        dbContext.GrowthEvents.AnyAsync(e => e.EventType == eventType && e.ReferenceId == referenceId, ct);

    public async Task AddGrowthEventAsync(GrowthEvent evt, CancellationToken ct = default) =>
        await dbContext.GrowthEvents.AddAsync(evt, ct);

    public Task<List<GrowthEvent>> GetGrowthEventsForOwnerAsync(OwnerAccountId ownerAccountId, int limit, CancellationToken ct = default) =>
        dbContext.GrowthEvents
            .Where(e => e.OwnerAccountId == ownerAccountId)
            .OrderByDescending(e => e.OccurredAtUtc)
            .Take(limit)
            .ToListAsync(ct);

    public async Task AddBenefitLedgerEntryAsync(BenefitLedgerEntry entry, CancellationToken ct = default) =>
        await dbContext.BenefitLedgerEntries.AddAsync(entry, ct);

    public Task<List<BenefitLedgerEntry>> GetBenefitEntriesForOwnerAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default) =>
        dbContext.BenefitLedgerEntries
            .Where(e => e.OwnerAccountId == ownerAccountId)
            .OrderByDescending(e => e.CreatedAtUtc)
            .ToListAsync(ct);

    public async Task<(int referralsTotal, int referralsQualified, int benefitsEarned)> GetAffiliationStatsAsync(
        OwnerAccountId ownerAccountId, CancellationToken ct = default)
    {
        var total = await dbContext.ReferralRelationships
            .CountAsync(r => r.ReferrerOwnerAccountId == ownerAccountId, ct);

        var qualified = await dbContext.ReferralRelationships
            .CountAsync(r => r.ReferrerOwnerAccountId == ownerAccountId && r.Status == ReferralRelationshipStatus.Qualified, ct);

        var benefits = await dbContext.BenefitLedgerEntries
            .CountAsync(b => b.OwnerAccountId == ownerAccountId, ct);

        return (total, qualified, benefits);
    }

    public Task SaveChangesAsync(CancellationToken ct = default) =>
        dbContext.SaveChangesAsync(ct);
}
