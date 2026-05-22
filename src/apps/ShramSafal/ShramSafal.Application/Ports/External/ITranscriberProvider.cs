using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Single-role port for the "audio → text" step. SARVAM_PRIMARY_VOICE_PIPELINE
/// Task 1.9 split <see cref="IAiProvider"/> into three single-role ports
/// (transcribe / structure / OCR) per Safeguard S1 so the orchestrator can
/// compose pipelines (e.g. Sarvam-transcribe → Gemini-structure) without
/// every adapter implementing every operation.
/// </summary>
public interface ITranscriberProvider
{
    /// <summary>
    /// Provider identity. The orchestrator uses this to disambiguate which
    /// adapter produced a transcript when multiple transcribers participate.
    /// </summary>
    AiProviderType ProviderType { get; }

    /// <summary>
    /// True when the provider supports server-side streaming (incremental
    /// transcripts as they're produced). False forces the caller onto the
    /// blocking <see cref="TranscribeAsync"/> path.
    /// </summary>
    bool SupportsStreaming { get; }

    /// <summary>
    /// Blocking transcribe. Returns a single canonical <see cref="TranscribeResult"/>
    /// once the provider has consumed the full audio stream. Implementations
    /// MUST stamp <see cref="TranscribeResult.ProviderModelVersion"/> with the
    /// wire-level model identifier so Provenance stays auditable.
    /// </summary>
    /// <param name="audio">Audio payload. Caller owns the stream.</param>
    /// <param name="mimeType">MIME type of the audio (e.g. <c>audio/webm</c>).</param>
    /// <param name="languageHint">BCP-47 hint (e.g. <c>mr-IN</c>). Provider may auto-detect.</param>
    /// <param name="mode">
    /// Output mode discriminator. The plan body documents the valid set
    /// (<c>codemix</c>, <c>verbatim</c>, <c>english</c>, …); validation lives
    /// in the orchestrator, not the port.
    /// </param>
    Task<TranscribeResult> TranscribeAsync(
        Stream audio,
        string mimeType,
        string languageHint,
        string mode,
        CancellationToken ct);

    /// <summary>
    /// Streaming transcribe. Yields incremental transcript chunks. Providers
    /// without native streaming SHOULD throw <see cref="NotSupportedException"/>
    /// — the orchestrator falls back to <see cref="TranscribeAsync"/> when
    /// <see cref="SupportsStreaming"/> is false rather than iterating an
    /// empty enumerable.
    /// </summary>
    IAsyncEnumerable<string> TranscribeStreamAsync(
        Stream audio,
        string mimeType,
        string languageHint,
        string mode,
        CancellationToken ct);
}
