namespace ShramSafal.Application.UseCases.Attachments.GetAttachment;

public sealed record GetAttachmentQuery(Guid AttachmentId, Guid RequestedByUserId);
