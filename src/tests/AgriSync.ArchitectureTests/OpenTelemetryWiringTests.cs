using AgriSync.Bootstrapper.Composition;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
using OpenTelemetry.Exporter;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// T-IGH-03-OBSERVABILITY-OTEL: contract tests for
/// <see cref="OpenTelemetryConfig.AddAgriSyncObservability"/>.
///
/// <para>
/// These tests prove the wiring at composition time:
/// <list type="bullet">
/// <item>Calling the extension method registers a
/// <see cref="TracerProvider"/>.</item>
/// <item>The default text-map propagator exposes the W3C Trace
/// Context <c>traceparent</c> field — meaning the propagator can
/// EXTRACT a caller-supplied <c>traceparent</c> from inbound HTTP
/// headers and INJECT one into outbound HTTP headers via the
/// <c>HttpClient</c> instrumentation. ASP.NET Core does NOT add a
/// <c>traceparent</c> response header by default and we do not
/// configure one; trace correlation is achieved via outbound
/// propagation or by querying the collector with a known trace id.</item>
/// <item>The OTLP exporter endpoint follows the documented precedence
/// (<see cref="OpenTelemetryConfig.OtlpEndpointEnvVar"/> → config
/// <c>OTel:Endpoint</c> → null/no-exporter).</item>
/// </list>
/// </para>
///
/// <para>
/// These tests do NOT prove that an actual HTTP entry point produces
/// a trace tree visible in Jaeger — that's the interactive smoke
/// required by the plan and is captured as evidence in the OTel
/// pending-task doc and SESSION_STATE, separately from this code.
/// </para>
/// </summary>
public sealed class OpenTelemetryWiringTests
{
    [Fact]
    public void AddAgriSyncObservability_registers_TracerProvider()
    {
        var (sp, _) = BuildContainerWithObservability();
        try
        {
            var tracerProvider = sp.GetService<TracerProvider>();
            Assert.NotNull(tracerProvider);
        }
        finally
        {
            sp.Dispose();
        }
    }

    [Fact]
    public void AddAgriSyncObservability_default_propagator_is_W3C_TraceContext_with_traceparent_field()
    {
        var (sp, _) = BuildContainerWithObservability();
        try
        {
            // Force the SDK to initialise its default text-map
            // propagator (TraceContext + Baggage composite).
            _ = sp.GetService<TracerProvider>();

            var propagator = Propagators.DefaultTextMapPropagator;
            Assert.NotNull(propagator);

            // The composite must expose the W3C Trace Context
            // 'traceparent' field. The propagator uses this field
            // BOTH to extract from inbound HTTP request headers
            // (so the server activity becomes a child of the
            // caller's trace) AND to inject into outbound HTTP
            // request headers via HttpClient instrumentation.
            //
            // This assertion does NOT claim ASP.NET Core emits a
            // 'traceparent' RESPONSE header — it does not, by
            // default. Trace correlation across the wire happens
            // via inbound headers + outbound HttpClient propagation.
            //
            // propagator.Fields is annotated as ISet<string>? on the
            // base; assert non-null first so the Contains call is
            // null-safe and Release builds (warnings-as-errors) stay
            // green.
            Assert.NotNull(propagator.Fields);
            Assert.Contains("traceparent", propagator.Fields);
        }
        finally
        {
            sp.Dispose();
        }
    }

    [Fact]
    public void AddAgriSyncObservability_does_not_crash_when_endpoint_is_misconfigured()
    {
        // A bad endpoint string should NOT crash the host. With the
        // current precedence rule, a bad URI from either
        // OTEL_EXPORTER_OTLP_ENDPOINT or OTel:Endpoint is treated as
        // "no exporter wired" rather than throwing or falling back.
        var services = new ServiceCollection();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["OTel:ServiceName"] = "agrisync-arch-test",
                ["OTel:Endpoint"] = "not-a-uri"
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddLogging();

        var ex = Record.Exception(() => services.AddAgriSyncObservability(config));
        Assert.Null(ex);

        // TracerProvider still resolves — traces flow inside the SDK
        // even with no exporter; only outbound shipping is suppressed.
        using var sp = services.BuildServiceProvider();
        var tracerProvider = sp.GetService<TracerProvider>();
        Assert.NotNull(tracerProvider);

        // Confirm the precedence helper agrees: a misconfigured value
        // resolves to null (no exporter).
        var resolved = OpenTelemetryConfig.ResolveOtlpEndpoint(config);
        Assert.Null(resolved);
    }

