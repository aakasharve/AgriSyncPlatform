using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Legacy multi-role provider port. Combines transcribe + structure + OCR
/// into a single interface, which forces every adapter to implement every
/// operation regardless of whether the underlying service supports it.
///
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9 (Safeguard S1) split this into
/// three single-role ports:
/// <list type="bullet">
///   <item><see cref="ITranscriberProvider"/> — audio → text</item>
///   <item><see cref="IStructurerProvider"/> — text → normalized JSON</item>
///   <item><see cref="IOcrProvider"/> — image → normalized JSON</item>
/// </list>
///
/// <para>
/// <b>Transition policy.</b> Both the legacy and split ports live in parallel
/// during the Phase 1 → Phase 2 transition. Existing adapters
/// (<c>SarvamAiProvider</c>, <c>GeminiAiProvider</c>) keep implementing this
/// interface; the new ports are wired in Phase 2 when the orchestrator is
/// rewritten around them. No call sites should target <see cref="IAiProvider"/>
/// in NEW code — prefer the single-role ports.
/// </para>
/// </summary>
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
