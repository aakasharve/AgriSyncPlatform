using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — rolling 24h
/// failure-rate probe on <see cref="AiCircuitBreakerRegistry"/>. The two
/// envelope acceptance cases are exercised here:
///
/// <list type="bullet">
///   <item>95 successes + 6 failures = 5.94% fail-rate → above threshold,
///   <c>ShouldRollback</c> returns true.</item>
///   <item>95 successes + 4 failures = 4.04% fail-rate → below threshold,
///   <c>ShouldRollback</c> returns false.</item>
/// </list>
///
/// Both cases also assert the supporting invariants: the snapshot
/// numbers match what was recorded, the per-tuple isolation holds
/// (no cross-talk between Sarvam and Gemini), and the
/// <see cref="AiProviderRollbackProbeWorker"/> emits a LogCritical when
/// the threshold trips.
/// </summary>
public sealed class AiCircuitBreakerRegistryRollbackTests
{
    [Fact]
    public void ShouldRollback_returns_true_when_95_success_6_failure_5point94_pct()
    {
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);

        for (var i = 0; i < 95; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 6; i++)
        {
            registry.RecordWindowFailure(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }

        var triggered = registry.ShouldRollback(
            AiProviderType.Sarvam,
            AiOperationType.VoiceToStructuredLog,
            out var snapshot);

        Assert.True(triggered, $"Expected rollback signal at 5.94% but got fail_rate_pct={snapshot.FailRatePercent:F2}.");
        Assert.Equal(95, snapshot.SuccessCount);
        Assert.Equal(6, snapshot.FailureCount);
        Assert.Equal(101, snapshot.TotalCount);
        Assert.True(snapshot.FailRatePercent > 5.0, $"Expected >5% fail rate, got {snapshot.FailRatePercent:F2}%.");
    }

    [Fact]
    public void ShouldRollback_returns_false_when_95_success_4_failure_4point04_pct()
    {
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);

        for (var i = 0; i < 95; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 4; i++)
        {
            registry.RecordWindowFailure(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }

        var triggered = registry.ShouldRollback(
            AiProviderType.Sarvam,
            AiOperationType.VoiceToStructuredLog,
            out var snapshot);

        Assert.False(triggered, $"Expected no rollback signal at 4.04% but got triggered=true. fail_rate_pct={snapshot.FailRatePercent:F2}.");
        Assert.Equal(95, snapshot.SuccessCount);
        Assert.Equal(4, snapshot.FailureCount);
        Assert.True(snapshot.FailRatePercent < 5.0, $"Expected <5% fail rate, got {snapshot.FailRatePercent:F2}%.");
    }

    [Fact]
    public void ShouldRollback_returns_false_when_window_under_minimum_observations()
    {
        // Sparse window — only 10 observations even though 20% are failures.
        // Per the envelope's "sustained" gate, the probe must not trip on a
        // window too thin to draw a conclusion. MinObservationsForRollback
        // (=50) is the safety floor.
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);

        for (var i = 0; i < 8; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 2; i++)
        {
            registry.RecordWindowFailure(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }

        var triggered = registry.ShouldRollback(
            AiProviderType.Sarvam,
            AiOperationType.VoiceToStructuredLog,
            out var snapshot);

        Assert.False(triggered);
        Assert.Equal(10, snapshot.TotalCount);
    }

    [Fact]
    public void ShouldRollback_isolates_tuples_no_crosstalk_across_providers()
    {
        // Sarvam goes bad (20% fail) but Gemini stays healthy (0% fail);
        // the probe MUST fire ONLY on the Sarvam tuple.
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);

        for (var i = 0; i < 100; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Gemini, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 80; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 20; i++)
        {
            registry.RecordWindowFailure(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }

        var sarvamRollback = registry.ShouldRollback(
            AiProviderType.Sarvam,
            AiOperationType.VoiceToStructuredLog,
            out var sarvamSnapshot);
        var geminiRollback = registry.ShouldRollback(
            AiProviderType.Gemini,
            AiOperationType.VoiceToStructuredLog,
            out var geminiSnapshot);

        Assert.True(sarvamRollback);
        Assert.False(geminiRollback);
        Assert.Equal(0, geminiSnapshot.FailureCount);
        Assert.Equal(20, sarvamSnapshot.FailureCount);
    }

