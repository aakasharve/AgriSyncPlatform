using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Amazon.CloudWatch;
using Amazon.CloudWatch.Model;

namespace AgriSync.Bootstrapper.Observability
{
    /// <summary>
    /// Where drained datapoints go. Abstracted so the aggregation logic in
    /// <see cref="MutationRejectedMetricCollector"/> and the scheduling in
    /// <see cref="Jobs.MutationRejectedMetricPublisher"/> are both testable
    /// without an AWS account.
    /// </summary>
    public interface IMetricSink
    {
        Task PutAsync(string metricNamespace, IReadOnlyList<MetricDatapoint> points, CancellationToken ct);
    }

    /// <summary>
    /// Publishes to CloudWatch via <c>PutMetricData</c>.
    ///
    /// <para>
    /// Before this class existed there was NO <c>PutMetricData</c> anywhere in
    /// <c>src/</c> — which is why the deploy gate's error-rate query returned an
    /// empty set and scored it GREEN.
    /// </para>
    ///
    /// <para>
    /// <b>Never throws to the caller.</b> Telemetry that can take down the API is
    /// worse than no telemetry. A failed publish is logged by the caller and the
    /// interval is lost — which surfaces honestly as a gap in the metric, i.e.
    /// NO_DATA, rather than as a silent zero.
    /// </para>
    /// </summary>
    public sealed class CloudWatchMetricSink : IMetricSink, IDisposable
    {
        // PutMetricData accepts at most 1000 datapoints per call. We emit two
        // aggregates plus one per non-zero (MutationType, ErrorCode) bucket, so
        // this is defensive rather than expected.
        private const int MaxDatapointsPerCall = 1000;

        private readonly IAmazonCloudWatch _client;

        public CloudWatchMetricSink(IAmazonCloudWatch client) => _client = client;

        public async Task PutAsync(
            string metricNamespace,
            IReadOnlyList<MetricDatapoint> points,
            CancellationToken ct)
        {
            if (points.Count == 0)
            {
                return;
            }

            var timestamp = DateTime.UtcNow;

            foreach (var batch in Chunk(points, MaxDatapointsPerCall))
            {
                var request = new PutMetricDataRequest
                {
                    Namespace = metricNamespace,
                    MetricData = batch.Select(p => new MetricDatum
                    {
                        MetricName = p.MetricName,
                        Value = p.Value,
                        Unit = StandardUnit.Count,
                        Timestamp = timestamp,
                        Dimensions = p.Dimensions
                            .Select(d => new Dimension { Name = d.Key, Value = d.Value })
                            .ToList()
                    }).ToList()
                };

                await _client.PutMetricDataAsync(request, ct).ConfigureAwait(false);
            }
        }

        private static IEnumerable<List<MetricDatapoint>> Chunk(IReadOnlyList<MetricDatapoint> source, int size)
        {
            for (var i = 0; i < source.Count; i += size)
            {
                yield return source.Skip(i).Take(size).ToList();
            }
        }

        public void Dispose() => _client.Dispose();
    }
}
