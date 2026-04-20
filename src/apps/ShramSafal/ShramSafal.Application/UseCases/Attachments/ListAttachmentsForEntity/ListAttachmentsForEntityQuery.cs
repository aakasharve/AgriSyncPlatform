namespace ShramSafal.Application.UseCases.Attachments.ListAttachmentsForEntity;

public sealed record ListAttachmentsForEntityQuery(
    Guid LinkedEntityId,
    string LinkedEntityType,
    Guid RequestedByUserId);
