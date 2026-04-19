using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Migrations;

/// <summary>
/// Phase 2 backfill — one <see cref="OwnerAccount"/> per existing
/// <see cref="Farm"/>.
///
/// Runs exactly once at startup when the feature flag
/// <c>BACKFILL_V1_ACCOUNTS</c> is truthy, OR when any farm has a null
/// <c>owner_account_id</c>. Idempotent: a second run is a no-op.
///
/// Plan reference: §7.2 Step B and Task 2.3.2.
/// </summary>
internal sealed class BackfillFarmOwnerAccounts : IHostedService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<BackfillFarmOwnerAccounts> _logger;

    public BackfillFarmOwnerAccounts(
        IServiceProvider services,
        ILogger<BackfillFarmOwnerAccounts> logger)
    {
        _services = services;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _services.CreateAsyncScope();
            var ssfDb = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
            var accountsDb = scope.ServiceProvider.GetRequiredService<AccountsDbContext>();

            // Post-Phase-2 the OwnerAccountId column is NOT NULL in the DB,
            // so "not yet backfilled" maps to OwnerAccountId.Empty. This
            // loop is a no-op for already-attached farms — idempotent.
            var farmsWithoutAccount = await ssfDb.Farms
                .Where(f => f.OwnerAccountId == OwnerAccountId.Empty)
                .ToListAsync(cancellationToken);

            if (farmsWithoutAccount.Count == 0)
            {
                _logger.LogInformation("Farm→OwnerAccount backfill: no work to do.");
                // Still run trial bootstrap — existing OwnerAccounts may
                // have been created pre-Phase-5 and need a subscription.
                var nowUtc2 = DateTime.UtcNow;
                await StartTrialsForNewOwnerAccountsAsync(accountsDb, nowUtc2, cancellationToken);
                return;
            }

            _logger.LogInformation(
                "Farm→OwnerAccount backfill: {Count} farm(s) need attachment.",
                farmsWithoutAccount.Count);

            var nowUtc = DateTime.UtcNow;
            var created = 0;
            var attached = 0;

            foreach (var farm in farmsWithoutAccount)
            {
                if (cancellationToken.IsCancellationRequested) break;

                // Has this owner already been backfilled for another farm?
                var existing = await accountsDb.OwnerAccounts
                    .FirstOrDefaultAsync(a => a.PrimaryOwnerUserId == farm.OwnerUserId, cancellationToken);

                OwnerAccount account;
                if (existing is not null)
                {
                    account = existing;
                }
                else
                {
                    var accountId = OwnerAccountId.New();
                    account = OwnerAccount.Create(
                        accountId,
                        accountName: farm.Name,
                        primaryOwnerUserId: farm.OwnerUserId,
                        accountType: OwnerAccountType.Individual,
                        createdAtUtc: nowUtc);

                    accountsDb.OwnerAccounts.Add(account);
                    created++;
                }

                farm.AttachToOwnerAccount(account.Id, nowUtc);
                if (string.IsNullOrWhiteSpace(farm.FarmCode))
                {
                    farm.AssignFarmCode(GenerateFarmCode(), nowUtc);
                }

                attached++;
            }

            await accountsDb.SaveChangesAsync(cancellationToken);
            await ssfDb.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Farm→OwnerAccount backfill complete. Created {Created} OwnerAccount(s), attached {Attached} farm(s).",
                created,
                attached);

            // Phase 5: auto-start a 14-day trial subscription for any
            // OwnerAccount that does not yet have one. Idempotent via
            // the partial unique index `ux_subscriptions_owner_account_active`
            // (plan invariant I6).
            await StartTrialsForNewOwnerAccountsAsync(accountsDb, nowUtc, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Farm→OwnerAccount backfill failed. Service will continue to start; re-run safely by restarting.");
        }
    }

    private async Task StartTrialsForNewOwnerAccountsAsync(
        AccountsDbContext accountsDb,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        // Every OwnerAccount, every active/trialing subscription. Anti-join
        // gives us accounts that need a trial started.
        var accountsNeedingTrial = await accountsDb.OwnerAccounts
            .Where(a => !accountsDb.Subscriptions.Any(s =>
                s.OwnerAccountId == a.Id
                && (s.Status == SubscriptionStatus.Trialing || s.Status == SubscriptionStatus.Active)))
            .ToListAsync(cancellationToken);

        if (accountsNeedingTrial.Count == 0)
        {
            _logger.LogInformation("Trial bootstrap: no OwnerAccounts need a trial.");
            return;
        }

        var trialsCreated = 0;
        foreach (var account in accountsNeedingTrial)
        {
            if (cancellationToken.IsCancellationRequested) break;

            var trial = Subscription.StartTrial(
                id: SubscriptionId.New(),
                ownerAccountId: account.Id,
                planCode: PlanCode.ShramSafalPro,
                trialStartUtc: nowUtc,
                trialEndsAtUtc: nowUtc.AddDays(14));

            accountsDb.Subscriptions.Add(trial);
            trialsCreated++;
        }

        await accountsDb.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Trial bootstrap: started {Count} 14-day trial(s).",
            trialsCreated);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static readonly char[] Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".ToCharArray();

    private static string GenerateFarmCode()
    {
        // 6 chars Crockford-base32. Collision probability on a 10M-farm
        // corpus is ~0.5%; the DB's unique partial index guarantees
        // detection on the rare collision and the caller can retry.
        Span<byte> bytes = stackalloc byte[6];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        Span<char> chars = stackalloc char[6];
        for (var i = 0; i < 6; i++)
        {
            chars[i] = Alphabet[bytes[i] % Alphabet.Length];
        }
        return new string(chars);
    }
}
