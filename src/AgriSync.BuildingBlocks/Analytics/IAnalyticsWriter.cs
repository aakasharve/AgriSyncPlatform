namespace AgriSync.BuildingBlocks.Analytics;

public interface IAnalyticsWriter
{
    Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default);

    Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default);
}
