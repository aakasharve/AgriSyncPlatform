using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

public interface IAiProvider
{
    AiProviderType ProviderType { get; }
    Task<bool> HealthCheckAsync(CancellationToken ct = default);
    bool CanHandle(AiOperationType operation);

    Task<VoiceParseCanonicalResult> ParseVoiceAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string systemPrompt,
        CancellationToken ct = default);

    Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default);

    Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default);

    // Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7) — streaming variant. Default
    // implementation throws because only providers with native server-side
    // streaming (Gemini's :streamGenerateContent) participate; others stay on
    // the blocking ParseVoiceAsync path. Synchronous throw at call site means
    // the orchestrator can fall back without iterating an empty enumerable.
    IAsyncEnumerable<string> ParseVoiceStreamAsync(
        string transcript,
        string systemPrompt,
        CancellationToken ct = default)
        => throw new NotSupportedException(
            $"Provider '{ProviderType}' does not support streaming voice parse.");
}
