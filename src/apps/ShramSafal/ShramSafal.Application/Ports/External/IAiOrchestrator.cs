using ShramSafal.Application.Contracts.Dtos;
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

    // Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7 Task 3.4) — streaming voice parse.
    // Mirrors the lean ParseVoiceWithOverrideAsync path (no AiJob, no idempotency,
    // no breaker bookkeeping) and yields ParseStreamEvent values as Gemini emits
    // partial JSON. Text events fire per provider chunk; field_complete and
    // complete events fire as the underlying PartialJsonParser balances tokens.
    // Provider exceptions are surfaced as a terminal error event and the
    // enumeration ends — callers do not need to wrap in try/catch.
    IAsyncEnumerable<ParseStreamEvent> ParseVoiceStreamAsync(
        string transcript,
        VoiceParseContext context,
        string? scenarioId,
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
