using Accounts.Application.Ports;
using Accounts.Domain.Subscriptions;
using AgriSync.BuildingBlocks.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// Nightly hosted service that marks expired subscriptions and identifies
/// drift between provider state and local state.
///
/// Phase 5.3.2 (spec R6) — lightweight first pass:
///   1. Load all non-terminal subscriptions (Trialing/Active/PastDue)
///      with ValidUntilUtc in the past.
///   2. Call Expire() on each → saves to DB.
///   3. Emit a log entry per corrected subscription (audit log emission
///      lands in Phase 8).
///
/// A full provider-sync pass (fetching subscription state from the billing
/// provider API) lands when a provider is chosen. The table-driven scan
/// here is the deterministic fallback that keeps the DB consistent even
/// if a webhook was missed.
///
/// spec: plr-d10 pilot lane NO-TRIAL — while <see cref="PilotOptions.TrialEnforcementEnabled"/> is false (the default) a pass
/// expires NOTHING: Expired is one-way (<c>Subscription.Activate</c> refuses it), so no pilot farm's subscription may reach it.
/// The pass only counts the rows it would have expired and says so in the log; nothing is changed or saved.
/// </summary>
public sealed class SubscriptionReconciliationJob(
    IServiceScopeFactory scopeFactory,
    IOptions<PilotOptions> pilotOptions,
    ILogger<SubscriptionReconciliationJob> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("SubscriptionReconciliationJob started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunReconciliationPassAsync(stoppingToken);

            // Sleep until next midnight UTC.
            var now = DateTime.UtcNow;
            var nextRun = now.Date.AddDays(1).AddHours(2); // 02:00 UTC daily
            var delay = nextRun - now;
            if (delay <= TimeSpan.Zero)
            {
                delay = TimeSpan.FromHours(24);
            }

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        logger.LogInformation("SubscriptionReconciliationJob stopping.");
    }

    /// <summary>One nightly pass. Public so a test runs exactly this code (spec: plr-d10 pilot lane NO-TRIAL).</summary>
    public async Task RunReconciliationPassAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var subscriptionRepo = scope.ServiceProvider.GetRequiredService<ISubscriptionRepository>();
        var clock = scope.ServiceProvider.GetRequiredService<IClock>();

        try
        {
            var now = clock.UtcNow;
            var expired = await subscriptionRepo.GetNonTerminalExpiredAsync(now, ct);

            if (expired.Count == 0)
            {
                logger.LogDebug("Reconciliation pass: no expired subscriptions found.");
                return;
            }

            if (!pilotOptions.Value.TrialEnforcementEnabled)
            {
                // The pilot: no Expire(), no SaveChanges. Warning so the line is kept by the production log level.
                logger.LogWarning(
                    "Reconciliation pass: pilot mode (Pilot:TrialEnforcementEnabled=false) - {Count} subscriptions are past their end; none was expired.",
                    expired.Count);
                return;
            }

            logger.LogInformation("Reconciliation pass: expiring {Count} overdue subscriptions.", expired.Count);

            foreach (var sub in expired)
            {
                sub.Expire(now);
                logger.LogInformation(
                    "Subscription {SubscriptionId} (OwnerAccount {OwnerId}) auto-expired at {Now:O}.",
                    sub.Id, sub.OwnerAccountId, now);
            }

            await subscriptionRepo.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Reconciliation pass failed. Will retry next cycle.");
        }
    }
}
