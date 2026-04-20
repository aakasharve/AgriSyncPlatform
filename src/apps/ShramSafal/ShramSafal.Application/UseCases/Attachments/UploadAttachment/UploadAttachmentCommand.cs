namespace ShramSafal.Application.UseCases.Attachments.UploadAttachment;

public sealed record UploadAttachmentCommand(
    Guid AttachmentId,
    Stream FileStream,
    Guid UploadedByUserId,
    string? UploadedMimeType = null,
    string? ClientFileName = null,
    string? ActorRole = null,
    string? ClientCommandId = null);
