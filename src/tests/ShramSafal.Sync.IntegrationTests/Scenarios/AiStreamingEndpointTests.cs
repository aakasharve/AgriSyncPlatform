using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Scenarios;

// Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7 Task 3.6) — verifies the SSE endpoint
// faithfully serializes orchestrator events as `data: {...}\n\n` frames in
// arrival order. A stub IAiOrchestrator yields a controlled sequence so the
// test isolates the wire-format layer (orchestrator/parser correctness lives
// in PartialJsonParserTests + the unit suite).
public sealed class AiStreamingEndpointTests
{
    private static readonly Guid TestUserId = Guid.Parse("00000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task ParseVoiceStream_StreamsExpectedSseEvents()
    {
        var scripted = new[]
        {
            new ParseStreamEvent(Type: "text", Content: "{\"summary\":"),
            new ParseStreamEvent(Type: "text", Content: "\"hello\","),
            new ParseStreamEvent(Type: "field_complete", FieldPath: "summary"),
            new ParseStreamEvent(Type: "complete", Payload: null)
        };
        await using var harness = await CreateHarnessAsync(new ScriptedOrchestrator(scripted));

        using var resp = await harness.Client.PostAsJsonAsync(
            "/shramsafal/ai/parse-voice-stream",
            new { transcript = "आज पाणी दिलं.", scenarioId = "test-1" });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("text/event-stream", resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadAsStringAsync();
        var dataLines = body
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Where(l => l.StartsWith("data: ", StringComparison.Ordinal))
            .Select(l => l["data: ".Length..])
            .ToList();

        Assert.Equal(scripted.Length, dataLines.Count);
        Assert.Contains("\"type\":\"text\"", dataLines[0]);
        Assert.Contains("\"content\":\"{\\u0022summary\\u0022:\"", dataLines[0]);
        Assert.Contains("\"type\":\"field_complete\"", dataLines[2]);
        Assert.Contains("\"fieldPath\":\"summary\"", dataLines[2]);
        Assert.Contains("\"type\":\"complete\"", dataLines[3]);
    }

    [Fact]
    public async Task ParseVoiceStream_ReturnsBadRequest_WhenTranscriptMissing()
    {
        await using var harness = await CreateHarnessAsync(new ScriptedOrchestrator(Array.Empty<ParseStreamEvent>()));

        using var resp = await harness.Client.PostAsJsonAsync(
            "/shramsafal/ai/parse-voice-stream",
            new { transcript = "", scenarioId = "test-empty" });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task ParseVoiceStream_ReturnsUnauthorized_WhenNoAuth()
    {
        await using var harness = await CreateHarnessAsync(
            new ScriptedOrchestrator(Array.Empty<ParseStreamEvent>()),
            authenticated: false);

        using var resp = await harness.Client.PostAsJsonAsync(
            "/shramsafal/ai/parse-voice-stream",
            new { transcript = "test" });

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private static async Task<TestHarness> CreateHarnessAsync(
        IAiOrchestrator orchestrator,
        bool authenticated = true)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Testing"
        });

        builder.WebHost.UseTestServer();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);

        var schemeName = authenticated ? "Test" : "NoAuth";
        builder.Services
            .AddAuthentication(schemeName)
            .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(schemeName, opts =>
            {
                opts.ForwardDefault = schemeName;
            });
        builder.Services.AddAuthorization();
        builder.Services.AddSingleton(orchestrator);
        builder.Services.AddSingleton<TestAuthOptions>(new TestAuthOptions(authenticated));

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();

        var group = app.MapGroup("/shramsafal").RequireAuthorization();
        group.MapAiStreamingEndpoints();

        await app.StartAsync();
        return new TestHarness(app, app.GetTestClient());
    }

    private sealed record TestAuthOptions(bool Authenticated);

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        TestAuthOptions testOptions)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!testOptions.Authenticated)
            {
                return Task.FromResult(AuthenticateResult.Fail("no auth"));
            }

            var claims = new[] { new Claim("sub", TestUserId.ToString()) };
            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    private sealed class ScriptedOrchestrator(IReadOnlyList<ParseStreamEvent> events) : IAiOrchestrator
    {
        public Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)>
            ParseVoiceWithFallbackAsync(
                Guid userId,
                Guid farmId,
                Stream audioStream,
                string mimeType,
                string systemPrompt,
                string idempotencyKey,
                string languageHint = "mr-IN",
                int? inputSpeechDurationMs = null,
                int? inputRawDurationMs = null,
                string? segmentMetadataJson = null,
                string? requestPayloadHash = null,
                CancellationToken ct = default)
            => throw new NotImplementedException();

        public Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)>
            ExtractReceiptWithFallbackAsync(
                Guid userId,
                Guid farmId,
                Stream imageStream,
                string mimeType,
                string systemPrompt,
                string idempotencyKey,
                CancellationToken ct = default)
            => throw new NotImplementedException();

        public Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)>
            ExtractPattiWithFallbackAsync(
                Guid userId,
                Guid farmId,
                Stream imageStream,
                string mimeType,
                string systemPrompt,
                string idempotencyKey,
                CancellationToken ct = default)
            => throw new NotImplementedException();

        public Task<EvalParseResult> ParseVoiceWithOverrideAsync(
            string transcript,
            VoiceParseContext context,
            string? promptOverride,
            string? scenarioId,
            CancellationToken ct = default)
            => throw new NotImplementedException();

        public async IAsyncEnumerable<ParseStreamEvent> ParseVoiceStreamAsync(
            string transcript,
            VoiceParseContext context,
            string? scenarioId,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            foreach (var evt in events)
            {
                ct.ThrowIfCancellationRequested();
                await Task.Yield();
                yield return evt;
            }
        }
    }

    private sealed class TestHarness(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
