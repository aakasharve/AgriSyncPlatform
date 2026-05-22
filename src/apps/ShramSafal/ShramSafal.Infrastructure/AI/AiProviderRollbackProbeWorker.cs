using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — background timer
/// (default 5-minute tick) that scans every <see cref="AiCircuitBreakerRegistry"/>
/// rolling-window tracker and emits a structured log / alert when the
/// observed fail-rate has stayed above 5% across the trailing 24h window.
///
/// <para>
/// <b>Why a probe and not a push.</b> The orchestrator already records
/// success/failure on every attempt. A probe pulls the snapshot at a
/// fixed cadence so:
/// <list type="bullet">
///   <item>the log volume is bounded (5-min cadence × N tuples, not
///   per-attempt)</item>
///   <item>the alert is emitted on a stable cycle even when no traffic
///   arrives (the founder can spot a silent-failure provider even when
///   the operation is rarely exercised)</item>
///   <item>the cost of the snapshot read (one lock per bucket × 1440
///   buckets per tuple) is paid on a predictable cadence rather than
///   on the request path</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Page-founder mechanism.</b> The envelope authorizes "structured
/// log at LogCritical level — ops dashboards consume the log". No
/// existing INotificationService surface to hook into; the LogCritical
/// emission carries the structured payload
/// (<c>provider</c>, <c>operation</c>, <c>fail_rate_pct</c>,
/// <c>window_start</c>, <c>window_end</c>) so the existing log
/// aggregator can fan it out to PagerDuty / Slack / email through its
/// own routing rules. Auto-flip of the provider is INTENTIONALLY
/// DEFERRED — the founder decides via the runbook.
/// </para>
///
/// <para>
/// <b>Enable gate.</b> Disabled by default via
/// <c>Ai:CircuitBreakerProbe:Enabled = false</c>; the worker still
/// starts as a hosted service but <see cref="ExecuteAsync"/> exits
/// immediately when the flag is off. Production opts in via env var
/// after the Phase 2 baseline ships.
/// </para>
/// </summary>
internal sealed class AiProviderRollbackProbeWorker(
    AiCircuitBreakerRegistry registry,
    AiProviderRollbackProbeOptions options,
    ILogger<AiProviderRollbackProbeWorker> logger,
    TimeProvider? timeProvider = null) : BackgroundService
{
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            logger.LogInformation(
                "AiProviderRollbackProbeWorker disabled by configuration (Ai:CircuitBreakerProbe:Enabled = false). Exiting.");
            return;
        }

        var interval = TimeSpan.FromMinutes(Math.Max(1, options.TickIntervalMinutes));
        logger.LogInformation(
            "AiProviderRollbackProbeWorker started. TickIntervalMinutes={Interval} FailRateThresholdPct={ThresholdPct} MinObservations={MinObs}.",
            interval.TotalMinutes,
            AiProviderRollingWindowStats.FailRateThreshold * 100d,
            AiProviderRollingWindowStats.MinObservationsForRollback);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(interval, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                ProbeOnce();
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "AiProviderRollbackProbeWorker tick failed. Continuing.");
            }
        }

        logger.LogInformation("AiProviderRollbackProbeWorker stopped.");
    }

    /// <summary>
    /// One scan over every (provider × operation) tuple registered on
    /// the breaker registry. <c>internal</c> so the unit test can drive
    /// the probe synchronously without a real timer.
    /// </summary>
    internal void ProbeOnce()
    {
        foreach (var (provider, operation) in registry.EnumerateTrackedTuples())
        {
            if (!registry.ShouldRollback(provider, operation, out var snapshot))
            {
                continue;
            }

            // ProviderShouldRollback alert — log at LogCritical so the
            // ops aggregator routes it to the on-call founder per
            // runbook (envelope §Task 2.6). Includes all five structured
            // fields the envelope specifies.
            logger.LogCritical(
                "[provider-should-rollback] provider={Provider} operation={Operation} fail_rate_pct={FailRatePct:F2} window_start={WindowStartUtc:O} window_end={WindowEndUtc:O} success_count={SuccessCount} failure_count={FailureCount}",
                provider,
                operation,
                snapshot.FailRatePercent,
                snapshot.WindowStartUtc,
                snapshot.WindowEndUtc,
                snapshot.SuccessCount,
                snapshot.FailureCount);
        }
    }
}

/// <summary>
/// Configuration for <see cref="AiProviderRollbackProbeWorker"/>. Bound
/// from the <c>Ai:CircuitBreakerProbe</c> appsettings section.
/// </summary>
public sealed class AiProviderRollbackProbeOptions
{
    public const string SectionName = "Ai:CircuitBreakerProbe";

    /// <summary>
    /// Master kill-switch. Default <c>false</c> so the worker no-ops
    /// in every environment that does not explicitly opt in.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Probe cadence in minutes. Default <c>5</c>. Clamped to a minimum
    /// of 1 minute at runtime.
    /// </summary>
    public int TickIntervalMinutes { get; set; } = 5;
}
