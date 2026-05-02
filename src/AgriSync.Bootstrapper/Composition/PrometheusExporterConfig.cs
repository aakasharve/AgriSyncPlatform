using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace AgriSync.Bootstrapper.Composition;

/// <summary>
/// T-IGH-05-PROMETHEUS-EXPORTER: maps the <c>/metrics</c> scraping endpoint
/// backed by <c>OpenTelemetry.Exporter.Prometheus.AspNetCore</c>.
///
/// <para>
/// The endpoint is intentionally anonymous — the same posture as <c>/health</c>.
/// Production hardening (IP allowlist or VPC-internal binding) is a
/// follow-up tracked in the SLO runbooks; for now, operators scrape from
/// inside the private network where the service runs.
/// </para>
///
/// <para>
/// <b>Wiring order:</b> this must be called AFTER
/// <see cref="OpenTelemetryConfig.AddAgriSyncObservability"/> has registered
/// the OTel SDK (in <c>builder.Services</c>) and AFTER <c>app.Build()</c>.
/// The Prometheus exporter is wired into <c>WithMetrics(...)</c> in
/// <see cref="OpenTelemetryConfig"/> via <c>.AddPrometheusExporter()</c>.
/// </para>
/// </summary>
public static class PrometheusExporterConfig
{
    /// <summary>
    /// Maps the Prometheus <c>/metrics</c> scraping endpoint.
    /// Anonymous access — same policy as <c>/health</c>.
    /// </summary>
    public static IEndpointRouteBuilder MapPrometheusEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapPrometheusScrapingEndpoint();
        return app;
    }
}
