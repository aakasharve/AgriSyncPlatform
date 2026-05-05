using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Scenarios;

// agrisync-prompt-ops Phase 1 — Endpoint security tests for the staging-only
// /api/ai/eval-parse route. We assert defense-in-depth (Production env never
// registers, ALLOW_EVAL_PARSE!=true never registers) by sending real HTTP
// requests through TestServer and confirming 404 (route not registered).
//
// Charter ref: AGRISYNC_PROMPT_OPS_PLUGIN_2026-05-05.md §10 R4
public sealed class AiEvalEndpointSecurityTests
{
    [Fact]
    public async Task EvalParse_ReturnsNotFound_WhenEnvIsProduction()
    {
        // Even with ALLOW_EVAL_PARSE=true, Production env must short-circuit.
        await using var harness = await CreateHarnessAsync(
            environment: "Production",
            allowEvalParse: "true");

        var resp = await harness.Client.PostAsJsonAsync("/api/ai/eval-parse", new
        {
            transcript = "test",
            context = (object?)null,
            promptOverride = (string?)null,
            scenarioId = "test"
        });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task EvalParse_ReturnsNotFound_WhenFlagDisabled()
    {
        // Development env, but flag disabled (or absent) — must not register.
        await using var harness = await CreateHarnessAsync(
            environment: "Development",
            allowEvalParse: "false");

        var resp = await harness.Client.PostAsJsonAsync("/api/ai/eval-parse", new
        {
            transcript = "test",
            context = (object?)null,
            promptOverride = (string?)null,
            scenarioId = "test"
        });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private static async Task<TestHarness> CreateHarnessAsync(string environment, string allowEvalParse)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environment
        });

        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ALLOW_EVAL_PARSE"] = allowEvalParse
        });

        // Note: We do NOT call AddShramSafalApi here. The endpoint security gate
        // is in the route registration itself (defense in depth #1+#2), so we
        // can isolate the test by mapping ONLY MapAiEvalEndpoints. If the gate
        // logic falsely registers the route, we would see a different status
        // code (500 from missing IAiOrchestrator DI). 404 is the only signal
        // the test cares about — it means the route was not registered.
        builder.Services.AddRouting();

        var app = builder.Build();
        app.MapAiEvalEndpoints(app.Environment, app.Configuration);

        await app.StartAsync();
        return new TestHarness(app, app.GetTestClient());
    }

    private sealed class TestHarness(WebApplication app, System.Net.Http.HttpClient client) : IAsyncDisposable
    {
        public System.Net.Http.HttpClient Client { get; } = client;

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
