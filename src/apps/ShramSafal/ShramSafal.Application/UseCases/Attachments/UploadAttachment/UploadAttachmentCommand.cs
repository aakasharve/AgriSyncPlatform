namespace ShramSafal.Application.UseCases.Attachments.UploadAttachment;

public sealed record UploadAttachmentCommand(
    Guid AttachmentId,
    Guid UploadedByUserId,
    Stream FileStream);
