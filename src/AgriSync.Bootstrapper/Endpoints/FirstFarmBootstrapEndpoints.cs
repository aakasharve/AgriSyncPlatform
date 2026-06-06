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
using User.Infrastructure.Persistence;

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
            UserDbContext userDb,
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

            // 4. Scope the FORCE-RLS ssf writes WITHOUT the TenantConnectionInterceptor's
            //    SET LOCAL prelude. The interceptor prepends `SET LOCAL agrisync.* = ...` to
            //    every EF command on a single-tenant claim; on a WRITING command that prepend
            //    desynchronises EF's rows-affected accounting and surfaces a spurious
            //    DbUpdateConcurrencyException ("expected 1 row, affected 0") on the INSERT —
            //    the real root cause of the first-farm 500s (NOT a WITH CHECK / RLS denial).
            //    Instead, elevate to admin scope so the interceptor no-ops, then set the farm
            //    GUC ourselves so the ssf.farms / ssf.farm_memberships WITH CHECK
            //    ("= current_setting('agrisync.farm_id')") still pass for THIS user's own new
            //    farm. Same self-GUC pattern as the getMyFarms read path
            //    (ShramSafalRepository.GetMyFarmsAsync). The GUCs are tx-local (is_local=true)
            //    and ride the per-request transaction TenantTransactionMiddleware already opened
            //    on this writing context. spec: getmyfarms-user-scoped-rls-read-path-2026-06-06.
            var typedFarmId = new FarmId(farmId);
            tenantContext.ElevateToAdminCrossTenant();
            await ssfDb.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT set_config('agrisync.farm_id', {farmId.ToString()}, true)", ct);
            await ssfDb.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT set_config('agrisync.owner_account_id', {((Guid)account.Id).ToString()}, true)", ct);
            await ssfDb.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)", ct);

            // 5. Find-or-create the Farm (ssf). The manual farm GUC scopes this read to
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

            // 6. Farmer Name (minimal post-OTP onboarding) → user display name.
            //    public.users is NOT under RLS (it is the global auth directory —
            //    see 20260516150000_EnableUserDbRowLevelSecurity remarks), so this
            //    update needs no farm tenancy. Under the admin elevation above the
            //    interceptor no-ops on the UserDbContext command too (so its prelude
            //    can't desync EF's rows-affected on this UPDATE). Idempotent:
            //    re-bootstrap with the same name is a no-op; a blank name is ignored.
            if (!string.IsNullOrWhiteSpace(request.FarmerName))
            {
                var farmerUser = await userDb.Users.FirstOrDefaultAsync(u => u.Id == typedUserId, ct);
                if (farmerUser is not null)
                {
                    farmerUser.UpdateDisplayName(request.FarmerName);
                    await userDb.SaveChangesAsync(ct);
                }
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

public sealed record BootstrapFirstFarmRequest(string? FarmName, string? Village, string? FarmerName = null);
