using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace AgriSync.Bootstrapper.Composition;

/// <summary>
/// T-IGH-03-OBSERVABILITY-OTEL: wires the OpenTelemetry SDK with W3C
/// Trace Context propagation, ASP.NET Core / HttpClient / EF Core /
/// Npgsql auto-instrumentation, and an OTLP exporter pointed at a
/// local Jaeger collector by default.
///
/// <para>
/// <b>Why W3C Trace Context.</b> ASP.NET Core's
/// <c>AddAspNetCoreInstrumentation</c> + the OTel SDK default
/// propagator together produce <c>traceparent</c> response headers
/// and propagate inbound <c>traceparent</c> through outgoing HTTP
/// (via <c>AddHttpClientInstrumentation</c>) so that any future
/// service split keeps a single trace across the boundary. This
/// matches the plan's Sub-plan 03 Task 11 acceptance.
/// </para>
///
/// <para>
/// <b>Configuration.</b> Reads two keys from <c>IConfiguration</c>:
/// <c>OTel:ServiceName</c> (defaults to <c>"agrisync"</c>) and
/// <c>OTel:Endpoint</c> (defaults to <c>http://localhost:4317</c>,
/// the Jaeger all-in-one OTLP gRPC port). Production deploys override
/// either via env vars (<c>OTel__ServiceName</c>,
/// <c>OTel__Endpoint</c>) or via the standard OTel env var
/// <c>OTEL_EXPORTER_OTLP_ENDPOINT</c> which the SDK honours
/// automatically when no explicit endpoint is set.
/// </para>
///
/// <para>
/// <b>Local Jaeger smoke (manual evidence required by the plan).</b>
/// <code>
/// docker run --rm --name agrisync-jaeger \
///   -p 16686:16686 -p 4317:4317 jaegertracing/all-in-one:latest
/// dotnet run --project src/AgriSync.Bootstrapper
/// # hit GET /health, GET /health/ready, then a real endpoint
/// # open http://localhost:16686 and confirm trace tree
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
    /// Default OTLP endpoint matching the Jaeger all-in-one image's
    /// gRPC receiver. Production deploys SHOULD set this to whatever
    /// collector address the deployed graph is using.
    /// </summary>
    public const string DefaultOtlpEndpoint = "http://localhost:4317";

    /// <summary>
    /// Registers the OpenTelemetry SDK with traces + metrics. Idempotent;
    /// safe to call once at composition root.
    /// </summary>
    public static IServiceCollection AddAgriSyncObservability(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var serviceName = configuration["OTel:ServiceName"] ?? DefaultServiceName;
        var endpointRaw = configuration["OTel:Endpoint"] ?? DefaultOtlpEndpoint;

        if (!Uri.TryCreate(endpointRaw, UriKind.Absolute, out var endpoint))
        {
            // Fall back to default rather than crash on misconfiguration —
            // a bad OTel endpoint should not take down the whole host.
            endpoint = new Uri(DefaultOtlpEndpoint);
        }

        services.AddOpenTelemetry()
            .ConfigureResource(rb => rb
                .AddService(serviceName: serviceName, serviceVersion: TryGetAssemblyVersion()))
            .WithTracing(tracing => tracing
                .AddSource("AgriSync.*")
                .AddAspNetCoreInstrumentation(o => o.RecordException = true)
                .AddHttpClientInstrumentation()
                // EF Core instrumentation: defaults are privacy-safe
                // (statement text NOT captured) so we accept defaults.
                // The 1.15.x API removed the SetDbStatementForText
                // option that earlier docs reference; the modern
                // equivalent is to leave it off.
                .AddEntityFrameworkCoreInstrumentation()
                .AddNpgsql()
                .AddOtlpExporter(o => o.Endpoint = endpoint))
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddOtlpExporter(o => o.Endpoint = endpoint));

        return services;
    }

    private static string TryGetAssemblyVersion()
    {
        var asm = typeof(OpenTelemetryConfig).Assembly;
        return asm.GetName().Version?.ToString() ?? "0.0.0";
    }
}
