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
        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — threaded into the AiJob's
        // Provenance.AppVersion stamp. Defaults to "unknown" when callers
        // (legacy tests or pre-spine entry points) don't supply one.
        string clientAppVersion = "unknown",
        CancellationToken ct = default);

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4 — 2-stage voice
    /// pipeline (transcribe → structure). The transcriber and structurer
    /// are resolved per the active <c>AiProviderConfig</c> tuple
    /// (<c>TranscriberProvider</c> / <c>StructurerProvider</c>); when the
    /// tuple collapses to a single provider OR the transcriber call fails
    /// in a fallback-eligible way, the orchestrator routes to the legacy
    /// single-call multimodal path (<see cref="ParseVoiceWithFallbackAsync"/>)
    /// without losing the AiJob.
    ///
    /// <para>
    /// Compared to <see cref="ParseVoiceWithFallbackAsync"/>, this method
    /// additionally accepts <paramref name="capturedAtUtc"/> (threaded
    /// into the structurer prompt's <c>{{captured_at}}</c> placeholder so
    /// the model can resolve "yesterday"/"आज" relative to capture time
    /// rather than wall-clock time) and rebuilds the structurer prompt
    /// from the supplied <see cref="VoiceParseContext"/>.
    /// </para>
    /// </summary>
    Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ParseVoiceTwoStageAsync(
        Guid userId,
        Guid farmId,
        Stream audioStream,
        string mimeType,
        VoiceParseContext promptContext,
        string idempotencyKey,
        string languageHint = "mr-IN",
        DateTime? capturedAtUtc = null,
        int? inputSpeechDurationMs = null,
        int? inputRawDurationMs = null,
        string? segmentMetadataJson = null,
        string? requestPayloadHash = null,
        string clientAppVersion = "unknown",
        CancellationToken ct = default);

    Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractReceiptWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        // Codex cross-verification 2026-05-15 MAJOR-2: threaded into the
        // receipt AiJob's Provenance.AppVersion stamp. Defaults to
        // "unknown" so legacy callers keep compiling.
        string clientAppVersion = "unknown",
        CancellationToken ct = default);

    Task<(ReceiptExtractCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> ExtractPattiWithFallbackAsync(
        Guid userId,
        Guid farmId,
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        string idempotencyKey,
        // Codex cross-verification 2026-05-15 MAJOR-2: see ExtractReceipt above.
        string clientAppVersion = "unknown",
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
