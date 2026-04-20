namespace ShramSafal.Application.UseCases.AI.ExtractPattiImage;

public sealed record ExtractPattiImageCommand(
    Guid UserId,
    Guid FarmId,
    string CropName,
    Stream ImageStream,
    string MimeType,
    string? IdempotencyKey);
