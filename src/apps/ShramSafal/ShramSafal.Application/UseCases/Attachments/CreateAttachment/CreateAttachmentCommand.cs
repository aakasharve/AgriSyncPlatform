namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

public sealed record CreateAttachmentCommand(
    Guid FarmId,
    Guid LinkedEntityId,
    string LinkedEntityType,
    string FileName,
    string MimeType,
    Guid CreatedByUserId,
    Guid? AttachmentId = null,
    string? ActorRole = null,
    string? ClientCommandId = null);
