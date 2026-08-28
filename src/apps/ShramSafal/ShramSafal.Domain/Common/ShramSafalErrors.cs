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

    // 2026-08-27 prod incident (device db658ce1, 4 rejected create_daily_log
    // attempts 19:15:19-19:15:57, plus 20 cascaded add_log_task rejections). The
    // client re-asserted a labourAssignmentId that is already the PRIMARY KEY of a
    // committed ssf.labour_assignments row on a DIFFERENT daily log. It reached
    // Postgres as 23505 on PK_labour_assignments, was translated to the generic
    // "ShramSafal.SyncMutationStoreError", classified RETRYABLE by the phone, and
    // retried until the cap -- a payload no retry could ever satisfy.
    //
    // THE CODE HAS THREE SEGMENTS ON PURPOSE. RejectionPolicy.ts normalizeCode
    // keeps the tail after the LAST dot and upper-cases it, so this yields
    // "CONFLICT" -- already in PERMANENT_REJECTION_CODES (RejectionPolicy.ts:69)
    // in every client shipped since 503af2a7 (2026-05-02), which includes APK
    // v1.0.9 / versionCode 17 and the 0.9.0 build in these logs. The phones
    // already in the field therefore stop retrying and park the row in
    // REJECTED_USER_REVIEW with NO client change (doctrine P11), and its orphaned
    // children escalate through PARENT_UNRECOVERABLE instead of waiting on a
    // parent that will never land. A conventional two-segment code
    // ("ShramSafal.LabourAssignmentConflict") would normalize to
    // LABOURASSIGNMENTCONFLICT, miss the set, and keep looping. DO NOT "tidy"
    // this back to two segments without shipping a client first.
    public static readonly Error LabourAssignmentConflict = Error.Conflict(
        "ShramSafal.LabourAssignment.Conflict",
        "This labour entry is already recorded on another daily log. The same engagement cannot belong to two logs — recording it again would count the same workers twice.");

    // --- Forbidden (role / ownership / not-allowed) ----------------------------------------
    public static readonly Error Forbidden = Error.Forbidden("ShramSafal.Forbidden", "User is not allowed to modify this farm.");
    public static readonly Error VerificationTransitionNotAllowedForRole =
        Error.Forbidden("ShramSafal.VerificationTransitionNotAllowedForRole", "Transition not allowed for role.");

    // Voice Diary ship (voice-diary-e2e-2026-05-17) — returned by
    // ParseVoiceInputHandler + PersistVoiceClipRetainedHandler when the
    // FullHistoryJournal consent toggle is OFF. Frontend renders a
    // consent-required CTA pointing at Settings.
    public static readonly Error ConsentRequired = Error.Forbidden(
        "ShramSafal.ConsentRequired",
        "Full History Journal consent is required to retain voice notes beyond 30 days.");

    // LABOUR_PHASE2 Phase 5 (founder decision O-4) — the owner tried to toggle
    // the explicit labour-record grant on a member whose ROLE already carries
    // it (owner-tier or Mukadam). Storing the flag would have changed nothing
    // and left the owner looking at a switch that does not work, so the request
    // is refused with a code the UI can branch on (doctrine P5). Conflict, not
    // Forbidden: the caller IS allowed to manage access — this particular
    // member's capability simply is not a grant to give or take.
    public static readonly Error LabourManagementCarriedByRole = Error.Conflict(
        "ShramSafal.LabourManagementCarriedByRole",
        "This member's role already allows managing labour records, so the grant cannot be changed. Change their role instead.");


    // DFES — worker-record portability. Restored during the main->dfes merge: taking
    // main's ShramSafalErrors dropped it, and the two DFES worker handlers that
    // reference it stopped compiling. Not a new decision, just one that main had
    // never seen.
    //
    // The code ends in "Forbidden" deliberately: the worker endpoints map an error code
    // with that suffix to HTTP 403, and this is an authorisation answer, not a malformed
    // request.
    public static readonly Error WorkerRecordPortabilityForbidden = Error.Forbidden(
        "ShramSafal.WorkerRecordPortabilityForbidden",
        "This worker's record cannot leave the farm that recorded it.");

    // --- Validation (bad caller input) -----------------------------------------------------
    public static readonly Error InvalidAmount = Error.Validation("ShramSafal.InvalidAmount", "Amount must be greater than zero.");
    public static readonly Error InvalidVerificationReason = Error.Validation("ShramSafal.InvalidVerificationReason", "Reason is required for disputed verification.");
    public static readonly Error MissingVoiceTranscript = Error.Validation("ShramSafal.MissingVoiceTranscript", "Text transcript is required for AI parsing.");
    public static readonly Error InvalidCommand = Error.Validation("ShramSafal.InvalidCommand", "Request is invalid.");

    // 2026-08-28. POST /shramsafal/corrections passed three client-supplied
    // strings straight into length-capped columns with no bound anywhere on the
    // path; CorrectionEvent.Record only checks non-blank. An over-long value
    // therefore reached Postgres and came back as 22001 -> DbUpdateException ->
    // an unhandled 500, not the 400 the endpoint is already wired to return.
    // REFUSED, NEVER TRUNCATED: the identifying part of a prompt version is the
    // trailing `hash:<16hex>`, so a trimmed value is byte-identical across every
    // prompt build ever shipped - a fabricated identifier (P4) stored in the one
    // table whose whole purpose is reconstructing which prompt ran (P10).
    public static readonly Error CorrectionFieldTooLong = Error.Validation(
        "ShramSafal.CorrectionFieldTooLong",
        "A correction field exceeds its stored length. The value is refused, not truncated — a shortened prompt version is not the prompt version.");
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
    public static readonly Error WeatherProviderUnavailable = Error.Internal("ShramSafal.WeatherProviderUnavailable", "Weather service is temporarily unavailable. Please try again.");

    // --- Memberships / ClaimJoin (T-IGH-03-PIPELINE-ROLLOUT) -------------------------------
    // Codes preserved verbatim (frontend + endpoint status switch depend
    // on them). The endpoint maps "join.phone_not_verified" => 403 and
    // the rest fall through to 400/401/404/409 per its own switch; the
    // ErrorKind tags here match those statuses so any future converger
    // onto ProblemDetailsMapper produces the same HTTP shape.
    public static readonly Error JoinUnauthenticated = Error.Unauthenticated("join.unauthenticated", "Caller must be authenticated.");
    public static readonly Error JoinPhoneNotVerified = Error.Forbidden("join.phone_not_verified", "Verify your phone via OTP before joining a farm.");
    public static readonly Error JoinInvalidPayload = Error.Validation("join.invalid_payload", "Scan the farm QR again.");
}
