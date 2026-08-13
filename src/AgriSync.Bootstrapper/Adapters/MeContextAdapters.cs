using Accounts.Infrastructure.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
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
/// <b>Why the fix lives HERE and not in <c>User.Api</c>.</b> The seam that
/// establishes the scope, <see cref="ICallerUserTenantScope"/>, belongs to the
/// ShramSafal context. Calling it from <c>User.Api/Endpoints/AuthEndpoints.cs</c>
/// would compile but is a cross-context import, forbidden by root
/// <c>CLAUDE.md</c> §Layering ("cross-context communication via SharedKernel
/// events only"). This composition-root adapter is already the ONLY place in the
/// backend that reads across app DbContexts (see the file header), so it is the
/// legal place to compose a ShramSafal port with a User-context port. When the
/// User-side projection tables land, this whole file — scope prelude included —
/// is deleted along with the cross-context read.
/// </para>
///
/// <para>
/// <b>Why an explicit transaction.</b> <see cref="ICallerUserTenantScope"/> sets
/// the GUC with <c>set_config(..., is_local := true)</c>, which Postgres scopes
/// to the CURRENT transaction. The skip-list branch of the middleware returns
/// without opening one, so on auto-commit the GUC would expire before the join
/// ran. Same reasoning, same shape as
/// <c>ShramSafalRepository.GetMyFarmsAsync</c>, the sibling one-off for the
/// other skip-listed user-scoped read (<c>GET /shramsafal/farms/mine</c>).
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
    AccountsDbContext accountsDb,
    ICallerUserTenantScope callerUserScope) : IFarmMembershipSnapshotReader
{
    private sealed record MembershipRow(
        FarmId FarmId,
        string FarmName,
        string? FarmCode,
        OwnerAccountId OwnerAccountId,
        AgriSync.SharedKernel.Contracts.Roles.AppRole Role,
        ShramSafal.Domain.Farms.MembershipStatus Status,
        ShramSafal.Domain.Farms.JoinedVia JoinedVia,
        DateTime GrantedAtUtc,
        DateTime? LastSeenAtUtc);

    public async Task<IReadOnlyList<FarmMembershipSnapshot>> GetForUserAsync(UserId userId, CancellationToken ct = default)
    {
        var rows = await ReadMembershipRowsAsync(userId, ct);

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

    /// <summary>
    /// Runs the membership join under the caller's OWN user-scoped tenant claim.
    /// See the class remarks for why the scope has to be established here and why
    /// it needs its own transaction.
    /// </summary>
    private async Task<List<MembershipRow>> ReadMembershipRowsAsync(UserId userId, CancellationToken ct)
    {
        // Non-relational provider (EF InMemory, swapped in by some integration
        // tests) has no RLS to satisfy and no transactions/raw SQL to use —
        // matching the identical guard inside CallerUserTenantScope.
        if (!ssfDb.Database.IsRelational())
        {
            return await QueryMembershipRowsAsync(userId, ct);
        }

        // A caller that already opened the per-request transaction (any route NOT
        // on the middleware skip-list) gets the GUC on that transaction; opening a
        // second one would throw.
        if (ssfDb.Database.CurrentTransaction is not null)
        {
            await EstablishCallerScopeAsync(userId, ct);
            return await QueryMembershipRowsAsync(userId, ct);
        }

        await using var tx = await ssfDb.Database.BeginTransactionAsync(ct);
        await EstablishCallerScopeAsync(userId, ct);
        var rows = await QueryMembershipRowsAsync(userId, ct);
        await tx.CommitAsync(ct);
        return rows;
    }

    private async Task EstablishCallerScopeAsync(UserId userId, CancellationToken ct)
    {
        var scopeResult = await callerUserScope.EstablishForCallerAsync(userId.Value, ct);
        if (!scopeResult.IsSuccess)
        {
            // Fail LOUD. Falling through would run the join with no
            // agrisync.user_id GUC, which under FORCE-RLS returns zero rows and
            // makes me/context answer "no_farms_yet" to a farmer who has a farm.
            // An honest 500 beats a confident wrong answer.
            throw new InvalidOperationException(
                "FarmMembershipSnapshotReader: could not establish the caller's user-scoped " +
                $"tenant claim ({scopeResult.Error?.Code}); refusing to report farm memberships " +
                "from an unscoped read.");
        }
    }

    private Task<List<MembershipRow>> QueryMembershipRowsAsync(UserId userId, CancellationToken ct) =>
        ssfDb.FarmMemberships
            .AsNoTracking()
            .Join(ssfDb.Farms,
                m => m.FarmId,
                f => f.Id,
                (m, f) => new { m, f })
            .Where(x =>
                x.m.UserId == userId &&
                x.m.RevokedAtUtc == null &&
                x.m.ExitedAtUtc == null)
            .Select(x => new MembershipRow(
                x.f.Id,
                x.f.Name,
                x.f.FarmCode,
                x.f.OwnerAccountId,
                x.m.Role,
                x.m.Status,
                x.m.JoinedVia,
                x.m.GrantedAtUtc,
                x.m.LastSeenAtUtc))
            .ToListAsync(ct);
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
