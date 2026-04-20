using ShramSafal.Domain.AI;

namespace ShramSafal.Application.UseCases.AI.CreateDocumentSession;

public sealed record CreateDocumentSessionCommand(
    Guid UserId,
    Guid FarmId,
    DocumentType DocumentType,
    Stream ImageStream,
    string MimeType,
    string? CropName,
    string? IdempotencyKey);
