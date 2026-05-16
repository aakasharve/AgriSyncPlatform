using Accounts.Application.Ports;
using Accounts.Domain.Affiliation;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// Daily scan (plan §7.2.2) — emits <c>WorkerRetained30d</c> GrowthEvent for
/// farm memberships that crossed the 30-day retention threshold since the
/// last scan. De-dup via I11 unique (EventType, ReferenceId) index.
///
/// Worker membership data comes from ShramSafal; this job queries the
/// cross-app <c>ssf.subscription_projections</c> view via <see cref="IWorkerRetentionReader"/>.
/// That interface is the only permitted cross-app read in Phase 7 (plan §0A.7).
/// </summary>
public sealed class WorkerRetentionJob(
    IServiceScopeFactory scopeFactory,
    ILogger<WorkerRetentionJob> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("WorkerRetentionJob started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPassAsync(stoppingToken);

            var now = DateTime.UtcNow;
            var nextRun = now.Date.AddDays(1).AddHours(3); // 03:00 UTC
            var delay = nextRun - now;
            if (delay <= TimeSpan.Zero) delay = TimeSpan.FromHours(24);

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RunPassAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — the retention
        // reader joins ssf.farm_memberships across every farm in the
        // system; a single-farm tenant claim would mask all but one. The
        // admin factory writes an AuditEvent("admin_cross_tenant","open")
        // row with farm_id=NULL BEFORE returning, so each nightly pass
        // leaves a forensic breadcrumb naming this job as the opener.
        //
        // The returned context is disposed immediately — WorkerRetentionReader
        // is a scoped service that resolves the SCOPED ShramSafalDbContext
        // (interceptor-attached), and AffiliationRepository binds to the
        // scoped AccountsDbContext (no interceptor). The SSF scoped
        // context still needs TenantContext elevation to skip the fail-
        // closed GUC-injection prelude. Holding both calls keeps the audit
        // trail honest while preserving the reader/repo wiring.
        var adminFactory = scope.ServiceProvider
            .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using (await adminFactory.CreateAsync(
            reason: nameof(WorkerRetentionJob),
            actorUserId: SystemActor.Worker,
            ct: ct))
        {
            // Audit row committed; primary context disposed.
        }
        scope.ServiceProvider
            .GetRequiredService<TenantContext>()
            .ElevateToAdminCrossTenant();
        var affiliationRepo = scope.ServiceProvider.GetRequiredService<IAffiliationRepository>();
        var retentionReader = scope.ServiceProvider.GetRequiredService<IWorkerRetentionReader>();
        var clock = scope.ServiceProvider.GetRequiredService<IClock>();
        var idGenerator = scope.ServiceProvider.GetRequiredService<IIdGenerator>();

        try
        {
            var threshold = clock.UtcNow.AddDays(-30);
            var memberships = await retentionReader.GetMembershipsCrossing30dThresholdAsync(threshold, ct);

            if (memberships.Count == 0) return;
            logger.LogInformation("WorkerRetentionJob: checking {Count} memberships for 30d retention.", memberships.Count);

            foreach (var m in memberships)
            {
                var already = await affiliationRepo.GrowthEventExistsAsync(
                    GrowthEventType.WorkerRetained30d, m.MembershipId, ct);
                if (already) continue;

                var evt = new GrowthEvent(
                    new GrowthEventId(idGenerator.New()),
                    ownerAccountId: m.OwnerAccountId,
                    eventType: GrowthEventType.WorkerRetained30d,
                    referenceId: m.MembershipId,
                    metadata: null,
                    occurredAtUtc: clock.UtcNow);
                await affiliationRepo.AddGrowthEventAsync(evt, ct);
            }

            await affiliationRepo.SaveChangesAsync(ct);
            logger.LogInformation("WorkerRetentionJob pass complete.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "WorkerRetentionJob pass failed.");
        }
    }
}

/// <summary>
/// Port for reading FarmMembership retention data from ShramSafal's side.
/// Implemented in Bootstrapper.Infrastructure — the only place allowed to
/// compose across apps (plan §0A.4, §0A.7).
/// </summary>
public interface IWorkerRetentionReader
{
    Task<List<WorkerRetentionEntry>> GetMembershipsCrossing30dThresholdAsync(
        DateTime activeBefore,
        CancellationToken ct = default);
}

public sealed record WorkerRetentionEntry(Guid MembershipId, OwnerAccountId OwnerAccountId);
