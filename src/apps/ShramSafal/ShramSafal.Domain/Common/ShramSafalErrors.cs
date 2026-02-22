using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Domain.Common;

public static class ShramSafalErrors
{
    public static readonly Error FarmNotFound = new("ShramSafal.FarmNotFound", "Farm was not found.");
    public static readonly Error PlotNotFound = new("ShramSafal.PlotNotFound", "Plot was not found.");
    public static readonly Error CropCycleNotFound = new("ShramSafal.CropCycleNotFound", "Crop cycle was not found.");
    public static readonly Error DailyLogNotFound = new("ShramSafal.DailyLogNotFound", "Daily log was not found.");
    public static readonly Error DuplicateLogRequest = new("ShramSafal.DuplicateLogRequest", "A log already exists for this idempotency key.");
    public static readonly Error CostEntryNotFound = new("ShramSafal.CostEntryNotFound", "Cost entry was not found.");
    public static readonly Error AttachmentNotFound = new("ShramSafal.AttachmentNotFound", "Attachment was not found.");
    public static readonly Error AttachmentNotFinalized = new("ShramSafal.AttachmentNotFinalized", "Attachment must be finalized before this operation.");
    public static readonly Error AttachmentNotImage = new("ShramSafal.AttachmentNotImage", "Attachment is not an image.");
    public static readonly Error AttachmentUploadFailed = new("ShramSafal.AttachmentUploadFailed", "Attachment upload failed.");
    public static readonly Error AttachmentTooLarge = new("ShramSafal.AttachmentTooLarge", "Attachment exceeds configured max size.");
    public static readonly Error AttachmentFileMissing = new("ShramSafal.AttachmentFileMissing", "Attachment file is not available in storage.");
    public static readonly Error InvalidAttachmentLink = new("ShramSafal.InvalidAttachmentLink", "Attachment link target is invalid for this farm.");
    public static readonly Error OcrResultNotFound = new("ShramSafal.OcrResultNotFound", "OCR result was not found for this attachment.");
    public static readonly Error InvalidAmount = new("ShramSafal.InvalidAmount", "Amount must be greater than zero.");
    public static readonly Error InvalidVerificationReason = new("ShramSafal.InvalidVerificationReason", "Reason is required for disputed verification.");
    public static readonly Error VerificationTransitionNotAllowedForRole =
        new("ShramSafal.VerificationTransitionNotAllowedForRole", "Transition not allowed for role.");
    public static readonly Error MissingVoiceTranscript = new("ShramSafal.MissingVoiceTranscript", "Text transcript is required for AI parsing.");
    public static readonly Error InvalidAiResponse = new("ShramSafal.InvalidAiResponse", "AI parser returned an invalid response payload.");
    public static readonly Error AiParsingFailed = new("ShramSafal.AiParsingFailed", "Voice parsing failed.");
    public static readonly Error InvalidCommand = new("ShramSafal.InvalidCommand", "Request is invalid.");
}
