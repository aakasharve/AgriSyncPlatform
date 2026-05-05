using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

public interface IAiOrchestrator
{
    Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ParseVoiceWithFallbackAsync(
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
        CancellationToken ct = default);

    Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractReceiptWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        CancellationToken ct = default);

    Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractPattiWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        CancellationToken ct = default);

    // agrisync-prompt-ops Phase 1 — Test/eval-only path. Skips AiJob persistence,
    // idempotency, and circuit-breaker bookkeeping. Builds the voice parsing prompt
    // (or accepts a staged override), pipes a text/plain transcript to the configured
    // primary AiProvider, and returns the raw normalized JSON. Endpoint that exposes
    // this is env-gated (see ShramSafal.Api.Endpoints.AiEvalEndpoints).
    Task<EvalParseResult> ParseVoiceWithOverrideAsync(
        string transcript,
        VoiceParseContext context,
        string? promptOverride,
        string? scenarioId,
        CancellationToken ct = default);
}

public sealed record EvalParseResult(
    string ParsedJson,
    string PromptVersion,
    long ModelMs,
    bool Success,
    string? Error);
