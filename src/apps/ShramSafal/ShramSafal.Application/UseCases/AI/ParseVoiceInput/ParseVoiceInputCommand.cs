namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

public sealed record ParseVoiceInputCommand(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string? TextTranscript,
    string? AudioBase64,
    string? AudioMimeType);
