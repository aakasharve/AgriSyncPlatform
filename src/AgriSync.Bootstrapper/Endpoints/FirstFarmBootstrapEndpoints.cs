using System.Security.Claims;
using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
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
            var nowUtc = DateTime.UtcNow;

            // Idempotent-ish guard: if this user already has an OwnerAccount
            // with at least one farm, return it instead of creating a second.
            var existingAccount = await accountsDb.OwnerAccounts
                .FirstOrDefaultAsync(a => a.PrimaryOwnerUserId == typedUserId, ct);

            if (existingAccount is not null)
            {
                var existingFarm = await ssfDb.Farms
                    .FirstOrDefaultAsync(f => f.OwnerAccountId == existingAccount.Id, ct);

                if (existingFarm is not null)
                {
                    return Results.Ok(BuildResponse(
                        farm: existingFarm,
                        account: existingAccount,
                        subscription: await accountsDb.Subscriptions
                            .Where(s => s.OwnerAccountId == existingAccount.Id
                                && (s.Status == SubscriptionStatus.Trialing || s.Status == SubscriptionStatus.Active))
                            .FirstOrDefaultAsync(ct),
                        wasAlreadyBootstrapped: true));
                }
            }

            // 1. OwnerAccount
            var account = existingAccount ?? OwnerAccount.Create(
                id: OwnerAccountId.New(),
                accountName: request.FarmName.Trim(),
                primaryOwnerUserId: typedUserId,
                accountType: OwnerAccountType.Individual,
                createdAtUtc: nowUtc);

            if (existingAccount is null)
            {
                accountsDb.OwnerAccounts.Add(account);
            }

            // 2. Trial subscription (only if the account doesn't already
            // have one — preserves invariant I6).
            var existingTrial = existingAccount is null
                ? null
                : await accountsDb.Subscriptions
                    .FirstOrDefaultAsync(s => s.OwnerAccountId == existingAccount.Id
                        && (s.Status == SubscriptionStatus.Trialing || s.Status == SubscriptionStatus.Active), ct);

            var subscription = existingTrial ?? Subscription.StartTrial(
                id: SubscriptionId.New(),
                ownerAccountId: account.Id,
                planCode: PlanCode.ShramSafalPro,
                trialStartUtc: nowUtc,
                trialEndsAtUtc: nowUtc.AddDays(14));

            if (existingTrial is null)
            {
                accountsDb.Subscriptions.Add(subscription);
            }

            await accountsDb.SaveChangesAsync(ct);

            // 3. Farm + FarmCode + PrimaryOwner membership (ssf schema)
            var farm = Farm.Create(
                id: FarmId.New(),
                name: request.FarmName.Trim(),
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

            return Results.Ok(BuildResponse(farm, account, subscription, wasAlreadyBootstrapped: false));
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
