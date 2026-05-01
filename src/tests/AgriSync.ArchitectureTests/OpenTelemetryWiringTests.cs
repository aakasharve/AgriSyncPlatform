using AgriSync.Bootstrapper.Composition;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
using OpenTelemetry.Trace;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// T-IGH-03-OBSERVABILITY-OTEL: contract tests for
/// <see cref="OpenTelemetryConfig.AddAgriSyncObservability"/>.
///
/// <para>
/// These tests prove the wiring at composition time — that calling
/// the extension method registers a <see cref="TracerProvider"/> and
/// that the W3C Trace Context propagator (which produces
/// <c>traceparent</c> headers on outbound HTTP and parses them on
/// inbound HTTP) is the SDK default. They do NOT prove that an
/// actual HTTP entry point produces a trace tree visible in Jaeger —
/// that's the interactive smoke required by the plan and is captured
/// separately as evidence on the wiring commit.
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
    public void AddAgriSyncObservability_uses_W3C_TraceContext_propagator_so_traceparent_is_emitted()
    {
        var (sp, _) = BuildContainerWithObservability();
        try
        {
            // Force the OTel hosted service to start so the SDK
            // initialises Propagators.DefaultTextMapPropagator.
            _ = sp.GetService<TracerProvider>();

            var propagator = Propagators.DefaultTextMapPropagator;
            Assert.NotNull(propagator);

            // The default OpenTelemetry SDK propagator is a composite
            // of (TraceContextPropagator + BaggagePropagator). The
            // critical contract for this test is that the composite
            // exposes the 'traceparent' field — that's the
            // W3C Trace Context header name. If a future change wires
            // a B3-only or Jaeger-only propagator, this assertion
            // will fail loudly.
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
    public void AddAgriSyncObservability_falls_back_to_default_endpoint_when_misconfigured()
    {
        // A bad endpoint string should NOT crash the host. The config
        // method must guard the Uri.TryCreate call.
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

        // The call itself must not throw. (We don't need to assert
        // the resulting endpoint value; we just need to prove the
        // fallback prevents a startup crash on misconfig.)
        var ex = Record.Exception(() => services.AddAgriSyncObservability(config));
        Assert.Null(ex);

        using var sp = services.BuildServiceProvider();
        var tracerProvider = sp.GetService<TracerProvider>();
        Assert.NotNull(tracerProvider);
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
