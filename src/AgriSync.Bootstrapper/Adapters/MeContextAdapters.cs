using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence;
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

/// <summary>
/// spec: dfes-companion-2026-07-11 — reads the caller's farm memberships for
/// <c>GET /user/auth/me/context</c>.
///
/// <para>
/// <b>Why this reader establishes its own tenant scope.</b> The join below hits
/// <c>ssf.farm_memberships</c> ⋈ <c>ssf.farms</c>, both of which carry
/// user-scoped PERMISSIVE SELECT policies keyed ENTIRELY on
/// <c>current_setting('agrisync.user_id', true)</c>
/// (<c>p_user_select_memberships</c> / <c>p_user_select_farms</c>). But
/// <c>/user/auth</c> is on <see cref="AgriSync.BuildingBlocks.Persistence.TenantTransactionMiddleware"/>'s
/// skip-list (the anonymous login/OTP surface shares the prefix), so the request
/// is admin-elevated and NO <c>agrisync.user_id</c> GUC is ever set. Under
/// FORCE-RLS as <c>agrisync_app</c> (<c>rolbypassrls = false</c>) the join then
/// returns ZERO rows for a farmer who demonstrably owns a farm, and
/// <c>GetMeContextHandler</c> faithfully reports <c>no_farms_yet</c> — the
/// endpoint lies. Verified on <c>agrisync_dfes</c>: 0 rows with no GUC, 1 row
/// with it.
/// </para>
///
/// <para>
/// <b>Why the fix lives HERE and not in <c>User.Api</c>.</b> Establishing the scope
/// needs the ShramSafal <c>DbContext</c>. Doing it from
/// <c>User.Api/Endpoints/AuthEndpoints.cs</c> would compile but is a cross-context
/// import, forbidden by root <c>CLAUDE.md</c> §Layering ("cross-context
/// communication via SharedKernel events only"). This composition-root adapter is
/// already the ONLY place in the backend that reads across app DbContexts (see the
/// file header), so it is the legal place. When the User-side projection tables
/// land, this whole file — scope prelude included — is deleted along with the
/// cross-context read.
/// </para>
///
/// <para>
/// <b>Why an explicit transaction.</b> The GUC is set with
/// <c>set_config(..., is_local := true)</c>, which Postgres scopes to the CURRENT
/// transaction. The skip-list branch of the middleware returns without opening one,
/// so on auto-commit the GUC would expire before the join ran.
/// <see cref="RlsIdentityScope"/> owns that transaction decision — it joins an
/// ambient transaction when there is one and opens its own when there is not —
/// which is why this class no longer manages one itself.
/// </para>
///
/// <para>
/// <b>No RLS is weakened.</b> The scope carries the caller's OWN validated JWT
/// subject (threaded down from <c>ClaimsPrincipal</c> via
/// <c>GetMeContextHandler</c>), never a caller-supplied id, and every policy
/// stays exactly as written.
/// </para>
/// </summary>
public sealed class FarmMembershipSnapshotReader(
    ShramSafalDbContext ssfDb,
    AccountsDbContext accountsDb) : IFarmMembershipSnapshotReader
{
    public async Task<IReadOnlyList<FarmMembershipSnapshot>> GetForUserAsync(UserId userId, CancellationToken ct = default)
    {
        // GET /user/auth/me/context sits under the "/user/auth" prefix, which is
        // skip-listed in TenantTransactionMiddleware (the anonymous auth surface:
        // login/register/refresh have no tenant claim by definition). Skip-listed
        // paths get ElevateToAdminCrossTenant, so the interceptor stops fail-closing
        // — but it also injects NO GUC and opens NO transaction. The result was
        // silent and expensive: the p_user_select_memberships RLS policy keys on
        // `agrisync.user_id`, found it unset, and correctly filtered every row away.
        // me/context then reported `farms: []` with a `no_farms_yet` alert for a
        // farmer who demonstrably OWNS a farm, which made the frontend's FarmContext
        // overwrite a perfectly good farm id with null and blanked the labour screens.
        //
        // Fix goes through RlsIdentityScope — the ONE shared helper for
        // establishing identity outside the request pipeline. It opens the
        // transaction `set_config(..., is_local: true)` needs (Postgres scopes
        // the setting to the current transaction) and sets the GUC through a
        // PARAMETERISED call. Same helper now used by
        // ShramSafalRepository.GetMyFarmsAsync, UserRepository (the login
        // membership claim) and ComplianceEvaluatorSweeper.
        var rows = await RlsIdentityScope.RunAsUserAsync(
            ssfDb,
            userId.Value,
            token => ssfDb.FarmMemberships
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
                .ToListAsync(token),
            ct);

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
