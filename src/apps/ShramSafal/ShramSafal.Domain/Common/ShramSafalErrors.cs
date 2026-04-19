using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Domain.Common;

public static class ShramSafalErrors
{
    public static readonly Error FarmNotFound = new("ShramSafal.FarmNotFound", "Farm was not found.");
    public static readonly Error PlotNotFound = new("ShramSafal.PlotNotFound", "Plot was not found.");
    public static readonly Error CropCycleNotFound = new("ShramSafal.CropCycleNotFound", "Crop cycle was not found.");
    public static readonly Error CropCycleOverlap = new("ShramSafal.CropCycleOverlap", "Crop cycle dates overlap an existing cycle on this plot.");
    public static readonly Error DailyLogNotFound = new("ShramSafal.DailyLogNotFound", "Daily log was not found.");
    public static readonly Error DuplicateLogRequest = new("ShramSafal.DuplicateLogRequest", "A log already exists for this idempotency key.");
    public static readonly Error CostEntryNotFound = new("ShramSafal.CostEntryNotFound", "Cost entry was not found.");
    public static readonly Error DayLedgerNotFound = new("ShramSafal.DayLedgerNotFound", "Day ledger was not found.");
    public static readonly Error AttachmentNotFound = new("ShramSafal.AttachmentNotFound", "Attachment was not found.");
    public static readonly Error AttachmentAlreadyFinalized = new("ShramSafal.AttachmentAlreadyFinalized", "Attachment is already finalized and immutable.");
    public static readonly Error Forbidden = new("ShramSafal.Forbidden", "User is not allowed to modify this farm.");
    public static readonly Error InvalidAmount = new("ShramSafal.InvalidAmount", "Amount must be greater than zero.");
    public static readonly Error InvalidVerificationReason = new("ShramSafal.InvalidVerificationReason", "Reason is required for disputed verification.");
    public static readonly Error VerificationTransitionNotAllowedForRole =
        new("ShramSafal.VerificationTransitionNotAllowedForRole", "Transition not allowed for role.");
    public static readonly Error MissingVoiceTranscript = new("ShramSafal.MissingVoiceTranscript", "Text transcript is required for AI parsing.");
    public static readonly Error InvalidAiResponse = new("ShramSafal.InvalidAiResponse", "AI parser returned an invalid response payload.");
    public static readonly Error AiParsingFailed = new("ShramSafal.AiParsingFailed", "Voice parsing failed.");
    public static readonly Error InvalidCommand = new("ShramSafal.InvalidCommand", "Request is invalid.");
    public static readonly Error ScheduleTemplateNotFound = new("ShramSafal.ScheduleTemplateNotFound", "Schedule template was not found.");
    public static readonly Error ScheduleSubscriptionNotFound = new("ShramSafal.ScheduleSubscriptionNotFound", "Schedule subscription was not found.");
    public static readonly Error ScheduleAlreadyAdopted = new("ShramSafal.ScheduleAlreadyAdopted", "An active schedule subscription already exists for this plot-crop-cycle.");
    public static readonly Error ScheduleTemplateUnpublished = new("ShramSafal.ScheduleTemplateUnpublished", "Schedule template has not been published.");
    public static readonly Error ScheduleTemplateCropMismatch = new("ShramSafal.ScheduleTemplateCropMismatch", "Schedule template crop does not match the crop cycle.");
    public static readonly Error ScheduleNotActive = new("ShramSafal.ScheduleNotActive", "Schedule subscription is not active and cannot transition.");
}
