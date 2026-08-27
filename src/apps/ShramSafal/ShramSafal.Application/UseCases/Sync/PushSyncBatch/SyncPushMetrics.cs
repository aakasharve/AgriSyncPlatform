using System.Diagnostics.Metrics;

namespace ShramSafal.Application.UseCases.Sync.PushSyncBatch;

/// <summary>
/// RG5 (Rulebook §4.1 — Observability): the metric-native half of sync-push
/// rejection visibility. Its sibling is the structured <c>Warning</c> emitted by
/// <see cref="PushSyncBatchHandler"/>.
///
/// <para>
/// <b>Why a <see cref="Meter"/> and not something new.</b> The composition root
/// already registers the OpenTelemetry metrics SDK with an always-on Prometheus
/// pull exporter (<c>OpenTelemetryConfig.AddAgriSyncObservability</c> →
/// <c>AddPrometheusExporter()</c>, surfaced at <c>/metrics</c> by
/// <c>PrometheusExporterConfig.MapPrometheusEndpoint</c>) plus a conditional OTLP
/// push exporter. Nothing here is invented — the meter name matches the
/// <c>AgriSync.*</c> wildcard the same config registers for metrics.
/// </para>
///
/// <para>
/// <b>Cardinality.</b> Tags are deliberately limited to <c>mutation_type</c>
/// (bounded by <c>SyncMutationCatalog</c>) and <c>error_code</c> (a closed,
/// developer-authored vocabulary). Farm id, actor id, device id and client
/// request id are unbounded and are NEVER tags — they live in the log line,
/// which is where per-incident forensics belongs.
/// </para>
///
/// <para>
/// <b>Reaching CloudWatch.</b> These instruments are live at <c>/metrics</c> the
/// moment the binary runs. Turning them into a CloudWatch alarm is an
/// ops-engineer step (CloudWatch agent Prometheus scrape → EMF → namespace of
/// the operator's choosing, or a CloudWatch Logs metric filter on the
/// <c>SyncMutationRejected</c> log token). This assembly deliberately creates no
/// AWS dependency and no alarm.
/// </para>
/// </summary>
public static class SyncPushMetrics
{
    /// <summary>
    /// Meter name. Sits under the <c>AgriSync.*</c> prefix so the composition
    /// root picks it up by wildcard rather than by hard reference.
    /// </summary>
    public const string MeterName = "AgriSync.ShramSafal.Sync";

    /// <summary>
    /// OpenTelemetry instrument name for "the server refused a farmer's
    /// mutation". This name is the verified one (asserted by
    /// <c>PushSyncBatchRejectionObservabilityTests</c> via <c>MeterListener</c>).
    ///
    /// <para>
    /// The Prometheus exporter applies its own naming rules on scrape, so the
    /// exported series is EXPECTED to be
    /// <c>agrisync_shramsafal_sync_mutation_rejected_total</c> (dots to
    /// underscores, <c>_total</c> suffix for a monotonic counter) — expected,
    /// NOT verified here: confirming it requires scraping <c>/metrics</c> off a
    /// running host, which no test in this repo does. Whoever builds the alarm
    /// must read the real name off <c>/metrics</c> first rather than trusting
    /// this line.
    /// </para>
    /// </summary>
    public const string MutationRejectedInstrumentName =
        "agrisync.shramsafal.sync.mutation_rejected";

    /// <summary>
    /// OpenTelemetry instrument name for "the rejection-observability emit
    /// itself threw". Non-zero means the signal above is under-counting, so it
    /// must be alarmed alongside it — otherwise a broken observer looks exactly
    /// like a healthy system.
    /// </summary>
    public const string ObservabilityEmitFailedInstrumentName =
        "agrisync.shramsafal.sync.observability_emit_failed";

    private static readonly Meter SyncMeter = new(MeterName, "1.0.0");

    // No `unit:` on either instrument on purpose: the Prometheus exporter
    // appends the unit to the exported name, so setting one would change the
    // metric name an alarm is built on.
    private static readonly Counter<long> MutationRejectedCounter =
        SyncMeter.CreateCounter<long>(
            MutationRejectedInstrumentName,
            description: "Sync mutations rejected by the server. Each increment is farmer "
                + "work that was not applied, inside an HTTP 200 batch response.");

    private static readonly Counter<long> ObservabilityEmitFailedCounter =
        SyncMeter.CreateCounter<long>(
            ObservabilityEmitFailedInstrumentName,
            description: "Failures of the sync rejection observability emit itself. "
                + "Non-zero means mutation_rejected is under-reporting.");

    /// <summary>
    /// Records one rejected sync mutation.
    /// </summary>
    public static void RecordMutationRejected(string mutationType, string errorCode)
    {
        MutationRejectedCounter.Add(
            1,
            new KeyValuePair<string, object?>("mutation_type", mutationType),
            new KeyValuePair<string, object?>("error_code", errorCode));
    }

    /// <summary>
    /// Records one failure of the rejection-observability emit path. Tagged with
    /// the exception TYPE only — exception messages can carry payload text.
    /// </summary>
    public static void RecordObservabilityEmitFailed(string exceptionType)
    {
        ObservabilityEmitFailedCounter.Add(
            1,
            new KeyValuePair<string, object?>("exception_type", exceptionType));
    }
}
