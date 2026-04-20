namespace ShramSafal.Application.Contracts.Dtos;

public sealed record AttachmentDto(
    Guid Id,
    Guid FarmId,
    Guid LinkedEntityId,
    string LinkedEntityType,
    string FileName,
    string MimeType,
    string Status,
    string? LocalPath,
    long? SizeBytes,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    DateTime? UploadedAtUtc,
    DateTime? FinalizedAtUtc);
