using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// CEI Phase 3 §4.6 — nightly compliance evaluation sweeper.
/// Runs at 03:00 UTC daily: fetches all active farm IDs and dispatches
/// <see cref="EvaluateComplianceCommand"/> per farm via a scoped DI scope.
/// Failures on individual farms are caught and logged so one bad farm
/// does not block the rest.
/// </summary>
public sealed class ComplianceEvaluatorSweeper(
    IServiceScopeFactory scopeFactory,
    ILogger<ComplianceEvaluatorSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ComplianceEvaluatorSweeper started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPassAsync(stoppingToken);

            var now = DateTime.UtcNow;
            var nextRun = now.Date.AddDays(1).AddHours(3); // 03:00 UTC next day
            var delay = nextRun - now;
            if (delay <= TimeSpan.Zero) delay = TimeSpan.FromHours(24);

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("ComplianceEvaluatorSweeper stopping.");
    }

    private async Task RunPassAsync(CancellationToken ct)
    {
        List<Guid> farmIds;

        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — listing
            // every active farm is by definition a cross-tenant read. The
            // admin factory writes an AuditEvent("admin_cross_tenant","open")
            // row with farm_id=NULL BEFORE returning, recording the pre-
            // pass enumeration on ssf.audit_events.
            //
            // The returned context is disposed immediately — the resolved
            // IShramSafalRepository binds to the SCOPED ShramSafalDbContext
            // (interceptor-attached), which still needs TenantContext
            // elevation to skip the fail-closed GUC-injection prelude.
            var adminFactory = scope.ServiceProvider
                .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using (await adminFactory.CreateAsync(
                reason: $"{nameof(ComplianceEvaluatorSweeper)}.enumerate",
                actorUserId: SystemActor.Worker,
                ct: ct))
            {
                // Audit row committed; primary context disposed.
            }
            scope.ServiceProvider
                .GetRequiredService<TenantContext>()
                .ElevateToAdminCrossTenant();
            var repository = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();
            farmIds = await repository.GetAllActiveFarmIdsAsync(ct);
        }

        if (farmIds.Count == 0)
        {
            logger.LogDebug("ComplianceEvaluatorSweeper: no active farms found.");
            return;
        }

        logger.LogInformation("ComplianceEvaluatorSweeper evaluating {Count} farms.", farmIds.Count);
        int totalOpened = 0, totalRefreshed = 0, totalAutoResolved = 0;

        foreach (var farmId in farmIds)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — the
                // compliance handler operates on a single farm but its
                // DAOs span multiple tables under one ShramSafalDbContext
                // scope; routing through the admin factory records a
                // per-farm AuditEvent("admin_cross_tenant","open") row
                // with farm_id=NULL on ssf.audit_events. The reason string
                // is keyed to the FarmId so investigators can correlate
                // the opening with downstream tenant-scoped audit writes
                // emitted by EvaluateComplianceHandler itself.
                //
                // The returned context is disposed immediately — the
                // resolved EvaluateComplianceHandler operates on the
                // SCOPED ShramSafalDbContext + IShramSafalRepository
                // chain (interceptor-attached), which still needs
                // TenantContext elevation to skip the fail-closed GUC-
                // injection prelude. A future hardening can downgrade to
                // SetTenant(farmId, ownerAccountId) once a per-farm owner
                // lookup is wired here.
                var adminFactory = scope.ServiceProvider
                    .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
                await using (await adminFactory.CreateAsync(
                    reason: $"{nameof(ComplianceEvaluatorSweeper)}.evaluate.{farmId:N}",
                    actorUserId: SystemActor.Worker,
                    ct: ct))
                {
                    // Audit row committed; primary context disposed.
                }
                scope.ServiceProvider
                    .GetRequiredService<TenantContext>()
                    .ElevateToAdminCrossTenant();
                var handler = scope.ServiceProvider.GetRequiredService<IHandler<EvaluateComplianceCommand, EvaluateComplianceResult>>();

                // DATA_PRINCIPLE_SPINE sub-phase 04.3b §Part 2 — cron path
                // has no HttpContext, so we explicitly construct the command
                // with AuditContextAccessor.WorkerClaims() ("worker",
                // "sha256:worker") plus the entry assembly's
                // AppVersionProvider.Current. Every AuditEvent row emitted
                // by the handler inherits this forensic-provenance trio.
                var (deviceId, ipHash) = AuditContextAccessor.WorkerClaims();
                var result = await handler.HandleAsync(
                    new EvaluateComplianceCommand(
                        FarmId: new FarmId(farmId),
                        ClientAppVersion: AppVersionProvider.Current,
                        AuditDeviceId: deviceId,
                        AuditIpHash: ipHash),
                    ct);

                if (result.IsSuccess && result.Value is not null)
                {
                    totalOpened += result.Value.Opened;
                    totalRefreshed += result.Value.Refreshed;
                    totalAutoResolved += result.Value.AutoResolved;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "ComplianceEvaluatorSweeper failed for farm {FarmId}.", farmId);
            }
        }

        logger.LogInformation(
            "ComplianceEvaluatorSweeper completed. Opened: {Opened}, Refreshed: {Refreshed}, AutoResolved: {AutoResolved}.",
            totalOpened, totalRefreshed, totalAutoResolved);
    }
}
