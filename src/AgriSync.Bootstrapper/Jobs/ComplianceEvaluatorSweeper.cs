using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;

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
                var handler = scope.ServiceProvider.GetRequiredService<IHandler<EvaluateComplianceCommand, EvaluateComplianceResult>>();
                var result = await handler.HandleAsync(
                    new EvaluateComplianceCommand(new FarmId(farmId)), ct);

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
