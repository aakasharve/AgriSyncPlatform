namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Canonical result of an <see cref="ShramSafal.Application.Ports.External.ITranscriberProvider"/>
/// transcription call. The transcriber's only job is to turn audio into text +
/// a language code + its model version; structuring the transcript into a
/// domain JSON happens in a separate <see cref="ShramSafal.Application.Ports.External.IStructurerProvider"/>
/// step (Safeguard S1, SARVAM_PRIMARY_VOICE_PIPELINE Task 1.9).
/// </summary>
public sealed record TranscribeResult
{
    /// <summary>True when the provider returned a usable transcript.</summary>
    public bool Success { get; init; }

    /// <summary>
    /// Best-effort transcript text. The active mode (codemix / verbatim /
    /// english…) is selected by the orchestrator; this field carries that
    /// mode's output. Multi-mode payloads belong on
    /// <see cref="Domain.AI.VoiceParseCanonicalResult"/> after the
    /// orchestrator merges streams.
    /// </summary>
    public string? Transcript { get; init; }

    /// <summary>
    /// BCP-47 language code (e.g. <c>mr-IN</c>, <c>hi-IN</c>) of the audio as
    /// detected by the provider. <c>null</c> when detection was inconclusive.
    /// </summary>
    public string? LanguageCode { get; init; }

    /// <summary>
    /// Wire-level model version the provider returned (e.g. <c>saaras:v3</c>,
    /// <c>gemini-2.0-flash</c>). Threaded onto the AiJob's
    /// <c>transcript_model_version</c> column for replay.
    /// </summary>
    public string? ProviderModelVersion { get; init; }

    /// <summary>
    /// Provider-supplied error message when <see cref="Success"/> is false.
    /// Free-form; the orchestrator maps to <c>AiFailureClass</c> upstream.
    /// </summary>
    public string? Error { get; init; }

    /// <summary>
    /// PLR lane V-1 fix pass (B005) — set when the failure is DETERMINISTIC for this recording, so the orchestrator
    /// must not run the same transcription again (it would re-bill every piece): <see cref="TranscribeFailureCodes"/>.
    /// <c>null</c> for an ordinary failure (the existing fallback rules apply).
    /// </summary>
    public string? FailureCode { get; init; }

    /// <summary>
    /// PLR lane V-1 — how many speech-to-text requests the recording took (1 = sent whole; more = it was split
    /// because it was longer than the provider takes in one request). 0 when unknown.
    /// </summary>
    public int Pieces { get; init; }
}

/// <summary>PLR lane V-1 fix pass (B005) — deterministic transcription failures.</summary>
public static class TranscribeFailureCodes
{
    /// <summary>The recording is longer than the server will split; it was not transcribed at all.</summary>
    public const string AudioTooLong = "audio_too_long";

    /// <summary>One piece of a split recording failed after its own retry; the whole transcription failed.</summary>
    public const string PartFailed = "stt_part_failed";
}
