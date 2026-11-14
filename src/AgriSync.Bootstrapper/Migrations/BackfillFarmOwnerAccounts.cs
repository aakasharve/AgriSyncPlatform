using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.Bootstrapper.Endpoints;
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
public sealed class BackfillFarmOwnerAccounts : IHostedService
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
            // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — backfill
            // scans every farm in the system, so we open a fresh
            // ShramSafalDbContext via IAdminDbContextFactory. The factory:
            //   1. Writes an AuditEvent("admin_cross_tenant","open") row
            //      with farm_id=NULL (visible to every tenant per the
            //      04.4 RLS policy on audit_events) BEFORE returning the
            //      context, so the cross-tenant scope is recorded even
            //      if backfill itself crashes mid-loop.
            //   2. Returns a context whose options chain has NO
            //      TenantConnectionInterceptor attached and whose
            //      connection string is the privileged migration role
            //      (ShramSafalDb_Migration → table-owner → RLS bypass).
            // AccountsDbContext has no TenantConnectionInterceptor (see
            // Accounts.Infrastructure.DependencyInjection), so we resolve
            // it from the scope as-is — no elevation required.
            var adminFactory = scope.ServiceProvider
                .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var ssfDb = await adminFactory.CreateAsync(
                reason: nameof(BackfillFarmOwnerAccounts),
                actorUserId: SystemActor.Worker,
                ct: cancellationToken);
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
                // Still run trial bootstrap — an OwnerAccount created pre-Phase-5 that has
                // NEVER had a subscription gets its first trial (and nothing else does).
                var nowUtc2 = DateTime.UtcNow;
                await StartTrialsForNewOwnerAccountsAsync(accountsDb, nowUtc2, _logger, cancellationToken);
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
                    farm.AssignFarmCode(FarmCode.New(), nowUtc);
                }

                attached++;
            }

            await accountsDb.SaveChangesAsync(cancellationToken);
            await ssfDb.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Farm→OwnerAccount backfill complete. Created {Created} OwnerAccount(s), attached {Attached} farm(s).",
                created,
                attached);

            // Phase 5: auto-start a 14-day trial subscription for any OwnerAccount that has
            // NEVER had a subscription (spec R-11 a — see the method).
            await StartTrialsForNewOwnerAccountsAsync(accountsDb, nowUtc, _logger, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Farm→OwnerAccount backfill failed. Service will continue to start; re-run safely by restarting.");
        }
    }

    /// <summary>
    /// spec R-11 (a) (pre-launch repair, founder N-1: "Remove both accidental trial resets") —
    /// a trial is started ONLY for an owner account that has never had a subscription row of any
    /// status. The anti-join used to match "no Trialing/Active row", so an Expired, Canceled,
    /// Suspended or PastDue account got a brand-new 14-day trial on EVERY server start — a farm
    /// locked on day 15 silently unlocked at the next release. An account whose trial ended now
    /// stays as it is; keeping a pilot farm working is the explicit, recorded access extension
    /// (accounts.access_extensions), never a restart.
    /// </summary>
    public static async Task StartTrialsForNewOwnerAccountsAsync(
        AccountsDbContext accountsDb,
        DateTime nowUtc,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var accountsNeedingTrial = await accountsDb.OwnerAccounts
            .Where(a => !accountsDb.Subscriptions.Any(s => s.OwnerAccountId == a.Id))
            .ToListAsync(cancellationToken);

        if (accountsNeedingTrial.Count == 0)
        {
            logger.LogInformation("Trial bootstrap: no OwnerAccount is without a subscription.");
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
                trialEndsAtUtc: nowUtc.AddDays(FirstFarmBootstrapEndpoints.FirstTrialDays));

            accountsDb.Subscriptions.Add(trial);
            trialsCreated++;
        }

        await accountsDb.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Trial bootstrap: started {Count} first {Days}-day trial(s).",
            trialsCreated,
            FirstFarmBootstrapEndpoints.FirstTrialDays);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
