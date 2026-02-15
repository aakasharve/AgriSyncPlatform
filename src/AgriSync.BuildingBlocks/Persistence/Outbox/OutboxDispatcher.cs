using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

public sealed class OutboxDispatcher(
    IServiceScopeFactory scopeFactory,
    ILogger<OutboxDispatcher> logger,
    TimeProvider timeProvider) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<OutboxDbContext>();
                var publisher = scope.ServiceProvider.GetRequiredService<IOutboxPublisher>();

                var pendingMessages = await dbContext.OutboxMessages
                    .Where(message => message.ProcessedOnUtc == null)
                    .OrderBy(message => message.OccurredOnUtc)
                    .Take(50)
                    .ToListAsync(stoppingToken);

                foreach (var message in pendingMessages)
                {
                    try
                    {
                        await publisher.PublishAsync(message, stoppingToken);
                        message.MarkProcessed(timeProvider.GetUtcNow().UtcDateTime);
                    }
                    catch (Exception ex)
                    {
                        message.MarkFailed(ex.Message);
                        logger.LogWarning(ex, "Outbox message {OutboxMessageId} failed to publish.", message.Id);
                    }
                }

                await dbContext.SaveChangesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Outbox dispatcher cycle failed.");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
