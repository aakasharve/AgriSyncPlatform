namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

public sealed record CreateAttachmentCommand(
    Guid FarmId,
    Guid UploadedByUserId,
    string OriginalFileName,
    string MimeType,
    long SizeBytes,
    Guid? LinkedEntityId = null,
    string? LinkedEntityType = null,
    Guid? AttachmentId = null);
