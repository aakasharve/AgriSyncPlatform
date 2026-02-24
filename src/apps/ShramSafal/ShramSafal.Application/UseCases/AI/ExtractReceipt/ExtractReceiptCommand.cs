namespace ShramSafal.Application.UseCases.AI.ExtractReceipt;

public sealed record ExtractReceiptCommand(
    Guid UserId,
    Guid FarmId,
    Stream ImageStream,
    string MimeType,
    string? IdempotencyKey);
