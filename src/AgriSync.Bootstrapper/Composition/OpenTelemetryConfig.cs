using System.Runtime.CompilerServices;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

[assembly: InternalsVisibleTo("AgriSync.ArchitectureTests")]

namespace AgriSync.Bootstrapper.Composition;

/// <summary>
/// T-IGH-03-OBSERVABILITY-OTEL: wires the OpenTelemetry SDK with W3C
/// Trace Context propagation, ASP.NET Core / HttpClient / EF Core /
/// Npgsql auto-instrumentation, and (conditionally) an OTLP exporter.
///
/// <para>
/// <b>What the W3C Trace Context wiring actually does.</b> The OTel
/// SDK default text-map propagator is a composite of the
/// W3C TraceContext propagator and the W3C Baggage propagator. With
/// <c>AddAspNetCoreInstrumentation</c>, an inbound HTTP request's
/// <c>traceparent</c> header is EXTRACTED by the propagator so the
/// server-side activity becomes a child of the caller's trace.
/// With <c>AddHttpClientInstrumentation</c>, an outbound HTTP
/// request's <c>traceparent</c> header is INJECTED by the propagator
/// so downstream services join the same trace. ASP.NET Core does
/// NOT add a <c>traceparent</c> response header by default, and we
/// do not configure one — clients must not rely on response headers
/// for trace correlation; they correlate via outbound trace
/// propagation or by querying the collector with a known trace id.
/// </para>
///
/// <para>
/// <b>OTLP exporter endpoint precedence.</b> In order:
/// <list type="number">
/// <item>The standard OTel env var <c>OTEL_EXPORTER_OTLP_ENDPOINT</c>
/// (read directly via <see cref="Environment.GetEnvironmentVariable(string)"/>
/// so it always wins over .NET configuration sources).</item>
/// <item><c>OTel:Endpoint</c> from <see cref="IConfiguration"/>
/// (which includes <c>appsettings.Development.json</c> →
/// <c>http://localhost:4317</c> for the local Jaeger smoke, plus
/// any <c>OTel__Endpoint</c> env-var override).</item>
/// <item>If neither source supplies a parseable absolute URI, the
/// OTLP exporter is NOT registered. Traces still flow inside the
/// SDK (so unit tests can observe activities) but nothing leaves
/// the process. This is the desired Production-default: ship
/// nothing unless someone has wired a collector explicitly.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Configuration.</b> <c>OTel:ServiceName</c> defaults to
/// <c>"agrisync"</c> and SHOULD be set per-environment
/// (<c>OTel__ServiceName=agrisync-prod-eu</c>) so traces are easy
/// to filter in the collector.
/// </para>
///
/// <para>
/// <b>Local Jaeger smoke (manual evidence required by the plan).</b>
/// <code>
/// docker run --rm --name agrisync-jaeger \
///   -p 16686:16686 -p 4317:4317 jaegertracing/all-in-one:latest
/// dotnet run --project src/AgriSync.Bootstrapper
/// # Send an inbound traceparent so the trace id in Jaeger is
/// # deterministic and easy to find:
/// curl -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
///   http://localhost:5000/health
/// # Open http://localhost:16686, select service "agrisync-dev",
/// # search for trace id 4bf92f3577b34da6a3ce929d0e0e4736.
/// </code>
/// </para>
/// </summary>
public static class OpenTelemetryConfig
{
    /// <summary>
    /// Default service name used when <c>OTel:ServiceName</c> is not
    /// configured. Production deploys SHOULD set this explicitly so
    /// per-environment traces are easy to filter in the collector.
    /// </summary>
    public const string DefaultServiceName = "agrisync";

    /// <summary>
    /// Standard OTel SDK env var that takes precedence over
    /// <c>OTel:Endpoint</c> in <see cref="IConfiguration"/>. Documented
    /// at <see href="https://opentelemetry.io/docs/specs/otel/protocol/exporter/"/>.
    /// </summary>
    public const string OtlpEndpointEnvVar = "OTEL_EXPORTER_OTLP_ENDPOINT";

    /// <summary>
    /// Registers the OpenTelemetry SDK with traces + metrics. The
    /// OTLP exporter is registered only when an endpoint resolves
    /// from <see cref="OtlpEndpointEnvVar"/> or <c>OTel:Endpoint</c>;
    /// otherwise no exporter is wired and traces stay inside the
    /// process. Idempotent; safe to call once at composition root.
    /// </summary>
    public static IServiceCollection AddAgriSyncObservability(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var serviceName = configuration["OTel:ServiceName"] ?? DefaultServiceName;
        var endpoint = ResolveOtlpEndpoint(configuration);

        services.AddOpenTelemetry()
            .ConfigureResource(rb => rb
                .AddService(serviceName: serviceName, serviceVersion: TryGetAssemblyVersion()))
            .WithTracing(tracing =>
            {
                tracing
                    .AddSource("AgriSync.*")
                    .AddAspNetCoreInstrumentation(o => o.RecordException = true)
                    .AddHttpClientInstrumentation()
                    // EF Core instrumentation: defaults are privacy-safe
                    // (statement text NOT captured). The 1.15.x API
                    // removed the SetDbStatementForText option earlier
                    // docs reference; the modern equivalent is the
                    // default.
                    .AddEntityFrameworkCoreInstrumentation()
                    .AddNpgsql();
                if (endpoint is not null)
                {
                    tracing.AddOtlpExporter(o => o.Endpoint = endpoint);
                }
            })
            .WithMetrics(metrics =>
            {
                metrics
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddRuntimeInstrumentation()
                    // T-IGH-05-PROMETHEUS-EXPORTER: always register the Prometheus
                    // pull exporter so /metrics is available regardless of whether
                    // an OTLP push collector is configured. The endpoint is mapped
                    // in PrometheusExporterConfig.MapPrometheusEndpoint().
                    .AddPrometheusExporter();
                if (endpoint is not null)
                {
                    metrics.AddOtlpExporter(o => o.Endpoint = endpoint);
                }
            });

        return services;
    }

    /// <summary>
    /// Resolves the OTLP endpoint per the documented precedence:
    /// <see cref="OtlpEndpointEnvVar"/> → <c>OTel:Endpoint</c> →
    /// <c>null</c>. A bad URI from either source is treated the
    /// same as "not configured" so a typo cannot crash the host.
    /// Exposed as <c>internal</c> for the architecture test that
    /// asserts the precedence directly.
    /// </summary>
    internal static Uri? ResolveOtlpEndpoint(IConfiguration configuration)
    {
        var raw = Environment.GetEnvironmentVariable(OtlpEndpointEnvVar)
                  ?? configuration["OTel:Endpoint"];
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }
        return Uri.TryCreate(raw, UriKind.Absolute, out var parsed) ? parsed : null;
    }

    private static string TryGetAssemblyVersion()
    {
        var asm = typeof(OpenTelemetryConfig).Assembly;
        return asm.GetName().Version?.ToString() ?? "0.0.0";
    }
}
