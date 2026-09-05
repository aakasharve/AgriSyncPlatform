using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Jobs;
using AgriSync.Bootstrapper.Observability;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Observability
{
    /// <summary>
    /// Pins the first application-level production metric.
    ///
    /// <para>
    /// <b>What it measures, narrowly (founder ruling 2026-09-05):</b> "ShramSafal
    /// tried to save a farmer action and the system rejected it." Not a generic
    /// application-error metric — a WRITE-PATH failure signal. It matters because
    /// <c>/sync/push</c> answers HTTP 200 whether or not the mutations inside it
    /// were applied, so a release can pass <c>/health</c> and <c>/version</c>
    /// while farmers cannot save attendance, work logs or corrections.
    /// </para>
    ///
    /// <para>
    /// One class on purpose: <c>SyncPushMetrics</c> exposes a static
    /// <c>Meter</c>, so collectors in separate classes running in parallel would
    /// observe each other's measurements. xUnit runs tests within a class
    /// serially, which keeps each collector's window clean.
    /// </para>
    /// </summary>
    public sealed class MutationRejectedMetricTests
    {
        private const string KnownMutationType = "daily_log";
        private const string KnownErrorCode = "ShramSafal.LabourAssignment.Conflict";

        private static MetricDatapoint Aggregate(IReadOnlyList<MetricDatapoint> points) =>
            points.Single(p =>
                p.MetricName == MutationRejectedMetricCollector.MutationRejectedMetricName
                && p.Dimensions.Count == 1);

        // ── DoD 4: the namespace and metric name are real, and pinned ─────────

        [Fact]
        public void Namespace_and_metric_name_are_the_real_ones()
        {
            // The deploy gate's spike-check documented `AgriSync/Api` / `5xxErrors`.
            // Neither ever existed in production, which is why an empty result set
            // scored GREEN. These constants are what actually gets published.
            MutationRejectedMetricCollector.Namespace.Should().Be("ShramSafal/Api");
            MutationRejectedMetricCollector.MutationRejectedMetricName.Should().Be("MutationRejected");

            MutationRejectedMetricCollector.MutationRejectedMetricName.Should().NotBe("ApplicationErrors");
            MutationRejectedMetricCollector.MutationRejectedMetricName.Should().NotBe("5xxErrors");
        }

        // ── DoD 5: observed zero must be distinguishable from not publishing ──

        [Fact]
        public void Drain_with_nothing_rejected_still_emits_the_aggregate_as_an_observed_zero()
        {
            using var collector = new MutationRejectedMetricCollector("Production");

            var points = collector.Drain();

            // THE LOAD-BEARING ASSERTION. CloudWatch only knows a metric exists
            // once something publishes it, so if we published only when there was
            // something to report, a quiet hour and a dead publisher would be
            // indistinguishable — the exact defect that let a never-published
            // metric score GREEN on every Heavy deploy.
            var aggregate = Aggregate(points);
            aggregate.Value.Should().Be(0);
            aggregate.Dimensions.Should().ContainSingle(d => d.Key == "Environment" && d.Value == "Production");
        }

        // ── DoD 1: one rejection emits exactly one ────────────────────────────

        [Fact]
        public void One_rejection_increments_the_aggregate_by_exactly_one()
        {
            using var collector = new MutationRejectedMetricCollector("Production");

            SyncPushMetrics.RecordMutationRejected(KnownMutationType, KnownErrorCode);

            Aggregate(collector.Drain()).Value.Should().Be(1);
        }

        // ── DoD 2: a successful mutation emits nothing ────────────────────────

        [Fact]
        public void A_successful_mutation_does_not_increment_the_signal()
        {
            using var collector = new MutationRejectedMetricCollector("Production");

            // A success never calls RecordMutationRejected — that is the whole
            // contract. Recording nothing must leave the aggregate at an observed
            // zero rather than at some non-zero background level.
            Aggregate(collector.Drain()).Value.Should().Be(0);
        }

        // ── DoD 3: dimensions stay low-cardinality and carry no farmer data ───

        [Fact]
        public void Dimensions_are_only_the_three_allowed_stable_categories()
        {
            using var collector = new MutationRejectedMetricCollector("Production");
            SyncPushMetrics.RecordMutationRejected(KnownMutationType, KnownErrorCode);

            var allowed = new[] { "Environment", "MutationType", "ErrorCode" };

            foreach (var point in collector.Drain())
            {
                point.Dimensions.Select(d => d.Key).Should().OnlyContain(k => allowed.Contains(k));
            }
        }

        [Fact]
        public void No_dimension_ever_carries_an_identifier_or_free_form_text()
        {
            using var collector = new MutationRejectedMetricCollector("Production");
            SyncPushMetrics.RecordMutationRejected(KnownMutationType, KnownErrorCode);

            // The metric must say "something failed", never "whose data failed".
            // These belong in logs and traces, where per-incident forensics lives
            // and where access is controlled — not in a metric dimension that is
            // retained, queryable, and multiplies cost with every distinct value.
            var forbidden = new[]
            {
                "FarmerId", "FarmId", "UserId", "ActorUserId", "WorkerId",
                "Phone", "PhoneNumber", "CorrelationId", "ClientRequestId",
                "DeviceId", "Message", "Exception", "StackTrace", "Payload"
            };

            foreach (var point in collector.Drain())
            {
                foreach (var dimension in point.Dimensions)
                {
                    forbidden.Should().NotContain(
                        dimension.Key,
                        "dimension '{0}' would put farmer-identifying or unbounded data into a metric",
                        dimension.Key);
                }
            }
        }

        // ── Breakdown behaviour ───────────────────────────────────────────────

        [Fact]
        public void Dimensioned_breakdown_is_emitted_only_when_non_zero()
        {
            using var quiet = new MutationRejectedMetricCollector("Production");
            quiet.Drain().Should().NotContain(
                p => p.Dimensions.Count > 1,
                "a zero for every possible (type, code) pair every minute would multiply cost for no information");

            using var busy = new MutationRejectedMetricCollector("Production");
            SyncPushMetrics.RecordMutationRejected(KnownMutationType, KnownErrorCode);

            var breakdown = busy.Drain().Single(p => p.Dimensions.Count > 1);
            breakdown.Value.Should().Be(1);
            breakdown.Dimensions.Should().Contain(d => d.Key == "MutationType" && d.Value == KnownMutationType);
            breakdown.Dimensions.Should().Contain(d => d.Key == "ErrorCode" && d.Value == KnownErrorCode);
        }

        [Fact]
        public void Drain_resets_so_a_quiet_interval_after_a_busy_one_reports_zero()
        {
            using var collector = new MutationRejectedMetricCollector("Production");

            SyncPushMetrics.RecordMutationRejected(KnownMutationType, KnownErrorCode);
            Aggregate(collector.Drain()).Value.Should().Be(1);

            // Without a reset the next window would re-report the same rejection
            // and a single failure would look like a sustained incident.
            Aggregate(collector.Drain()).Value.Should().Be(0);
        }

        [Fact]
        public void A_broken_observer_is_reported_rather_than_looking_healthy()
        {
            using var collector = new MutationRejectedMetricCollector("Production");

            SyncPushMetrics.RecordObservabilityEmitFailed("InvalidOperationException");

            var emitFailed = collector.Drain().Single(p =>
                p.MetricName == MutationRejectedMetricCollector.ObservabilityEmitFailedMetricName);

            // Non-zero here means MutationRejected is under-counting. Without this
            // second signal a broken observer looks exactly like a healthy system.
            emitFailed.Value.Should().Be(1);
            emitFailed.Dimensions.Select(d => d.Key).Should().NotContain("exception_type",
                "the exception TYPE is a bounded category but is still not needed as a metric dimension");
        }

        // ── The publisher actually ships the heartbeat ────────────────────────

        [Fact]
        public async Task Publisher_sends_the_heartbeat_even_when_nothing_was_rejected()
        {
            using var collector = new MutationRejectedMetricCollector("Production");
            var sink = new RecordingSink();
            var publisher = new MutationRejectedMetricPublisher(
                collector, sink, NullLogger<MutationRejectedMetricPublisher>.Instance);

            await publisher.PublishOnceAsync(CancellationToken.None);

            sink.Calls.Should().HaveCount(1);
            sink.Calls[0].Namespace.Should().Be("ShramSafal/Api");
            sink.Calls[0].Points.Should().Contain(p =>
                p.MetricName == MutationRejectedMetricCollector.MutationRejectedMetricName && p.Value == 0);
        }

        private sealed class RecordingSink : IMetricSink
        {
            public List<(string Namespace, IReadOnlyList<MetricDatapoint> Points)> Calls { get; } = new();

            public Task PutAsync(string metricNamespace, IReadOnlyList<MetricDatapoint> points, CancellationToken ct)
            {
                Calls.Add((metricNamespace, points));
                return Task.CompletedTask;
            }
        }
    }
}
