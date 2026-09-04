using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics.Metrics;
using System.Linq;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;

namespace AgriSync.Bootstrapper.Observability
{
    /// <summary>
    /// Aggregates the sync-rejection counters into CloudWatch-shaped datapoints.
    ///
    /// <para>
    /// <b>Why this exists.</b> <see cref="SyncPushMetrics"/> has emitted
    /// <c>mutation_rejected</c> since RG5, but nothing ever carried it off the
    /// box: verified 2026-09-04, there is no <c>PutMetricData</c> anywhere in
    /// <c>src/</c> and no CloudWatch Logs sink. So the deploy gate's error-rate
    /// check queried a metric that had never existed, got an empty set back, and
    /// scored it GREEN. Every Heavy deploy that recorded a green error axis
    /// proved less than its chart claimed.
    /// </para>
    ///
    /// <para>
    /// <b>What this measures, stated narrowly (founder ruling 2026-09-05).</b>
    /// "ShramSafal tried to save a farmer action and the system rejected it."
    /// It is a WRITE-PATH health signal, deliberately NOT renamed to something
    /// generic like <c>ApplicationErrors</c> or <c>5xxErrors</c>, because it does
    /// not measure those. A release can break authentication, reads, AI calls,
    /// page loads or background work without ever incrementing this. The HTTP
    /// smoke probes and <c>/health</c> keep covering those boundaries.
    /// </para>
    ///
    /// <para>
    /// <b>The load-bearing design choice: NO_DATA must never look like zero.</b>
    /// CloudWatch only knows a metric exists once something publishes it, so a
    /// quiet hour and a broken publisher are indistinguishable — which is exactly
    /// the defect this work exists to fix. The aggregate datapoint is therefore
    /// published on EVERY interval whether or not anything was rejected. A
    /// legitimate quiet window reads as an observed <c>0</c>; a publisher that
    /// has died reads as absent, i.e. <c>NO_DATA</c>. Those two are structurally
    /// distinguishable, and the deploy gate treats them differently.
    /// </para>
    ///
    /// <para>
    /// <b>Cardinality.</b> Dimensions are limited to stable categories:
    /// <c>Environment</c>, <c>MutationType</c> (bounded by
    /// <c>SyncMutationCatalog</c>; anything unknown already collapses to a single
    /// bucket upstream) and <c>ErrorCode</c> (a closed, developer-authored
    /// vocabulary). Farm id, actor id, worker id, device id, phone, client
    /// request id and exception text are NEVER dimensions — they belong in logs
    /// and traces. The metric says <i>something failed</i>, never <i>whose data
    /// failed</i>.
    /// </para>
    /// </summary>
    public sealed class MutationRejectedMetricCollector : IDisposable
    {
        /// <summary>CloudWatch namespace. Real, and published to — unlike the
        /// <c>AgriSync/Api</c> the spike-check skill documented, which never existed.</summary>
        public const string Namespace = "ShramSafal/Api";

        /// <summary>The farmer-facing write-failure signal.</summary>
        public const string MutationRejectedMetricName = "MutationRejected";

        /// <summary>
        /// Failures of the rejection-observability emit itself. Published
        /// alongside deliberately: a broken observer otherwise looks exactly like
        /// a healthy system, which is the same lie this whole change removes.
        /// </summary>
        public const string ObservabilityEmitFailedMetricName = "ObservabilityEmitFailed";

        private const string UnknownDimensionValue = "unknown";

        private readonly string _environment;
        private readonly MeterListener _listener;

        // (mutationType, errorCode) -> count accumulated since the last drain.
        private readonly ConcurrentDictionary<(string MutationType, string ErrorCode), long> _rejections = new();
        private long _observabilityEmitFailures;

        public MutationRejectedMetricCollector(string environment)
        {
            _environment = string.IsNullOrWhiteSpace(environment) ? UnknownDimensionValue : environment;

            _listener = new MeterListener
            {
                InstrumentPublished = (instrument, listener) =>
                {
                    if (instrument.Meter.Name == SyncPushMetrics.MeterName)
                    {
                        listener.EnableMeasurementEvents(instrument);
                    }
                }
            };

            _listener.SetMeasurementEventCallback<long>(OnMeasurement);
            _listener.Start();
        }

        private void OnMeasurement(
            Instrument instrument,
            long measurement,
            ReadOnlySpan<KeyValuePair<string, object?>> tags,
            object? state)
        {
            if (instrument.Name == SyncPushMetrics.ObservabilityEmitFailedInstrumentName)
            {
                System.Threading.Interlocked.Add(ref _observabilityEmitFailures, measurement);
                return;
            }

            if (instrument.Name != SyncPushMetrics.MutationRejectedInstrumentName)
            {
                return;
            }

            var mutationType = UnknownDimensionValue;
            var errorCode = UnknownDimensionValue;
            foreach (var tag in tags)
            {
                if (tag.Key == "mutation_type")
                {
                    mutationType = tag.Value?.ToString() ?? UnknownDimensionValue;
                }
                else if (tag.Key == "error_code")
                {
                    errorCode = tag.Value?.ToString() ?? UnknownDimensionValue;
                }
            }

            _rejections.AddOrUpdate((mutationType, errorCode), measurement, (_, existing) => existing + measurement);
        }

        /// <summary>
        /// Takes everything accumulated since the last call and shapes it into
        /// datapoints. Resets the accumulators, so a dropped publish loses one
        /// interval rather than double-counting the next.
        ///
        /// <para>
        /// The FIRST datapoint is always the environment-only aggregate, present
        /// even when the value is zero. That is the heartbeat that keeps
        /// "observed zero" distinguishable from "not publishing".
        /// </para>
        /// </summary>
        public IReadOnlyList<MetricDatapoint> Drain()
        {
            var snapshot = _rejections.ToArray();
            foreach (var entry in snapshot)
            {
                _rejections.TryRemove(new KeyValuePair<(string, string), long>(entry.Key, entry.Value));
            }

            var emitFailures = System.Threading.Interlocked.Exchange(ref _observabilityEmitFailures, 0);
            var total = snapshot.Sum(e => e.Value);

            var points = new List<MetricDatapoint>
            {
                // ALWAYS emitted. This is the heartbeat; do not make it conditional.
                new(
                    MutationRejectedMetricName,
                    total,
                    new[] { new KeyValuePair<string, string>("Environment", _environment) }),

                // Also always emitted: if the observer is breaking, the signal
                // above is under-counting and must not be read as good news.
                new(
                    ObservabilityEmitFailedMetricName,
                    emitFailures,
                    new[] { new KeyValuePair<string, string>("Environment", _environment) })
            };

            // Dimensioned breakdown for diagnosis — only when non-zero. Emitting
            // a zero for every possible (type, code) pair every minute would
            // multiply cost for no information.
            foreach (var entry in snapshot.Where(e => e.Value > 0))
            {
                points.Add(new MetricDatapoint(
                    MutationRejectedMetricName,
                    entry.Value,
                    new[]
                    {
                        new KeyValuePair<string, string>("Environment", _environment),
                        new KeyValuePair<string, string>("MutationType", entry.Key.MutationType),
                        new KeyValuePair<string, string>("ErrorCode", entry.Key.ErrorCode)
                    }));
            }

            return points;
        }

        public void Dispose() => _listener.Dispose();
    }

    /// <summary>One CloudWatch datapoint. Deliberately AWS-type-free so the
    /// aggregation logic is testable without touching the SDK.</summary>
    public sealed record MetricDatapoint(
        string MetricName,
        double Value,
        IReadOnlyList<KeyValuePair<string, string>> Dimensions);
}
