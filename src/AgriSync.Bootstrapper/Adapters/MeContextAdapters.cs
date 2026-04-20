using Accounts.Infrastructure.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// Composition-root adapter — the only place in the backend that reads
/// across app DbContexts. When User-side projection tables land (see
/// spec §future-migration), these implementations are swapped for
/// projection readers inside <c>User.Infrastructure.Persistence.Readers</c>
/// and this file is deleted.
/// </summary>
public sealed class AccountsSnapshotReader(AccountsDbContext accountsDb) : IAccountsSnapshotReader
{
    public async Task<AccountsSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
    {
        // Caller-owned accounts (PrimaryOwner). SecondaryOwner memberships
        // are a later feature; this shortcut matches the current seed.
        var rows = await accountsDb.OwnerAccounts
            .AsNoTracking()
            .Where(a => a.PrimaryOwnerUserId == userId)
            .Select(a => new
            {
                Id = a.Id,
                a.AccountName,
                Subscription = accountsDb.Subscriptions
                    .Where(s => s.OwnerAccountId == a.Id &&
                                (s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Trialing ||
                                 s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Active ||
                                 s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.PastDue))
                    .OrderByDescending(s => s.CreatedAtUtc)
                    .Select(s => new
                    {
                        Status = s.Status,
                        s.PlanCode,
                        s.ValidUntilUtc,
                    })
                    .FirstOrDefault(),
            })
            .ToListAsync(ct);

        var mapped = rows.Select(r => new OwnerAccountSnapshot(
            OwnerAccountId: r.Id,
            AccountName: r.AccountName,
            CallerIsPrimaryOwner: true,
            Subscription: r.Subscription is null
                ? null
                : new SubscriptionSnapshot(
                    Status: r.Subscription.Status.ToString(),
                    PlanCode: r.Subscription.PlanCode,
                    ValidUntilUtc: r.Subscription.ValidUntilUtc))).ToList();

        return new AccountsSnapshot(mapped);
    }
}

public sealed class FarmMembershipSnapshotReader(
    ShramSafalDbContext ssfDb,
    AccountsDbContext accountsDb) : IFarmMembershipSnapshotReader
{
    public async Task<IReadOnlyList<FarmMembershipSnapshot>> GetForUserAsync(UserId userId, CancellationToken ct = default)
    {
        var rows = await ssfDb.FarmMemberships
            .AsNoTracking()
            .Join(ssfDb.Farms,
                m => m.FarmId,
                f => f.Id,
                (m, f) => new { m, f })
            .Where(x =>
                x.m.UserId == userId &&
                x.m.RevokedAtUtc == null &&
                x.m.ExitedAtUtc == null)
            .Select(x => new
            {
                FarmId = x.f.Id,
                FarmName = x.f.Name,
                x.f.FarmCode,
                OwnerAccountId = x.f.OwnerAccountId,
                Role = x.m.Role,
                Status = x.m.Status,
                JoinedVia = x.m.JoinedVia,
                x.m.GrantedAtUtc,
                x.m.LastSeenAtUtc,
            })
            .ToListAsync(ct);

        if (rows.Count == 0)
        {
            return Array.Empty<FarmMembershipSnapshot>();
        }

        var ownerAccountIds = rows.Select(r => r.OwnerAccountId).Distinct().ToList();

        var subs = await accountsDb.Subscriptions
            .AsNoTracking()
            .Where(s => ownerAccountIds.Contains(s.OwnerAccountId) &&
                        (s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Trialing ||
                         s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Active ||
                         s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.PastDue))
            .OrderByDescending(s => s.CreatedAtUtc)
            .Select(s => new
            {
                s.OwnerAccountId,
                s.Status,
                s.PlanCode,
                s.ValidUntilUtc,
            })
            .ToListAsync(ct);

        var subByOwner = subs
            .GroupBy(s => s.OwnerAccountId)
            .ToDictionary(g => g.Key, g => g.First());

        return rows.Select(r =>
        {
            SubscriptionSnapshot? sub = null;
            if (subByOwner.TryGetValue(r.OwnerAccountId, out var s))
            {
                sub = new SubscriptionSnapshot(
                    Status: s.Status.ToString(),
                    PlanCode: s.PlanCode,
                    ValidUntilUtc: s.ValidUntilUtc);
            }

            return new FarmMembershipSnapshot(
                FarmId: r.FarmId,
                FarmName: r.FarmName,
                FarmCode: r.FarmCode,
                OwnerAccountId: r.OwnerAccountId,
                Role: r.Role.ToString(),
                Status: r.Status.ToString(),
                JoinedVia: r.JoinedVia.ToString(),
                GrantedAtUtc: r.GrantedAtUtc,
                LastSeenAtUtc: r.LastSeenAtUtc,
                Subscription: sub);
        }).ToList();
    }
}

public sealed class AffiliationSnapshotReader(AccountsDbContext accountsDb) : IAffiliationSnapshotReader
{
    public async Task<AffiliationSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
    {
        // Find caller's OwnerAccount(s) — only the primary-owned ones carry a
        // referral identity. Secondary memberships don't issue codes.
        var ownerAccountIds = await accountsDb.OwnerAccounts
            .AsNoTracking()
            .Where(a => a.PrimaryOwnerUserId == userId)
            .Select(a => a.Id)
            .ToListAsync(ct);

        if (ownerAccountIds.Count == 0)
        {
            return new AffiliationSnapshot(null, 0, 0, 0);
        }

        var referralCode = await accountsDb.ReferralCodes
            .AsNoTracking()
            .Where(r => ownerAccountIds.Contains(r.OwnerAccountId) && r.IsActive)
            .OrderByDescending(r => r.CreatedAtUtc)
            .Select(r => r.Code)
            .FirstOrDefaultAsync(ct);

        var referralsTotal = await accountsDb.ReferralRelationships
            .AsNoTracking()
            .CountAsync(r => ownerAccountIds.Contains(r.ReferrerOwnerAccountId), ct);

        var referralsQualified = await accountsDb.ReferralRelationships
            .AsNoTracking()
            .CountAsync(r => ownerAccountIds.Contains(r.ReferrerOwnerAccountId) &&
                             r.Status == Accounts.Domain.Affiliation.ReferralRelationshipStatus.Qualified, ct);

        var benefitsEarned = await accountsDb.BenefitLedgerEntries
            .AsNoTracking()
            .CountAsync(b => ownerAccountIds.Contains(b.OwnerAccountId), ct);

        return new AffiliationSnapshot(
            ReferralCode: referralCode,
            ReferralsTotal: referralsTotal,
            ReferralsQualified: referralsQualified,
            BenefitsEarned: benefitsEarned);
    }
}
