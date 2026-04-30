using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Domain.Common;

/// <summary>
/// Canonical static <see cref="Error"/> instances surfaced by ShramSafal
/// application handlers. Each error is tagged with an
/// <see cref="ErrorKind"/> so endpoint adapters can map it to the
/// canonical RFC 7807 status code via <c>ProblemDetailsMapper</c>.
///
/// Heuristic used during the Sub-plan 03 Task 2 audit:
/// <list type="bullet">
/// <item><c>NotFound</c> — message contains "not found".</item>
/// <item><c>Conflict</c> — message describes a state precondition or
/// duplication ("already X", "overlap", "is not in a valid state").</item>
/// <item><c>Forbidden</c> — message refers to role/ownership/allowed.</item>
/// <item><c>Validation</c> — message describes bad caller input
/// ("required", "invalid", "must be", "does not match").</item>
/// <item><c>Internal</c> — server-side fault (AI/provider failure,
/// missing config). Default for everything else.</item>
/// </list>
/// </summary>
public static class ShramSafalErrors
{
    // --- NotFound ---------------------------------------------------------------------------
    public static readonly Error FarmNotFound = Error.NotFound("ShramSafal.FarmNotFound", "Farm was not found.");
    public static readonly Error PlotNotFound = Error.NotFound("ShramSafal.PlotNotFound", "Plot was not found.");
    public static readonly Error CropCycleNotFound = Error.NotFound("ShramSafal.CropCycleNotFound", "Crop cycle was not found.");
    public static readonly Error DailyLogNotFound = Error.NotFound("ShramSafal.DailyLogNotFound", "Daily log was not found.");
    public static readonly Error PlannedActivityNotFound = Error.NotFound("ShramSafal.PlannedActivityNotFound", "Planned activity was not found.");
    public static readonly Error CostEntryNotFound = Error.NotFound("ShramSafal.CostEntryNotFound", "Cost entry was not found.");
    public static readonly Error DayLedgerNotFound = Error.NotFound("ShramSafal.DayLedgerNotFound", "Day ledger was not found.");
    public static readonly Error AttachmentNotFound = Error.NotFound("ShramSafal.AttachmentNotFound", "Attachment was not found.");
    public static readonly Error ScheduleTemplateNotFound = Error.NotFound("ShramSafal.ScheduleTemplateNotFound", "Schedule template was not found.");
    public static readonly Error ScheduleSubscriptionNotFound = Error.NotFound("ShramSafal.ScheduleSubscriptionNotFound", "Schedule subscription was not found.");

    // --- Conflict (state preconditions / duplication) ---------------------------------------
    public static readonly Error CropCycleOverlap = Error.Conflict("ShramSafal.CropCycleOverlap", "Crop cycle dates overlap an existing cycle on this plot.");
    public static readonly Error DuplicateLogRequest = Error.Conflict("ShramSafal.DuplicateLogRequest", "A log already exists for this idempotency key.");
    public static readonly Error AttachmentAlreadyFinalized = Error.Conflict("ShramSafal.AttachmentAlreadyFinalized", "Attachment is already finalized and immutable.");
    public static readonly Error ScheduleAlreadyAdopted = Error.Conflict("ShramSafal.ScheduleAlreadyAdopted", "An active schedule subscription already exists for this plot-crop-cycle.");
    public static readonly Error ScheduleTemplateUnpublished = Error.Conflict("ShramSafal.ScheduleTemplateUnpublished", "Schedule template has not been published.");
    public static readonly Error ScheduleNotActive = Error.Conflict("ShramSafal.ScheduleNotActive", "Schedule subscription is not active and cannot transition.");

    // --- Forbidden (role / ownership / not-allowed) ----------------------------------------
    public static readonly Error Forbidden = Error.Forbidden("ShramSafal.Forbidden", "User is not allowed to modify this farm.");
    public static readonly Error VerificationTransitionNotAllowedForRole =
        Error.Forbidden("ShramSafal.VerificationTransitionNotAllowedForRole", "Transition not allowed for role.");

