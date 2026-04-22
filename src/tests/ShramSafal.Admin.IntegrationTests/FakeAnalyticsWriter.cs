using System.Collections.Concurrent;
using AgriSync.BuildingBlocks.Analytics;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// Test-only IAnalyticsWriter that records emissions in memory instead of
/// writing to analytics.events. Lets tests assert on the observability
/// contract (what event type fires, what props it carries) without spinning
/// up the production analytics pipeline.
/// </summary>
public sealed class FakeAnalyticsWriter : IAnalyticsWriter
{
    private readonly ConcurrentQueue<AnalyticsEvent> _events = new();

    public IReadOnlyList<AnalyticsEvent> Events => _events.ToArray();

    public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
    {
        _events.Enqueue(analyticsEvent);
        return Task.CompletedTask;
    }

    public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
    {
        foreach (var e in events) _events.Enqueue(e);
        return Task.CompletedTask;
    }

    public void Clear()
    {
        while (_events.TryDequeue(out _)) { }
    }
}
