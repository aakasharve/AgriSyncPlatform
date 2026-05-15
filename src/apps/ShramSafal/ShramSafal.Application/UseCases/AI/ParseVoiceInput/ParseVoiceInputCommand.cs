namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

public sealed record ParseVoiceInputCommand(
    Guid UserId,
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string? TextTranscript,
    string? AudioBase64,
    string? AudioMimeType,
    string? IdempotencyKey,
    string? ContextJson,
    int? InputSpeechDurationMs,
    int? InputRawDurationMs,
    string? SegmentMetadataJson,
    string? RequestPayloadHash,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — client app version sourced from the
    // X-App-Version header at the endpoint (fallback "unknown"). Threaded
    // through to the AiJob's Provenance.AppVersion and surfaced on the
    // canonical voice parse result so the downstream Confirm-time write
    // (CreateDailyLogHandler) can stamp the same client version.
    string ClientAppVersion = "unknown");
