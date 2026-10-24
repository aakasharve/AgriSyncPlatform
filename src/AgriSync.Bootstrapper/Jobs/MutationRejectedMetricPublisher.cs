using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Observability;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Serilog.Context;

namespace AgriSync.Bootstrapper.Jobs
{
    /// <summary>
    /// Ships the sync-rejection signal to CloudWatch on a fixed interval.
    ///
    /// <para>
    /// <b>What it measures (founder ruling 2026-09-05, deliberately narrow):</b>
    /// "ShramSafal tried to save a farmer action and the system rejected it."
    /// This is the failure that hurts a farmer most — <i>I did the work, but
    /// ShramSafal couldn't save it</i> — and it is invisible to <c>/health</c>,
    /// because <c>/sync/push</c> answers HTTP 200 whether or not the mutations
    /// inside it were applied. A release can therefore look perfectly healthy
    /// while attendance, work logs and corrections are all being refused.
    /// </para>
    ///
    /// <para>
    /// It is NOT a general application-error metric and must not be described as
    /// one. Authentication, reads, AI calls, page loads and background work can
    /// all break without touching this counter.
    /// </para>
    ///
    /// <para>
    /// <b>The interval publish is the point, not an implementation detail.</b>
    /// The aggregate is emitted every tick even when nothing was rejected, so a
    /// quiet window is an observed <c>0</c> and a dead publisher is an absent
    /// metric. Making the publish conditional on there being something to report
    /// would recreate exactly the defect this exists to remove.
    /// </para>
    ///
    /// <para>
    /// Follows the <see cref="PartitionMaintenanceJob"/> shape: a
    /// <see cref="BackgroundService"/> that never lets its own failure reach
    /// request-serving traffic.
    /// </para>
    /// </summary>
    public sealed class MutationRejectedMetricPublisher : BackgroundService
    {
        /// <summary>
        /// One minute — matching CloudWatch's finest standard resolution, so a
        /// deploy gate comparing a 60-second window has a datapoint to read.
        /// </summary>
        public static readonly TimeSpan PublishInterval = TimeSpan.FromMinutes(1);

        private readonly MutationRejectedMetricCollector _collector;
        private readonly IMetricSink _sink;
        private readonly ILogger<MutationRejectedMetricPublisher> _logger;

        public MutationRejectedMetricPublisher(
            MutationRejectedMetricCollector collector,
            IMetricSink sink,
            ILogger<MutationRejectedMetricPublisher> logger)
        {
            _collector = collector;
            _sink = sink;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using (LogContext.PushProperty("Job", nameof(MutationRejectedMetricPublisher)))
            {
                _logger.LogInformation(
                    "MutationRejectedMetricPublisher starting; publishing {Namespace}/{Metric} every {Seconds}s "
                    + "including zero-value heartbeats so absent data stays distinguishable from observed zero.",
                    MutationRejectedMetricCollector.Namespace,
                    MutationRejectedMetricCollector.MutationRejectedMetricName,
                    PublishInterval.TotalSeconds);

                using var timer = new PeriodicTimer(PublishInterval);

                while (!stoppingToken.IsCancellationRequested)
                {
                    try
                    {
                        if (!await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
                        {
                            break;
                        }

                        await PublishOnceAsync(stoppingToken).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        break;
                    }
                    catch (Exception ex)
                    {
                        // Telemetry must never take down the API. The interval is
                        // lost, which shows up honestly as a gap in the metric
                        // (NO_DATA) rather than as a reassuring zero.
                        _logger.LogError(
                            ex,
                            "MutationRejectedMetricPublisher failed to publish; this interval is lost. "
                            + "The metric will read as absent for the window, NOT as zero.");
                    }
                }

                // Final drain so a graceful shutdown does not silently discard
                // rejections recorded since the last tick.
                try
                {
                    await PublishOnceAsync(CancellationToken.None).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "MutationRejectedMetricPublisher final drain failed on shutdown.");
                }

                _logger.LogInformation("MutationRejectedMetricPublisher stopping.");
            }
        }

        /// <summary>
        /// Drains and publishes one interval immediately. Public so the
        /// heartbeat contract can be asserted without waiting a real minute
        /// or reaching AWS; also used for the final drain on shutdown.
        /// </summary>
        public async Task PublishOnceAsync(CancellationToken ct)
        {
            var points = _collector.Drain();
            await _sink.PutAsync(MutationRejectedMetricCollector.Namespace, points, ct).ConfigureAwait(false);
        }
    }
}
