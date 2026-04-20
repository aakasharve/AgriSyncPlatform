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
    string? RequestPayloadHash);
