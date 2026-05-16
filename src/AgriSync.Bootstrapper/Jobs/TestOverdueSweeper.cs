using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// CEI §4.5 — sweeps <c>TestInstance</c> rows that passed their
/// <c>PlannedDueDate</c> without being collected and transitions them from
/// <c>Due</c> → <c>Overdue</c>. Runs once per day at 02:00 UTC.
/// </summary>
public sealed class TestOverdueSweeper(
    IServiceScopeFactory scopeFactory,
    ILogger<TestOverdueSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("TestOverdueSweeper started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPassAsync(stoppingToken);

            var now = DateTime.UtcNow;
            var nextRun = now.Date.AddDays(1).AddHours(2); // 02:00 UTC next day
            var delay = nextRun - now;
            if (delay <= TimeSpan.Zero) delay = TimeSpan.FromHours(24);

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("TestOverdueSweeper stopping.");
    }

    private async Task RunPassAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — the overdue
        // sweep transitions TestInstance rows across every farm; cross-
        // tenant by definition. The admin factory writes an
        // AuditEvent("admin_cross_tenant","open") row with farm_id=NULL
        // BEFORE returning the privileged context, so every nightly pass
        // leaves a forensic breadcrumb on ssf.audit_events that names
        // this sweeper as the opener.
        //
        // We dispose the returned context immediately — the resolved
        // MarkOverdueInstancesHandler operates on the SCOPED
        // ShramSafalDbContext + IShramSafalRepository chain (interceptor-
        // attached), which still needs TenantContext elevation to skip
        // the fail-closed GUC-injection prelude. Holding both calls keeps
        // the audit trail honest while preserving the handler's existing
        // wiring.
        var adminFactory = scope.ServiceProvider
            .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        await using (await adminFactory.CreateAsync(
            reason: nameof(TestOverdueSweeper),
            actorUserId: SystemActor.Worker,
            ct: ct))
        {
            // Audit row committed; primary context disposed.
        }
        scope.ServiceProvider
            .GetRequiredService<TenantContext>()
            .ElevateToAdminCrossTenant();
        var handler = scope.ServiceProvider.GetRequiredService<IHandler<MarkOverdueInstancesCommand, int>>();

        try
        {
            // DATA_PRINCIPLE_SPINE sub-phase 04.3b §Part 2 — cron path has
            // no HttpContext, so we explicitly construct the command with
            // AuditContextAccessor.WorkerClaims() ("worker", "sha256:worker")
            // plus the entry assembly's AppVersionProvider.Current. Every
            // AuditEvent row emitted by the handler inherits this trio.
            var (deviceId, ipHash) = AuditContextAccessor.WorkerClaims();
            var result = await handler.HandleAsync(
                new MarkOverdueInstancesCommand(
                    ClientAppVersion: AppVersionProvider.Current,
                    AuditDeviceId: deviceId,
                    AuditIpHash: ipHash),
                ct);
            if (!result.IsSuccess)
            {
                logger.LogWarning(
                    "TestOverdueSweeper returned failure {ErrorCode}: {Description}.",
                    result.Error.Code,
                    result.Error.Description);
                return;
            }

            var marked = result.Value;
            if (marked > 0)
            {
                logger.LogInformation(
                    "TestOverdueSweeper marked {Count} test instances as Overdue.",
                    marked);
            }
            else
            {
                logger.LogDebug("TestOverdueSweeper: no instances to transition.");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "TestOverdueSweeper pass failed.");
        }
    }
}
