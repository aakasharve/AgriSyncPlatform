namespace ShramSafal.Application.UseCases.OCR.ExtractFromReceipt;

public sealed record ExtractFromReceiptCommand(Guid AttachmentId, Guid RequestedByUserId);
