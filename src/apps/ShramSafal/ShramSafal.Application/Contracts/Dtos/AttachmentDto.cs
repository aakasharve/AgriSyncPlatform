namespace ShramSafal.Application.Contracts.Dtos;

public sealed record AttachmentDto(
    Guid Id,
    Guid FarmId,
    Guid? LinkedEntityId,
    string? LinkedEntityType,
    Guid UploadedByUserId,
    string OriginalFileName,
    string MimeType,
    long SizeBytes,
    string StoragePath,
    string Status,
    DateTime CreatedAtUtc,
    DateTime? FinalizedAtUtc);
