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
    // spec: 2026-08-25-prod-cutover-waves (voice archive path). The client mints the retained
    // clip id, so the id space is shared by every account. An id already held by ANOTHER
    // account must never be answered with the success a repeat upload by its owner gets:
    // that would acknowledge a recording the server did not store for the caller.
    public static readonly Error RetainedClipIdTaken = Error.Conflict("ShramSafal.RetainedClipIdTaken", "This recording id belongs to another account.");
    public static readonly Error ScheduleAlreadyAdopted = Error.Conflict("ShramSafal.ScheduleAlreadyAdopted", "An active schedule subscription already exists for this plot-crop-cycle.");
    public static readonly Error ScheduleTemplateUnpublished = Error.Conflict("ShramSafal.ScheduleTemplateUnpublished", "Schedule template has not been published.");
    public static readonly Error ScheduleNotActive = Error.Conflict("ShramSafal.ScheduleNotActive", "Schedule subscription is not active and cannot transition.");

    // spec: pre-launch-repair L2b (R-1; founder D-41 phase A). A money entry's id is now DERIVED on the
    // phone from its source (a bill line, a log entry), so a repeat of the same source re-sends the same id.
    // The same id from the same farm and the same person is that entry again and is answered with the stored
    // entry (AddCostEntryHandler). The same id from a DIFFERENT farm or a different person is not the same
    // entry and can never become one: refused with this code, never stored twice, never retried.
    // THREE SEGMENTS for the same reason as LabourAssignmentConflict below: the last one normalises to
    // CONFLICT, which every phone already shipped classifies PERMANENT (doctrine P11).
    public static readonly Error CostEntryIdConflict = Error.Conflict(
        "ShramSafal.CostEntry.Conflict",
        "This money entry id is already recorded on another farm or by another person. It was not saved again.");

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
    // spec: plr-d10 I27 (founder D-46 §3: "If someone changes the record while it is being
    // reviewed, show the updated version before accepting confirmation"). The confirm named the
    // record version the reviewer saw and the record has changed since: nothing is confirmed, so
    // he sees the new version first. THREE SEGMENTS for the same reason as LabourAssignmentConflict
    // below: the tail CONFLICT is PERMANENT on every shipped phone, so the row is parked for him
    // (P10), never retried for ever (P11). Only phones that send logVersion can reach it.
    public static readonly Error LogChangedSinceReview = Error.Conflict(
        "ShramSafal.LogVersion.Conflict",
        "This record changed after it was opened for review. Look at the new version before confirming it.");

    // spec: plr-d10 (lane F1). The content document (what Sathi understood) does not have the
    // structure the contract states — a key it does not know, a bucket that is not a list of
    // items with an id, or more than the size cap. THREE SEGMENTS, tail INVALIDCOMMAND, so a
    // phone parks the row for the farmer to see (P10) instead of retrying it for ever (P11).
    // The phone's own enqueue applies the same rules, so a real phone cannot reach this.
    public static readonly Error LogContentInvalid = Error.Validation(
        "ShramSafal.LogContent.InvalidCommand",
        "The details of this record are not in the shape the app sends. Nothing was saved.");

    // spec: plr-d10 (lane F1, review N12). A record saved at the हजेरी door holds labour only
    // (B002), so what Sathi understood for it is never revised. THREE SEGMENTS, tail
    // INVALIDCOMMAND: the phone parks the queued edit where the farmer sees it, never drops it.
    public static readonly Error LabourDoorLogContent = Error.Validation(
        "ShramSafal.LabourDoorLog.InvalidCommand",
        "This record was saved at the attendance door and holds labour only; its other details cannot be changed. Nothing was saved.");

    // spec: plr-d10 (lane F1, review N1). Other edits to the same record kept landing first, every
    // time the server re-applied this one on top. Practically unreachable; THREE SEGMENTS, tail
    // CONFLICT, so the phone shows it rather than dropping it.
    public static readonly Error LogContentVersionConflict = Error.Conflict(
        "ShramSafal.LogContent.Conflict",
        "This record kept changing while your edit was being saved. Nothing was saved; please try again.");

    public static readonly Error LabourAssignmentConflict = Error.Conflict(
        "ShramSafal.LabourAssignment.Conflict",
        "This labour entry is already recorded on another daily log. The same engagement cannot belong to two logs — recording it again would count the same workers twice.");

    // spec: plr-d10 I26 (founder D-34, PLR-D10 L3b). A work entry says HOW MANY people worked; naming
    // people says WHO among them. Naming more people than the work states would contradict its count,
    // and the count is never changed to fit the names (doctrine P7) — so the extra name is refused.
    // REST-only (attach / correction routes), never a sync mutation, so the RejectionPolicy tail rule
    // above does not apply; an older phone shows its generic "could not attach" for it.
    public static readonly Error AttributionExceedsHeadcount = Error.Conflict(
        "ShramSafal.Attribution.ExceedsHeadcount",
        "Every person this work entry counts is already named. Naming one more would contradict the count, and naming people never changes the count.");

    // --- Forbidden (role / ownership / not-allowed) ----------------------------------------
    public static readonly Error Forbidden = Error.Forbidden("ShramSafal.Forbidden", "User is not allowed to modify this farm.");
    // READ refusal: the caller is a member but their role may not read this
    // data (e.g. a plain Worker and the farm's crew roster). Distinct from
    // Forbidden, whose text says "modify" and is a WRITE refusal.
    public static readonly Error ReadNotAllowed =
        Error.Forbidden("ShramSafal.ReadNotAllowed", "User is not allowed to view this information.");
    public static readonly Error VerificationTransitionNotAllowedForRole =
        Error.Forbidden("ShramSafal.VerificationTransitionNotAllowedForRole", "Transition not allowed for role.");

    // Voice Diary ship (voice-diary-e2e-2026-05-17) — returned by
    // ParseVoiceInputHandler + PersistVoiceClipRetainedHandler when the
    // FullHistoryJournal consent toggle is OFF. Frontend renders a
    // consent-required CTA pointing at Settings.
    // Defence in depth on the voice archive: the clip says it was recorded before
    // the current continuous grant of cloud-save consent began.
    public static readonly Error RecordedBeforeConsent = Error.Forbidden(
        "ShramSafal.RecordedBeforeConsent",
        "This recording was made before cloud-save consent was granted.");

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

    // PLR-D10 I23 / N6 (founder D-16, 2026-10-26): "Future attendance must not be recorded as
    // completed work. Future work belongs in planning." An attendance mark dated after the farm's
    // India date is refused. THREE SEGMENTS for the same reason as LabourAssignmentConflict below:
    // RejectionPolicy.ts normalizeCode keeps the tail after the LAST dot, and INVALIDCOMMAND is in
    // PERMANENT_REJECTION_CODES on every phone already shipped (1.0.15–1.0.17), so an installed
    // phone parks the row for the farmer (P10) instead of retrying it for ever (P11). The full code
    // stays distinct so a new phone can say WHY.
    public static readonly Error AttendanceFutureDate = Error.Validation(
        "ShramSafal.AttendanceFutureDate.InvalidCommand",
        "Attendance cannot be recorded for a day that has not happened yet. Future work belongs in planning.");

    // spec: plr-d10 (lane OF-S; review of lane OF, H1) — no record of done work on a day that has not happened
    // (the farm's India day, LogDayRule). Create and move both refuse it. THREE SEGMENTS, tail InvalidCommand: every
    // shipped phone parks it for the farmer (P10/P11); the middle segment lets a new phone say why.
    public static readonly Error LogDateInFuture = Error.Validation(
        "ShramSafal.LogDateInFuture.InvalidCommand",
        "Work cannot be recorded on a day that has not happened yet. Nothing was saved.");

    // spec: plr-d10 (lane OF-S) — a move made from an older record version: someone changed the record after he
    // saw it. Refused, never applied over the newer change. Tail CONFLICT: parked on every shipped phone.
    public static readonly Error LogMoveStale = Error.Conflict(
        "ShramSafal.LogMove.Conflict",
        "This record was changed after you saw it. The move was not made; the record is as it was.");

    // spec: plr-d10 (lane OF-S) — a single-plot record must carry the season it belongs to, and no season on the
    // chosen plot covers the chosen day. Refused; the record stays where it was.
    public static readonly Error LogMoveNoCropCycle = Error.Validation(
        "ShramSafal.LogMoveNoCropCycle.InvalidCommand",
        "No crop season on that plot covers that day. The move was not made.");

    // spec: plr-d10 (lane OF-S; CTO call; fix pass 2 item 9 — one plain reason per cause, never "change those first"
    // where nothing he can do changes it). Each refuses the move WHOLE; nothing changes. Tail CONFLICT: parked on every
    // shipped phone; the middle segment lets a new phone say why.
    //
    // A हजेरी ruling names a person on this record on the old day, or marks one absent on the new day.
    public static readonly Error LogMoveAttendance = Error.Conflict(
        "ShramSafal.LogMoveAttendance.Conflict",
        "People on this entry are in that day's attendance, so it cannot be moved. Nothing was changed.");

    // A job card is linked to the record (or its money is a card's payout). No screen cancels a card, and a verified or
    // paid card can never be cancelled (JobCard.Cancel), so there is nothing for him to change first.
    public static readonly Error LogMoveJobCard = Error.Conflict(
        "ShramSafal.LogMoveJobCard.Conflict",
        "A job card is linked to this entry, so it cannot be moved. Nothing was changed.");

    // Its money was already shared out across plots (a day ledger allocation). An allocation is never undone (no
    // command removes a DayLedger), so there is nothing for him to change first.
    public static readonly Error LogMoveMoneyShared = Error.Conflict(
        "ShramSafal.LogMoveMoneyShared.Conflict",
        "This entry's money is already shared out across plots, so it cannot be moved. Nothing was changed.");

    // spec: plr-d10 (lane OF-S fix pass 2; orchestrator call) — a line of the record STATES an amount but the money made
    // from it cannot be found by its derived id: saved the old way (1.0.15–1.0.17 random ids, a pre-fix key), kept on
    // the phone, or not arrived yet. Moving the record without it would leave a false number on the old plot (P4).
    public static readonly Error LogMoveMoneyNotFound = Error.Conflict(
        "ShramSafal.LogMoveMoneyNotFound.Conflict",
        "This entry's money was saved the old way or has not arrived yet, so it cannot be moved. Nothing was changed.");

    // spec: plr-d10 (lane OF-S) — a worker-count / hours correction made against values the engagement no longer
    // holds (someone corrected it meanwhile). Refused, never written over the newer correction.
    public static readonly Error LabourCorrectionStale = Error.Conflict(
        "ShramSafal.LabourCorrection.Conflict",
        "These workers were changed after you saw them. Your change was not made; the record is as it was.");

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

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the ONE answer for a blank, malformed,
    // wrong or unknown typed farm code. It never names a farm. The endpoint sends only the code
    // ({"error":"join.code_unknown"}); the phone shows its own Marathi text for it.
    public static readonly Error JoinCodeUnknown = Error.NotFound("join.code_unknown", "No farm has this code.");

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner's membership decisions. Conflict
    // (409, with a body the phone can branch on), not Forbidden: the caller IS an owner; this one
    // decision is what cannot happen.
    public static readonly Error MembershipLastOwner = Error.Conflict(
        "membership.last_owner",
        "This would leave the farm without an active primary owner.");

    public static readonly Error MembershipWrongStatus = Error.Conflict(
        "membership.wrong_status",
        "This person's membership is not in a state where that decision applies.");
}
