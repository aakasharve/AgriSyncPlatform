using System.Collections.Concurrent;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiCircuitBreakerRegistry
{
    private readonly ConcurrentDictionary<AiProviderType, CircuitBreaker> _breakers = new();

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — per-(provider × operation)
    // rolling 24h failure-rate trackers. Lives alongside the existing
    // CircuitBreaker (consecutive-failure threshold) because the two
    // signals answer different questions: the breaker fast-fails new
    // calls in the seconds after a burst of failures; the rolling window
    // surfaces the slow-cook regression that stays at 5% sustained for
    // a day. Both must be true for a real provider rollback decision.
    private readonly ConcurrentDictionary<(AiProviderType Provider, AiOperationType Operation), AiProviderRollingWindowStats> _windowStats = new();

    private readonly TimeProvider _timeProvider;

    public AiCircuitBreakerRegistry()
        : this(TimeProvider.System)
    {
    }

    public AiCircuitBreakerRegistry(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public CircuitBreaker GetOrAdd(
        AiProviderType providerType,
        int threshold,
        TimeSpan resetInterval)
    {
        var normalizedThreshold = Math.Max(1, threshold);
        var normalizedResetInterval = resetInterval <= TimeSpan.Zero ? TimeSpan.FromSeconds(60) : resetInterval;

        return _breakers.AddOrUpdate(
            providerType,
            _ => new CircuitBreaker(normalizedThreshold, normalizedResetInterval),
            (_, existing) =>
                existing.Threshold == normalizedThreshold &&
                existing.ResetInterval == normalizedResetInterval
                    ? existing
                    : new CircuitBreaker(normalizedThreshold, normalizedResetInterval));
    }

    public CircuitBreaker GetOrAdd(
        AiProviderType providerType,
        Func<AiProviderType, CircuitBreaker> factory)
    {
        return _breakers.GetOrAdd(providerType, factory);
    }

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — record a
    /// success on the rolling 24h window for (<paramref name="providerType"/>,
    /// <paramref name="operation"/>). Lazily creates the tracker on the
    /// first observation. Idempotent for concurrent callers.
    /// </summary>
    public void RecordWindowSuccess(AiProviderType providerType, AiOperationType operation)
    {
        GetOrCreateWindowStats(providerType, operation).RecordSuccess();
    }

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — record a
    /// failure on the rolling 24h window for (<paramref name="providerType"/>,
    /// <paramref name="operation"/>). Lazily creates the tracker on the
    /// first observation. Idempotent for concurrent callers.
    /// </summary>
    public void RecordWindowFailure(AiProviderType providerType, AiOperationType operation)
    {
        GetOrCreateWindowStats(providerType, operation).RecordFailure();
    }

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — query the
    /// rolling 24h window for (<paramref name="providerType"/>,
    /// <paramref name="operation"/>). Returns <c>true</c> when the
    /// observed fail-rate exceeds <see cref="AiProviderRollingWindowStats.FailRateThreshold"/>
    /// AND the window has at least
    /// <see cref="AiProviderRollingWindowStats.MinObservationsForRollback"/>
    /// total observations. <paramref name="snapshot"/> always carries
    /// the current numbers — even when the function returns false — so
    /// callers can log diagnostic context.
    /// </summary>
    public bool ShouldRollback(
        AiProviderType providerType,
        AiOperationType operation,
        out WindowSnapshot snapshot)
    {
        if (!_windowStats.TryGetValue((providerType, operation), out var stats))
        {
            // No observations recorded yet → no rollback signal.
            snapshot = new WindowSnapshot(
                SuccessCount: 0,
                FailureCount: 0,
                WindowStartUtc: _timeProvider.GetUtcNow().UtcDateTime.AddMinutes(-AiProviderRollingWindowStats.WindowMinutes),
                WindowEndUtc: _timeProvider.GetUtcNow().UtcDateTime);
            return false;
        }

        return stats.ShouldRollback(out snapshot);
    }

    /// <summary>
    /// Enumerates every (provider × operation) tracker currently
    /// registered. Used by <see cref="AiProviderRollbackProbeWorker"/>
    /// for the 5-minute periodic scan.
    /// </summary>
    public IEnumerable<(AiProviderType Provider, AiOperationType Operation)> EnumerateTrackedTuples()
    {
        return _windowStats.Keys.ToArray();
    }

    private AiProviderRollingWindowStats GetOrCreateWindowStats(
        AiProviderType providerType,
        AiOperationType operation)
    {
        return _windowStats.GetOrAdd(
            (providerType, operation),
            _ => new AiProviderRollingWindowStats(_timeProvider));
    }
}
