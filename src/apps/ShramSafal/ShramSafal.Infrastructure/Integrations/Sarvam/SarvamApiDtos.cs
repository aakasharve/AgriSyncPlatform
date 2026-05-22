namespace ShramSafal.Infrastructure.Integrations.Sarvam;

// SARVAM_PRIMARY_VOICE_PIPELINE Task 2.9 (Safeguard S3 — Anti-Corruption
// Layer). This file is the frozen wire shape for every Sarvam API
// integration adapter in this folder. The records here mirror the shape
// returned by Sarvam's REST + WebSocket APIs (best-effort: only the
// fields AgriSync actually consumes). Adapters convert these wire DTOs
// into canonical Application-layer DTOs (TranscribeResult / StructureResult
// / OcrResult) before returning to callers, so domain code never imports
// from this namespace.
//
// Adding a new field: add it here AND extend the adapter's mapping
// method. Never reference these records from domain or application
// projects.

/// <summary>
/// Result envelope returned by <c>SarvamSttClient.TranscribeAsync</c>.
/// Wraps the Sarvam REST <c>POST /speech-to-text</c> response: a JSON
/// object with <c>transcript</c> (or <c>text</c>) and <c>language_code</c>.
/// Used by both <c>SarvamAiProvider</c> (codemix path) and the new
/// <c>SarvamVerbatimSttClient</c> (verbatim path) for the verbatim D-MOAT
/// sampler in Phase 2.
/// </summary>
internal sealed record SarvamSttResult(bool IsSuccess, string? Transcript, string? LanguageCode, string? Error)
{
    public static SarvamSttResult Success(string transcript, string? languageCode) =>
        new(true, transcript, languageCode, null);

    public static SarvamSttResult Failure(string error) =>
        new(false, null, null, error);
}

/// <summary>
/// Result envelope returned by <c>SarvamChatClient.CompleteAsync</c>.
/// Wraps the Sarvam REST <c>POST /v1/chat/completions</c> response: a JSON
/// object with <c>choices[].message.content</c>. The <c>content</c> is
/// extracted into <see cref="Content"/> as a free-form string the caller
/// usually parses as JSON via <c>GeminiJsonCleaner</c>.
/// </summary>
internal sealed record SarvamChatResult(bool IsSuccess, string? Content, string? Error)
{
    public static SarvamChatResult Success(string content) =>
        new(true, content, null);

    public static SarvamChatResult Failure(string error) =>
        new(false, null, error);
}

/// <summary>
/// Result envelope returned by <c>SarvamVisionClient.ExtractTextAsync</c>.
/// Wraps the Sarvam Vision OCR REST response (extracted text only).
/// </summary>
internal sealed record SarvamVisionResult(bool IsSuccess, string? ExtractedText, string? Error)
{
    public static SarvamVisionResult Success(string extractedText) =>
        new(true, extractedText, null);

    public static SarvamVisionResult Failure(string error) =>
        new(false, null, error);
}

/// <summary>
/// Result envelope returned by <c>SarvamStreamingSttClient.TranscribeAsync</c>
/// (the legacy non-streaming-returning shape preserved for backwards
/// compatibility with existing call sites). The canonical streaming path
/// returns <c>TranscribeResult</c> via the <c>ITranscriberProvider</c>
/// interface.
/// </summary>
internal sealed record SarvamStreamingSttResult(bool IsSuccess, string? Transcript, string? Error)
{
    public static SarvamStreamingSttResult Success(string transcript) => new(true, transcript, null);

    public static SarvamStreamingSttResult Failure(string error) => new(false, null, error);
}
