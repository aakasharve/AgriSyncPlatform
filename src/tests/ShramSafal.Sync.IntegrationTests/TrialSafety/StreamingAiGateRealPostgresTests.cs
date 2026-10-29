// spec: pre-launch repair R-11 (d) — the two AI doors that had no trial gate
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// spec R-11 (d) (evidence N-1: "Two AI doors have no trial check … If the streaming voice switch is
/// turned back on, voice would bypass the trial") — <c>/shramsafal/ai/parse-voice-stream</c> and
/// <c>/shramsafal/ai/transcribe-stream</c> now carry the same gate as <c>/ai/voice-parse</c>, proven
/// over the real pipeline on real Postgres as the app role. transcribe-stream is on the tenant
/// middleware's skip-list (no request transaction), so this is also the proof that its own short
/// read-only transaction really sees the caller's farm under FORCE RLS.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class StreamingAiGateRealPostgresTests(TrialSafetyDatabase db, ITestOutputHelper output)
    : IClassFixture<TrialSafetyDatabase>
{
    [Fact]
    public async Task Parse_voice_stream_refuses_an_expired_farm_before_any_AI_runs_and_streams_once_extended()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, account, owner, worker) = await SeedExpiredFarmAsync();
        var orchestrator = new CountingOrchestrator();
        await using var app = await db.BuildHostAsync(orchestrator);
        using var client = app.GetTestClient();

        foreach (var who in new[] { owner, worker })
        {
            using var refused = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/parse-voice-stream", who,
                new { transcript = "आज फवारणी केली.", farmId = farm });
            var text = await refused.Content.ReadAsStringAsync();
            output.WriteLine($"[EVIDENCE] parse-voice-stream expired: {(int)refused.StatusCode} {text}");
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, text);
            text.Should().Contain("entitlement.subscriptionexpired");
        }

        orchestrator.Calls.Should().Be(0, "no AI cost is spent on a refused farm");

        await db.SeedExtensionAsync(account, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddDays(10));
        using var allowed = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/parse-voice-stream", worker,
            new { transcript = "आज फवारणी केली.", farmId = farm });
        allowed.StatusCode.Should().Be(HttpStatusCode.OK, await allowed.Content.ReadAsStringAsync());
        allowed.Content.Headers.ContentType?.MediaType.Should().Be("text/event-stream");
        orchestrator.Calls.Should().Be(1);
    }

    [Fact]
    public async Task Parse_voice_stream_without_a_farm_is_refused()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (_, _, owner, _) = await SeedExpiredFarmAsync();
        var orchestrator = new CountingOrchestrator();
        await using var app = await db.BuildHostAsync(orchestrator);
        using var client = app.GetTestClient();

        using var response = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/parse-voice-stream", owner,
            new { transcript = "आज फवारणी केली." });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        orchestrator.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Transcribe_stream_refuses_an_expired_farm_a_stranger_and_a_missing_farm_and_passes_the_gate_once_extended()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, account, owner, _) = await SeedExpiredFarmAsync();
        await using var app = await db.BuildHostAsync(new CountingOrchestrator());
        using var client = app.GetTestClient();

        using (var expired = await PostTranscribeAsync(client, owner, farm))
        {
            var text = await expired.Content.ReadAsStringAsync();
            output.WriteLine($"[EVIDENCE] transcribe-stream expired: {(int)expired.StatusCode} {text}");
            expired.StatusCode.Should().Be(HttpStatusCode.Forbidden, text);
            text.Should().Contain("entitlement.subscriptionexpired");
        }

        using (var stranger = await PostTranscribeAsync(client, Guid.NewGuid(), farm))
        {
            stranger.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a non-member is refused by the farm scope");
            (await stranger.Content.ReadAsStringAsync()).Should().NotContain("entitlement.");
        }

        using (var noFarm = await PostTranscribeAsync(client, owner, farm: null))
        {
            noFarm.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await noFarm.Content.ReadAsStringAsync()).Should().Contain("farm_id is required");
        }

        // With an extension the gate passes; the request then fails only on the missing audio — the
        // proof that the gate (and nothing else) was what refused it before.
        await db.SeedExtensionAsync(account, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddDays(10));
        using var passed = await PostTranscribeAsync(client, owner, farm);
        var passedText = await passed.Content.ReadAsStringAsync();
        output.WriteLine($"[EVIDENCE] transcribe-stream extended: {(int)passed.StatusCode} {passedText}");
        passed.StatusCode.Should().Be(HttpStatusCode.BadRequest, passedText);
        passedText.Should().Contain("audio is required");
    }

    // ── helpers ──

    private async Task<(Guid Farm, Guid Account, Guid Owner, Guid Worker)> SeedExpiredFarmAsync()
    {
        var farm = Guid.NewGuid();
        var account = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var worker = Guid.NewGuid();
        await db.SeedAccountAsync(account, owner, farm);
        await db.SeedFarmAsync(farm, owner, account, ShramSafal.Domain.Farms.FarmCode.New());
        await db.SeedSeatAsync(farm, account, worker, "Worker");
        await db.SeedSubscriptionAsync(account, 4, DateTime.UtcNow.AddDays(-2));
        return (farm, account, owner, worker);
    }

    private static Task<HttpResponseMessage> PostTranscribeAsync(HttpClient client, Guid who, Guid? farm)
    {
        var form = new MultipartFormDataContent { { new StringContent("mr-IN"), "language_hint" } };
        if (farm is { } id)
        {
            form.Add(new StringContent(id.ToString()), "farm_id");
        }

        return TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/transcribe-stream", who, content: form);
    }

    private sealed class CountingOrchestrator : IAiOrchestrator
    {
        public int Calls { get; private set; }

        public async IAsyncEnumerable<ParseStreamEvent> ParseVoiceStreamAsync(
            string transcript, VoiceParseContext context, string? scenarioId, [EnumeratorCancellation] CancellationToken ct = default)
        {
            Calls++;
            await Task.Yield();
            yield return new ParseStreamEvent(Type: "complete", Payload: null);
        }

        public Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ParseVoiceWithFallbackAsync(
            Guid userId, Guid farmId, Stream audioStream, string mimeType, string systemPrompt, string idempotencyKey,
            string languageHint = "mr-IN", int? inputSpeechDurationMs = null, int? inputRawDurationMs = null,
            string? segmentMetadataJson = null, string? requestPayloadHash = null, string clientAppVersion = "unknown",
            CancellationToken ct = default) => throw new NotImplementedException();

        public Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ParseVoiceTwoStageAsync(
            Guid userId, Guid farmId, Stream audioStream, string mimeType, VoiceParseContext promptContext, string idempotencyKey,
            string languageHint = "mr-IN", DateTime? capturedAtUtc = null, int? inputSpeechDurationMs = null, int? inputRawDurationMs = null,
            string? segmentMetadataJson = null, string? requestPayloadHash = null, string clientAppVersion = "unknown",
            CancellationToken ct = default) => throw new NotImplementedException();

        public Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractReceiptWithFallbackAsync(
            Guid userId, Guid farmId, Stream imageStream, string mimeType, string systemPrompt, string idempotencyKey,
            string clientAppVersion = "unknown", CancellationToken ct = default) => throw new NotImplementedException();

        public Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractPattiWithFallbackAsync(
            Guid userId, Guid farmId, Stream imageStream, string mimeType, string systemPrompt, string idempotencyKey,
            string clientAppVersion = "unknown", CancellationToken ct = default) => throw new NotImplementedException();

        public Task<EvalParseResult> ParseVoiceWithOverrideAsync(
            string transcript, VoiceParseContext context, string? promptOverride, string? scenarioId,
            CancellationToken ct = default) => throw new NotImplementedException();
    }
}
