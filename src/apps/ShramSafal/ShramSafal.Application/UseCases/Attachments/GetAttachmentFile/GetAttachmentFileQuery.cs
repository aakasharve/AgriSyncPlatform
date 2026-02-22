namespace ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;

public sealed record GetAttachmentFileQuery(Guid AttachmentId, Guid RequestedByUserId);
