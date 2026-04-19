using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Analytics;

public sealed class AnalyticsWriter(
    AnalyticsDbContext dbContext,
    ILogger<AnalyticsWriter> logger) : IAnalyticsWriter
{
    public async Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
    {
        try
        {
            dbContext.Events.Add(analyticsEvent);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex,
                "AnalyticsWriter.EmitAsync swallowed failure for event {EventType} ({EventId}); telemetry write is non-blocking.",
                analyticsEvent.EventType,
                analyticsEvent.EventId);
        }
    }

    public async Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
    {
        try
        {
            await dbContext.Events.AddRangeAsync(events, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                ex,
                "AnalyticsWriter.EmitManyAsync swallowed failure; telemetry batch write is non-blocking.");
        }
    }
}