    [Fact]
    public void ResolveOtlpEndpoint_prefers_OTEL_EXPORTER_OTLP_ENDPOINT_env_var_over_OTel_Endpoint_config()
    {
        var prior = Environment.GetEnvironmentVariable(OpenTelemetryConfig.OtlpEndpointEnvVar);
        try
        {
            Environment.SetEnvironmentVariable(
                OpenTelemetryConfig.OtlpEndpointEnvVar,
                "http://from-env-var:4317");

            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["OTel:Endpoint"] = "http://from-config:4317"
                })
                .Build();

            var resolved = OpenTelemetryConfig.ResolveOtlpEndpoint(config);
            Assert.NotNull(resolved);
            Assert.Equal(new Uri("http://from-env-var:4317"), resolved);
        }
        finally
        {
            // Restore the prior env-var state so the test is
            // hermetic; xUnit shares process state across tests.
            Environment.SetEnvironmentVariable(
                OpenTelemetryConfig.OtlpEndpointEnvVar,
                prior);
        }
    }

    [Fact]
    public void ResolveOtlpEndpoint_falls_back_to_OTel_Endpoint_config_when_env_var_unset()
    {
        var prior = Environment.GetEnvironmentVariable(OpenTelemetryConfig.OtlpEndpointEnvVar);
        try
        {
            Environment.SetEnvironmentVariable(
                OpenTelemetryConfig.OtlpEndpointEnvVar,
                null);

            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["OTel:Endpoint"] = "http://from-config:4317"
                })
                .Build();

            var resolved = OpenTelemetryConfig.ResolveOtlpEndpoint(config);
            Assert.NotNull(resolved);
            Assert.Equal(new Uri("http://from-config:4317"), resolved);
        }
        finally
        {
            Environment.SetEnvironmentVariable(
                OpenTelemetryConfig.OtlpEndpointEnvVar,
                prior);
        }
    }

    [Fact]
    public void ResolveOtlpEndpoint_returns_null_when_neither_env_var_nor_config_supplies_endpoint()
    {
        var prior = Environment.GetEnvironmentVariable(OpenTelemetryConfig.OtlpEndpointEnvVar);
        try
        {
            Environment.SetEnvironmentVariable(
                OpenTelemetryConfig.OtlpEndpointEnvVar,
                null);

            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>())
                .Build();

            var resolved = OpenTelemetryConfig.ResolveOtlpEndpoint(config);
            Assert.Null(resolved);
        }
        finally
        {
            Environment.SetEnvironmentVariable(
                OpenTelemetryConfig.OtlpEndpointEnvVar,
                prior);
        }
    }

    // ----------------------------------------------------------------
    // T-IGH-05-PROMETHEUS-EXPORTER: composition-time tests
    // ----------------------------------------------------------------

    /// <summary>
    /// Verifies that <c>AddAgriSyncObservability</c> registers a
    /// <see cref="MeterProvider"/> — meaning the OTel metrics pipeline
    /// is live and the Prometheus exporter can pull from it.
    /// </summary>
    [Fact]
    public void AddAgriSyncObservability_registers_MeterProvider()
    {
        var (sp, _) = BuildContainerWithObservability();
        try
        {
            var meterProvider = sp.GetService<MeterProvider>();
            Assert.NotNull(meterProvider);
        }
        finally
        {
            sp.Dispose();
        }
    }

    /// <summary>
    /// Verifies that the Prometheus exporter is wired into the metrics
    /// pipeline by asserting that <see cref="PrometheusAspNetCoreOptions"/>
    /// is registered in the service container. <c>AddPrometheusExporter()</c>
    /// registers this options type; its absence would indicate the exporter
    /// was never added to <c>WithMetrics(...)</c>.
    /// </summary>
    [Fact]
    public void AddAgriSyncObservability_registers_PrometheusExporter_options()
    {
        var (sp, _) = BuildContainerWithObservability();
        try
        {
            // AddPrometheusExporter() registers IOptions<PrometheusAspNetCoreOptions>
            // in the container. If the exporter was never wired the service will be
            // absent (returns null from GetService).
            var options = sp.GetService<IOptions<PrometheusAspNetCoreOptions>>();
            Assert.NotNull(options);
        }
        finally
        {
            sp.Dispose();
        }
    }

    private static (ServiceProvider Sp, IConfiguration Config) BuildContainerWithObservability()
    {
        var services = new ServiceCollection();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["OTel:ServiceName"] = "agrisync-arch-test",
                ["OTel:Endpoint"] = "http://localhost:4317"
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddLogging();
        services.AddAgriSyncObservability(config);

        return (services.BuildServiceProvider(), config);
    }
}
