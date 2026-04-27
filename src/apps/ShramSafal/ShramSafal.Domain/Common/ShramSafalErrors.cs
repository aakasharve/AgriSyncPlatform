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
    public static readonly Error PlannedActivityNotFound = new("ShramSafal.PlannedActivityNotFound", "Planned activity was not found.");
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

    // --- CEI Phase 2 §4.5 (Tests) ---------------------------------------------------------
    public static readonly Error TestProtocolNotFound = new("ShramSafal.TestProtocolNotFound", "Test protocol was not found.");
    public static readonly Error TestInstanceNotFound = new("ShramSafal.TestInstanceNotFound", "Test instance was not found.");
    public static readonly Error TestRoleNotAllowed = new("ShramSafal.TestRoleNotAllowed", "Role is not allowed to perform this action on a test.");
    public static readonly Error TestInvalidState = new("ShramSafal.TestInvalidState", "Test instance is not in a valid state for this action.");
    public static readonly Error TestAttachmentInvalid = new("ShramSafal.TestAttachmentInvalid", "Attachment is missing, not finalized, or not linked to this test instance.");

    // --- CEI Phase 3 §4.6 (Compliance) -------------------------------------------------
    public static readonly Error ComplianceSignalNotFound = new("ShramSafal.ComplianceSignalNotFound", "Compliance signal was not found.");
    public static readonly Error ComplianceSignalRoleNotAllowed = new("ShramSafal.ComplianceSignalRoleNotAllowed", "Role is not allowed to perform this action on a compliance signal.");
    public static readonly Error ComplianceSignalInvalidState = new("ShramSafal.ComplianceSignalInvalidState", "Compliance signal is not in a valid state for this action.");
    public static readonly Error ComplianceSignalNoteRequired = new("ShramSafal.ComplianceSignalNoteRequired", "A resolution note of at least 3 characters is required.");

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ------------------------------------------
    public static readonly Error JobCardNotFound = new("ShramSafal.JobCardNotFound", "Job card was not found.");
    public static readonly Error JobCardRoleNotAllowed = new("ShramSafal.JobCardRoleNotAllowed", "Role is not allowed to perform this action on a job card.");
    public static readonly Error JobCardWorkerNotMember = new("ShramSafal.JobCardWorkerNotMember", "The specified worker is not an active member of this farm.");
    public static readonly Error JobCardInvalidState = new("ShramSafal.JobCardInvalidState", "Job card is not in a valid state for this action.");
    public static readonly Error JobCardDailyLogMismatch = new("ShramSafal.JobCardDailyLogMismatch", "The daily log does not belong to the same farm and plot as this job card.");
    public static readonly Error JobCardActivityTypeMismatch = new("ShramSafal.JobCardActivityTypeMismatch", "No task in the daily log matches an activity type on this job card.");
    public static readonly Error UseSettleJobCardForLabourPayout = new("ShramSafal.UseSettleJobCardForLabourPayout", "Use the settle-job-card-payout endpoint to record labour payouts. Direct labour_payout cost entries are not allowed.");

    // --- Farm Geo / Weather Anchor ---------------------------------------------------------
    public static readonly Error FarmCentreMissing = new("ShramSafal.FarmCentreMissing", "Farm has no canonical centre; draw the farm boundary before requesting weather.");
    public static readonly Error WeatherProviderNotConfigured = new("ShramSafal.WeatherProviderNotConfigured", "Weather provider is not configured on this server.");
}
