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

    /// <summary>
    /// True when this provider may be given the operation's INPUT as it arrives: for
    /// <see cref="AiOperationType.VoiceToStructuredLog"/> that means a RECORDING (audio). The orchestrator picks the
    /// primary and the fallback of every audio path through this, so a provider that answers false here can never be
    /// handed a recording.
    /// </summary>
    bool CanHandle(AiOperationType operation);

    /// <summary>
    /// 28 Nov 2026 (founder's sorting-model decision) — true when this provider may sort a TRANSCRIPT (text in, JSON
    /// out) for the operation. A separate question from <see cref="CanHandle"/>: Gemini answers
    /// <c>CanHandle(voice) = false</c> (it never receives audio, the 23 Nov order) and
    /// <c>CanStructureTranscript(voice) = true</c> (it may sort the words Sarvam heard). The orchestrator resolves the
    /// sorting provider and its backup through this, and only ever hands them <c>text/plain</c>.
    /// Default: the same answer as <see cref="CanHandle"/>, so a provider that takes audio can also sort text.
    /// </summary>
    bool CanStructureTranscript(AiOperationType operation) => CanHandle(operation);

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
