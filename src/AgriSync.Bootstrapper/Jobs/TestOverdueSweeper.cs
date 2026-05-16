using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;

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
        // DATA_PRINCIPLE_SPINE 03.2 R6 mitigation — the overdue sweep
        // transitions TestInstance rows across every farm; cross-tenant
        // by definition. Elevate so the interceptor skips GUC injection.
        // TODO 03.5: elevate to admin scope via IAdminDbContextFactory.
        scope.ServiceProvider
            .GetRequiredService<AgriSync.BuildingBlocks.Persistence.TenantContext>()
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