    // --- Validation (bad caller input) -----------------------------------------------------
    public static readonly Error InvalidAmount = Error.Validation("ShramSafal.InvalidAmount", "Amount must be greater than zero.");
    public static readonly Error InvalidVerificationReason = Error.Validation("ShramSafal.InvalidVerificationReason", "Reason is required for disputed verification.");
    public static readonly Error MissingVoiceTranscript = Error.Validation("ShramSafal.MissingVoiceTranscript", "Text transcript is required for AI parsing.");
    public static readonly Error InvalidCommand = Error.Validation("ShramSafal.InvalidCommand", "Request is invalid.");
    public static readonly Error ScheduleTemplateCropMismatch = Error.Validation("ShramSafal.ScheduleTemplateCropMismatch", "Schedule template crop does not match the crop cycle.");

    // --- Internal (server-side fault / config / external service) --------------------------
    public static readonly Error InvalidAiResponse = Error.Internal("ShramSafal.InvalidAiResponse", "AI parser returned an invalid response payload.");
    public static readonly Error AiParsingFailed = Error.Internal("ShramSafal.AiParsingFailed", "Voice parsing failed.");

    // --- CEI Phase 2 §4.5 (Tests) ----------------------------------------------------------
    public static readonly Error TestProtocolNotFound = Error.NotFound("ShramSafal.TestProtocolNotFound", "Test protocol was not found.");
    public static readonly Error TestInstanceNotFound = Error.NotFound("ShramSafal.TestInstanceNotFound", "Test instance was not found.");
    public static readonly Error TestRoleNotAllowed = Error.Forbidden("ShramSafal.TestRoleNotAllowed", "Role is not allowed to perform this action on a test.");
    public static readonly Error TestInvalidState = Error.Conflict("ShramSafal.TestInvalidState", "Test instance is not in a valid state for this action.");
    public static readonly Error TestAttachmentInvalid = Error.Validation("ShramSafal.TestAttachmentInvalid", "Attachment is missing, not finalized, or not linked to this test instance.");

    // --- CEI Phase 3 §4.6 (Compliance) -----------------------------------------------------
    public static readonly Error ComplianceSignalNotFound = Error.NotFound("ShramSafal.ComplianceSignalNotFound", "Compliance signal was not found.");
    public static readonly Error ComplianceSignalRoleNotAllowed = Error.Forbidden("ShramSafal.ComplianceSignalRoleNotAllowed", "Role is not allowed to perform this action on a compliance signal.");
    public static readonly Error ComplianceSignalInvalidState = Error.Conflict("ShramSafal.ComplianceSignalInvalidState", "Compliance signal is not in a valid state for this action.");
    public static readonly Error ComplianceSignalNoteRequired = Error.Validation("ShramSafal.ComplianceSignalNoteRequired", "A resolution note of at least 3 characters is required.");

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ----------------------------------------------
    public static readonly Error JobCardNotFound = Error.NotFound("ShramSafal.JobCardNotFound", "Job card was not found.");
    public static readonly Error JobCardRoleNotAllowed = Error.Forbidden("ShramSafal.JobCardRoleNotAllowed", "Role is not allowed to perform this action on a job card.");
    public static readonly Error JobCardWorkerNotMember = Error.Validation("ShramSafal.JobCardWorkerNotMember", "The specified worker is not an active member of this farm.");
    public static readonly Error JobCardInvalidState = Error.Conflict("ShramSafal.JobCardInvalidState", "Job card is not in a valid state for this action.");
    public static readonly Error JobCardDailyLogMismatch = Error.Validation("ShramSafal.JobCardDailyLogMismatch", "The daily log does not belong to the same farm and plot as this job card.");
    public static readonly Error JobCardActivityTypeMismatch = Error.Validation("ShramSafal.JobCardActivityTypeMismatch", "No task in the daily log matches an activity type on this job card.");
    public static readonly Error UseSettleJobCardForLabourPayout = Error.Forbidden("ShramSafal.UseSettleJobCardForLabourPayout", "Use the settle-job-card-payout endpoint to record labour payouts. Direct labour_payout cost entries are not allowed.");

    // --- Farm Geo / Weather Anchor ---------------------------------------------------------
    public static readonly Error FarmCentreMissing = Error.Conflict("ShramSafal.FarmCentreMissing", "Farm has no canonical centre; draw the farm boundary before requesting weather.");
    public static readonly Error WeatherProviderNotConfigured = Error.Internal("ShramSafal.WeatherProviderNotConfigured", "Weather provider is not configured on this server.");
}
