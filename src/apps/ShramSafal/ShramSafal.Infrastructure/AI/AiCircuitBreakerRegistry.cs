using System.Collections.Concurrent;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiCircuitBreakerRegistry
{
    private readonly ConcurrentDictionary<AiProviderType, CircuitBreaker> _breakers = new();

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
}
