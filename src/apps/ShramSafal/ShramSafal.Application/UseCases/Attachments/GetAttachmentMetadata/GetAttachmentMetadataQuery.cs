namespace ShramSafal.Application.UseCases.Attachments.GetAttachmentMetadata;

public sealed record GetAttachmentMetadataQuery(
    Guid AttachmentId,
    Guid RequestedByUserId);
