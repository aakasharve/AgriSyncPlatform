using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.4 F2 — voice-parse cache-hit
/// path coverage for <see cref="AiOrchestrator.ParseVoiceWithFallbackAsync"/>.
///
/// Spec: when the orchestrator is called with an <c>idempotencyKey</c> that
/// resolves to an already-persisted, succeeded <see cref="AiJob"/> with its
/// <see cref="Provenance.PromptContentHash"/> populated, the returned
/// <see cref="VoiceParseCanonicalResult.PromptContentHash"/> equals the
/// cached AiJob's hash — not <c>null</c>, not a fresh hash from the prompt
/// builder. The cached path must return the STORED hash so downstream
/// handlers can stamp a forensically-correct <see cref="Provenance"/> on
/// rows created from this parse.
///
/// Tests derive only from the spec — no implementor diff or chat seen.
/// </summary>
public sealed class AiOrchestratorCachedPathTests
{
    private const string CachedPromptContentHash =
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    private const string BuilderPromptContentHash =
        "feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";

    [Fact]
    public async Task cache_hit_stamps_PromptContentHash_from_stored_AiJob()
    {
        // Arrange: build an orchestrator over an in-memory AiJob repository
        // seeded with a single succeeded job whose Provenance has the cached
        // PromptContentHash. The prompt builder is stubbed to return a
        // DIFFERENT hash so we can prove the cached path returned the
        // stored hash (and not the freshly-built one).
        var config = AiProviderConfig.CreateDefault();
        var repository = new InMemoryAiJobRepository(config);

        const string idempotencyKey = "orchestrator-cached-path-1";
        var userId = Guid.NewGuid();
        var farmId = Guid.NewGuid();

        var cachedJob = MakeSucceededAiJobWithPromptHash(
            idempotencyKey: idempotencyKey,
            userId: userId,
            farmId: farmId,
            promptContentHash: CachedPromptContentHash);

        await repository.AddAsync(cachedJob);

        var orchestrator = new AiOrchestrator(
            providers: new[] { new InertAiProvider(AiProviderType.Gemini), new InertAiProvider(AiProviderType.Sarvam) },
            aiJobRepository: repository,
            breakerRegistry: new AiCircuitBreakerRegistry(),
            failureClassifier: new AiFailureClassifier(),
            attemptCostEstimator: new AiAttemptCostEstimator(),
            promptBuilder: new StubPromptBuilder(BuilderPromptContentHash),
            logger: NullLogger<AiOrchestrator>.Instance);

        await using var payload = new MemoryStream(new byte[] { 0x01, 0x02 });

        // Act
        var execution = await orchestrator.ParseVoiceWithFallbackAsync(
            userId: userId,
            farmId: farmId,
            audioStream: payload,
            mimeType: "audio/webm",
            systemPrompt: "system",
            idempotencyKey: idempotencyKey,
            ct: CancellationToken.None);

        // Assert: the cached path returned with the STORED hash, not the
        // builder's freshly computed hash and not null. This is the core
        // contract handlers downstream rely on at user-Confirm time.
        execution.Result.Success.Should().BeTrue();
        execution.Result.PromptContentHash.Should().NotBeNull();
        execution.Result.PromptContentHash.Should().Be(CachedPromptContentHash);
        execution.Result.PromptContentHash.Should().NotBe(BuilderPromptContentHash);

        // Cache hit also returns the cached job's id, not a freshly created one.
        execution.JobId.Should().Be(cachedJob.Id);
    }

    // ---- helpers ----

    /// <summary>
    /// Builds an <see cref="AiJob"/> in the succeeded state with the supplied
    /// <paramref name="promptContentHash"/> stamped on its Provenance. The
    /// orchestrator's cached-path check (<c>Status == Succeeded</c> +
    /// non-empty <c>NormalizedResultJson</c>) requires both, so we add a
    /// successful attempt and call <c>MarkSucceeded</c>.
    /// </summary>
    private static AiJob MakeSucceededAiJobWithPromptHash(
        string idempotencyKey,
        Guid userId,
        Guid farmId,
        string promptContentHash)
    {
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v1",
            promptContentHash: promptContentHash,
            appVersion: "1.0.0");

        var job = AiJob.Create(
            id: Guid.NewGuid(),
            idempotencyKey: idempotencyKey,
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: userId,
            farmId: farmId,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: voiceProvenance);

        var attempt = job.AddAttempt(AiProviderType.Gemini);
        attempt.RecordSuccess(
            rawResponse: """{"confidence":0.9,"fullTranscript":"cached"}""",
            latencyMs: 42,
            tokens: null,
            confidence: 0.9m);
        job.MarkSucceeded(
            normalizedResultJson: """{"confidence":0.9,"fullTranscript":"cached"}""",
            successfulAttempt: attempt);
        return job;
    }

    /// <summary>
    /// Minimal <see cref="IAiPromptBuilder"/> double whose only contract is to
    /// expose a known <see cref="CurrentVoicePromptContentHash"/> — the
    /// orchestrator reads this on the cached path and passes it as the
    /// fallback to <c>TryReturnCachedVoiceResult</c>. We deliberately set it
    /// to a DIFFERENT value than the stored hash so the test fails loudly if
    /// the orchestrator ever returns the builder hash on a cache hit.
    /// </summary>
    private sealed class StubPromptBuilder : IAiPromptBuilder
    {
        public StubPromptBuilder(string currentHash)
        {
            CurrentVoicePromptContentHash = currentHash;
        }

        public string CurrentVoicePromptContentHash { get; }

        public string BuildVoiceParsingPrompt(VoiceParseContext context) => "stub-voice-prompt";
        public string BuildReceiptExtractionPrompt() => "stub-receipt-prompt";
        public string BuildPattiExtractionPrompt(string cropName) => "stub-patti-prompt";
    }

    /// <summary>
    /// Inert provider that never returns successfully — guards the test
    /// against the orchestrator slipping past the cache and invoking a
    /// provider (which would mean the cache check failed). If the cached
    /// path were broken, the orchestrator would call this and the test
    /// would either hang or fail elsewhere; the explicit PromptContentHash
    /// assertion is the primary signal.
    /// </summary>
    private sealed class InertAiProvider : IAiProvider
    {
        public InertAiProvider(AiProviderType type)
        {
            ProviderType = type;
        }

        public AiProviderType ProviderType { get; }

        public bool CanHandle(AiOperationType operation) => true;

        public Task<bool> HealthCheckAsync(CancellationToken ct = default) => Task.FromResult(true);

        public Task<VoiceParseCanonicalResult> ParseVoiceAsync(
            Stream audioStream, string mimeType, string languageHint, string systemPrompt, CancellationToken ct = default)
            => throw new InvalidOperationException(
                "Cached path should not invoke any AI provider for a succeeded AiJob.");

        public Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
            Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default)
            => throw new InvalidOperationException("Not exercised by this test.");

        public Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
            Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default)
            => throw new InvalidOperationException("Not exercised by this test.");
    }
}
