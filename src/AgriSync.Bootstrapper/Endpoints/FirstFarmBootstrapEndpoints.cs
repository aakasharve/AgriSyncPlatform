using System.Security.Claims;
using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// First-farm bootstrap. Creates OwnerAccount → starts 14-day trial →
/// creates Farm attached to that account → assigns FarmCode → creates
/// PrimaryOwner FarmMembership. All in one transaction across both
/// DbContexts (following the pattern already established by
/// <see cref="Migrations.BackfillFarmOwnerAccounts"/>).
///
/// This endpoint lives in the Bootstrapper because it legitimately
/// spans both ShramSafal and Accounts — putting it in either App
/// would require one to reference the other, violating Architecture
/// Ref §7. The Bootstrapper is the one place that composes both.
/// </summary>
public static class FirstFarmBootstrapEndpoints
{
    public static IEndpointRouteBuilder MapFirstFarmBootstrapEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/bootstrap/first-farm", async (
            BootstrapFirstFarmRequest request,
            ClaimsPrincipal user,
            ShramSafalDbContext ssfDb,
            AccountsDbContext accountsDb,
            TenantContext tenantContext,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            if (!IsPhoneVerified(user))
            {
                return Results.Json(
                    new { error = "bootstrap.phone_not_verified", message = "Verify your phone first." },
                    statusCode: 403);
            }

            if (request is null || string.IsNullOrWhiteSpace(request.FarmName))
            {
                return Results.Json(
                    new { error = "bootstrap.invalid_payload", message = "Farm name is required." },
                    statusCode: 400);
            }

            var typedUserId = new UserId(userId);
            var farmName = request.FarmName.Trim();
            var nowUtc = DateTime.UtcNow;

            // 1. Find-or-create the OwnerAccount. The `accounts` schema is NOT under the
            //    ssf farm_id RLS (AccountsDbContext registers no TenantConnectionInterceptor),
            //    so these reads/writes need no tenant context.
            var account = await accountsDb.OwnerAccounts
                .FirstOrDefaultAsync(a => a.PrimaryOwnerUserId == typedUserId, ct);

            if (account is null)
            {
                account = OwnerAccount.Create(
                    id: OwnerAccountId.New(),
                    accountName: farmName,
                    primaryOwnerUserId: typedUserId,
                    accountType: OwnerAccountType.Individual,
                    createdAtUtc: nowUtc);
                accountsDb.OwnerAccounts.Add(account);
            }

            // 2. Trial subscription — preserve invariant I6 (at most one Active/Trialing).
            var subscription = await accountsDb.Subscriptions
                .Where(s => s.OwnerAccountId == account.Id
                    && (s.Status == SubscriptionStatus.Trialing || s.Status == SubscriptionStatus.Active))
                .FirstOrDefaultAsync(ct);

            if (subscription is null)
            {
                subscription = Subscription.StartTrial(
                    id: SubscriptionId.New(),
                    ownerAccountId: account.Id,
                    planCode: PlanCode.ShramSafalPro,
                    trialStartUtc: nowUtc,
                    trialEndsAtUtc: nowUtc.AddDays(14));
                accountsDb.Subscriptions.Add(subscription);
            }

            // 3. Decide the bootstrap farm id and RECORD IT ON THE ACCOUNT (accounts side)
            //    BEFORE any ssf write. This is what makes the operation idempotent and
            //    recoverable across a partial write (account saved, farm not): a re-run
            //    reuses the same farm id, so we either find the already-created farm or
            //    create it deterministically — never a duplicate, never an orphan stuck.
            var farmId = account.BootstrappedFarmId ?? Guid.NewGuid();
            account.SetBootstrappedFarm(farmId, nowUtc);

            await accountsDb.SaveChangesAsync(ct);

            // 4. Establish tenant context for the FORCE-RLS ssf tables. The
            //    TenantConnectionInterceptor then emits `SET LOCAL agrisync.farm_id = <farmId>`,
            //    so the ssf.farms WITH CHECK ("Id" = current_setting('agrisync.farm_id')) and the
            //    ssf.farm_memberships policy both pass for THIS user's own new farm. Admin scope
            //    would skip the GUC and FORCE-RLS (no BYPASSRLS) would then block the insert.
            var typedFarmId = new FarmId(farmId);
            tenantContext.SetTenant(farmId, (Guid)account.Id, userId);

            // 5. Find-or-create the Farm (ssf). With the tenant set, this read is scoped to
            //    exactly this farm id, so it returns the farm iff a prior run already created it.
            var farm = await ssfDb.Farms.FirstOrDefaultAsync(f => f.Id == typedFarmId, ct);
            var wasAlreadyBootstrapped = farm is not null;

            if (farm is null)
            {
                farm = Farm.Create(
                    id: typedFarmId,
                    name: farmName,
                    ownerUserId: typedUserId,
                    createdAtUtc: nowUtc);
                farm.AttachToOwnerAccount(account.Id, nowUtc);
                farm.AssignFarmCode(GenerateFarmCode(), nowUtc);
                ssfDb.Farms.Add(farm);

                var membership = FarmMembership.Create(
                    id: Guid.NewGuid(),
                    farmId: farm.Id,
                    userId: typedUserId,
                    role: AppRole.PrimaryOwner,
                    grantedAtUtc: nowUtc);
                ssfDb.FarmMemberships.Add(membership);

                await ssfDb.SaveChangesAsync(ct);
            }

            return Results.Ok(BuildResponse(farm, account, subscription, wasAlreadyBootstrapped));
        })
        .WithName("BootstrapFirstFarm")
        .WithTags("Onboarding")
        .RequireAuthorization();

        return endpoints;
    }

    private static object BuildResponse(Farm farm, OwnerAccount account, Subscription? subscription, bool wasAlreadyBootstrapped)
    {
        return new
        {
            farmId = (Guid)farm.Id,
            farmName = farm.Name,
            farmCode = farm.FarmCode,
            ownerAccountId = (Guid)account.Id,
            subscription = subscription is null
                ? null
                : (object)new
                {
                    subscriptionId = (Guid)subscription.Id,
                    status = subscription.Status.ToString(),
                    planCode = subscription.PlanCode,
                    validUntilUtc = subscription.ValidUntilUtc,
                    allowsOwnerWrites = subscription.AllowsOwnerWrites,
                },
            wasAlreadyBootstrapped,
        };
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId)
    {
        var subject = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(subject, out userId);
    }

    private static bool IsPhoneVerified(ClaimsPrincipal user) =>
        string.Equals(user.FindFirstValue("phone_verified"), "true", StringComparison.OrdinalIgnoreCase);

    private static readonly char[] FarmCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".ToCharArray();

    private static string GenerateFarmCode()
    {
        Span<byte> bytes = stackalloc byte[6];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        Span<char> chars = stackalloc char[6];
        for (var i = 0; i < 6; i++)
        {
            chars[i] = FarmCodeAlphabet[bytes[i] % FarmCodeAlphabet.Length];
        }
        return new string(chars);
    }
}

public sealed record BootstrapFirstFarmRequest(string? FarmName, string? Village);
