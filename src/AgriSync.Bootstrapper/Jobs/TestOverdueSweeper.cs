using AgriSync.BuildingBlocks.Application;
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
        var handler = scope.ServiceProvider.GetRequiredService<IHandler<MarkOverdueInstancesCommand, int>>();

        try
        {
            var result = await handler.HandleAsync(new MarkOverdueInstancesCommand(), ct);
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
