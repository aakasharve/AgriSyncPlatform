using AgriSync.BuildingBlocks.Analytics;

namespace ShramSafal.Domain.Tests.Analytics;

/// <summary>
/// In-memory <see cref="IAnalyticsWriter"/> used by handler-instrumentation
/// tests (MIS Integration Phase 2 Batch B). Captures every emitted event so
/// assertions can inspect props and ordering.
/// </summary>
internal sealed class CapturingAnalyticsWriter : IAnalyticsWriter
{
    public List<AnalyticsEvent> Events { get; } = new();

    public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
    {
        Events.Add(analyticsEvent);
        return Task.CompletedTask;
    }

    public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
    {
        Events.AddRange(events);
        return Task.CompletedTask;
    }
}
