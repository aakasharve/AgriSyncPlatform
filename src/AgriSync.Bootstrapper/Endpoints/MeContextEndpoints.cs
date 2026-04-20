using System.Security.Claims;
using Accounts.Infrastructure.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// GET /user/auth/me/context
///
/// Aggregate endpoint that composes User + Accounts + ShramSafal reads into
/// a single response. Lives in Bootstrapper (plan §0A.4) — the only host
/// allowed to query across DbContexts.
///
/// Response:
/// {
///   user:         { userId, displayName, phoneMasked, phoneVerifiedAtUtc },
///   ownerAccounts: [ { ownerAccountId, accountName, isPrimaryOwner, subscription } ],
///   memberships:  [ { farmId, farmName, farmCode, ownerAccountId, role, status, joinedVia } ],
///   affiliation:  { referralCode, referralsTotal, referralsQualified, benefitsEarned },
///   serverTimeUtc
/// }
/// </summary>
public static class MeContextEndpoints
{
    public static IEndpointRouteBuilder MapMeContextEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/user/auth/me/context", async (
            ClaimsPrincipal principal,
            UserDbContext userDb,
            ShramSafalDbContext ssfDb,
            AccountsDbContext accountsDb,
            CancellationToken ct) =>
        {
            if (!Guid.TryParse(principal.FindFirstValue("sub"), out var userId))
            {
                return Results.Unauthorized();
            }

            // 1. User identity
            var user = await userDb.Users
                .AsNoTracking()
                .Where(u => u.Id == new UserId(userId))
                .Select(u => new
                {
                    UserId = u.Id.Value,
                    u.DisplayName,
                    PhoneMasked = MaskPhone(u.Phone.Value),
                })
                .FirstOrDefaultAsync(ct);

            if (user is null)
            {
                return Results.NotFound(new { error = "user_not_found" });
            }

            // 2. OwnerAccount + subscription(s) the caller owns
            var ownerAccounts = await accountsDb.OwnerAccounts
                .AsNoTracking()
                .Where(a => a.PrimaryOwnerUserId == new UserId(userId))
                .Select(a => new
                {
                    OwnerAccountId = a.Id.Value,
                    a.AccountName,
                    IsPrimaryOwner = true,
                    Subscription = accountsDb.Subscriptions
                        .Where(s => s.OwnerAccountId == a.Id &&
                                    (s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Trialing ||
                                     s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Active ||
                                     s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.PastDue))
                        .OrderByDescending(s => s.CreatedAtUtc)
                        .Select(s => new
                        {
                            SubscriptionId = s.Id.Value,
                            Status = s.Status.ToString(),
                            StatusCode = (int)s.Status,
                            s.PlanCode,
                            ValidUntilUtc = s.ValidUntilUtc,
                            AllowsOwnerWrites = s.AllowsOwnerWrites,
                        })
                        .FirstOrDefault(),
                })
                .ToListAsync(ct);

            // 3. Farm memberships the caller belongs to
            var memberships = await ssfDb.FarmMemberships
                .AsNoTracking()
                .Join(ssfDb.Farms,
                    m => m.FarmId,
                    f => f.Id,
                    (m, f) => new { m, f })
                .Where(x =>
                    x.m.UserId == new UserId(userId) &&
                    x.m.RevokedAtUtc == null &&
                    x.m.ExitedAtUtc == null)
                .Select(x => new
                {
                    MembershipId = x.m.Id,
                    FarmId = x.f.Id.Value,
                    FarmName = x.f.Name,
                    FarmCode = x.f.FarmCode,
                    OwnerAccountId = x.f.OwnerAccountId.Value,
                    Role = x.m.Role.ToString(),
                    Status = x.m.Status.ToString(),
                    JoinedVia = x.m.JoinedVia.ToString(),
                    LastSeenAtUtc = x.m.LastSeenAtUtc,
                    GrantedAtUtc = x.m.GrantedAtUtc,
                    // Attach subscription snapshot for the farm context switcher
                    Subscription = accountsDb.Subscriptions
                        .Where(s => s.OwnerAccountId == x.f.OwnerAccountId &&
                                    (s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Trialing ||
                                     s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.Active ||
                                     s.Status == Accounts.Domain.Subscriptions.SubscriptionStatus.PastDue))
                        .OrderByDescending(s => s.CreatedAtUtc)
                        .Select(s => new
                        {
                            Status = s.Status.ToString(),
                            StatusCode = (int)s.Status,
                            s.PlanCode,
                            ValidUntilUtc = s.ValidUntilUtc,
                            AllowsOwnerWrites = s.AllowsOwnerWrites,
                        })
                        .FirstOrDefault(),
                })
                .ToListAsync(ct);

            // 4. Affiliation stats — referral code + counters
            var referralCode = await accountsDb.ReferralCodes
                .AsNoTracking()
                .Where(r => r.OwnerAccountId.Value == userId && r.IsActive)
                .Select(r => r.Code)
                .FirstOrDefaultAsync(ct);

            var referralsTotal = await accountsDb.ReferralRelationships
                .AsNoTracking()
                .CountAsync(r => r.ReferrerOwnerAccountId.Value == userId, ct);

            var referralsQualified = await accountsDb.ReferralRelationships
                .AsNoTracking()
                .CountAsync(r => r.ReferrerOwnerAccountId.Value == userId &&
                                 r.Status == Accounts.Domain.Affiliation.ReferralRelationshipStatus.Qualified, ct);

            var benefitsEarned = await accountsDb.BenefitLedgerEntries
                .AsNoTracking()
                .CountAsync(b => b.OwnerAccountId.Value == userId, ct);

            return Results.Ok(new
            {
                user,
                ownerAccounts,
                memberships,
                affiliation = new
                {
                    referralCode,
                    referralsTotal,
                    referralsQualified,
                    benefitsEarned,
                },
                serverTimeUtc = DateTime.UtcNow,
            });
        })
        .WithName("GetMeContext")
        .WithTags("User")
        .RequireAuthorization();

        return endpoints;
    }

    private static string MaskPhone(string phone)
    {
        if (phone.Length < 4) return "****";
        return phone[..^4].Select(_ => '*').Aggregate("", (a, c) => a + c) + phone[^4..];
    }
}