    [Fact]
    public void ShouldRollback_returns_false_when_no_observations_yet()
    {
        // Calling ShouldRollback on a tuple that has never had a
        // recording must NOT crash and MUST return false.
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);

        var triggered = registry.ShouldRollback(
            AiProviderType.Sarvam,
            AiOperationType.VoiceToStructuredLog,
            out var snapshot);

        Assert.False(triggered);
        Assert.Equal(0, snapshot.TotalCount);
    }

    [Fact]
    public void ProbeWorker_ProbeOnce_emits_critical_log_when_rollback_signal_fires()
    {
        // End-to-end probe sweep: load Sarvam past the 5%-of-101 threshold,
        // then drive the worker's ProbeOnce() and assert the structured
        // critical log fired exactly once with the expected provider /
        // operation / fail-rate fields.
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);
        for (var i = 0; i < 95; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 6; i++)
        {
            registry.RecordWindowFailure(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }

        var capturingLogger = new ListLogger<AiProviderRollbackProbeWorker>();
        var worker = new AiProviderRollbackProbeWorker(
            registry,
            new AiProviderRollbackProbeOptions { Enabled = true, TickIntervalMinutes = 5 },
            capturingLogger,
            clock);

        worker.ProbeOnce();

        var critical = capturingLogger.Entries
            .Where(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Critical)
            .ToList();
        Assert.Single(critical);
        Assert.Contains("provider-should-rollback", critical[0].Message);
        Assert.Contains("Sarvam", critical[0].Message);
        Assert.Contains("VoiceToStructuredLog", critical[0].Message);
    }

    [Fact]
    public void ProbeWorker_ProbeOnce_emits_nothing_when_no_tuple_trips_threshold()
    {
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-05-22T12:00:00Z"));
        var registry = new AiCircuitBreakerRegistry(clock);
        for (var i = 0; i < 95; i++)
        {
            registry.RecordWindowSuccess(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }
        for (var i = 0; i < 4; i++)
        {
            registry.RecordWindowFailure(AiProviderType.Sarvam, AiOperationType.VoiceToStructuredLog);
        }

        var capturingLogger = new ListLogger<AiProviderRollbackProbeWorker>();
        var worker = new AiProviderRollbackProbeWorker(
            registry,
            new AiProviderRollbackProbeOptions { Enabled = true, TickIntervalMinutes = 5 },
            capturingLogger,
            clock);

        worker.ProbeOnce();

        Assert.DoesNotContain(
            capturingLogger.Entries,
            e => e.Level == Microsoft.Extensions.Logging.LogLevel.Critical);
    }

    /// <summary>
    /// Minimal fixed-time TimeProvider for deterministic windowing tests.
    /// Avoids pulling Microsoft.Extensions.TimeProvider.Testing for one
    /// surface; the AiProviderRollingWindowStats class only depends on
    /// GetUtcNow().
    /// </summary>
    private sealed class FixedTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _utcNow;
        public FixedTimeProvider(DateTimeOffset utcNow) { _utcNow = utcNow; }
        public override DateTimeOffset GetUtcNow() => _utcNow;
    }

    /// <summary>
    /// Minimal in-memory <see cref="Microsoft.Extensions.Logging.ILogger{T}"/>
    /// that captures the formatted message + level so the test can assert
    /// the LogCritical structured emission. Avoids pulling a mock library
    /// for one test surface.
    /// </summary>
    private sealed class ListLogger<T> : Microsoft.Extensions.Logging.ILogger<T>
    {
        public List<(Microsoft.Extensions.Logging.LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullDisposable.Instance;

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

        public void Log<TState>(
            Microsoft.Extensions.Logging.LogLevel logLevel,
            Microsoft.Extensions.Logging.EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            Entries.Add((logLevel, formatter(state, exception)));
        }

        private sealed class NullDisposable : IDisposable
        {
            public static readonly NullDisposable Instance = new();
            public void Dispose() { }
        }
    }
}
