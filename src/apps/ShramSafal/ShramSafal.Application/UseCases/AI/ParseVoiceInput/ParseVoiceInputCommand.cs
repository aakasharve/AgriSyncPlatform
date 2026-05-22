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
    string ClientAppVersion = "unknown",
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix (capturedAt =
    // recordedAt, Option B) — ISO-8601 UTC instant the audio was recorded
    // by MediaRecorder on the client. Threaded through to
    // IAiOrchestrator.ParseVoiceTwoStageAsync(capturedAtUtc:) and from
    // there into VoiceParseContext.CapturedAtUtc, so the structurer
    // prompt resolves "काल"/"आज"/"मागच्या सोमवारी" against the actual
    // capture moment instead of the request-receipt wall clock.
    //
    // Defaults to null so legacy clients that do not yet send the
    // recorded_at form field still compile and execute; the prompt
    // builder substitutes "unknown" downstream and the structurer is
    // instructed to omit referenced_date in that case.
    DateTime? RecordedAtUtc = null);
