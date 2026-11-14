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

    // --- spec: plr-d10 lane L8c-1 (founder D-24 / D-24c) — planned work and reminders -------------------------------
    // Not found: a made-up id, another farm's task, and a task this person cannot see all answer the same (E4).
    public static readonly Error PlannedWorkNotFound = Error.NotFound("ShramSafal.PlannedWorkNotFound", "Planned work was not found.");

    // The codes below end in ".InvalidCommand" on purpose: every phone in the field reads the LAST segment and PARKS the
    // change for the farmer to see (RejectionPolicy), never retrying it silently (P10).

    /// <summary>The person the work is given to is not an Active member of this farm. PROPOSED words.</summary>
    public static readonly Error PlannedWorkAssigneeNotMember = Error.Validation(
        "ShramSafal.PlannedWorkAssigneeNotMember.InvalidCommand",
        "The person is not an active member of this farm, so the work cannot be given to him.");

    /// <summary>The person's seat does not cover every plot of the work. PROPOSED words.</summary>
    public static readonly Error PlannedWorkAssigneeOutsidePlots = Error.Validation(
        "ShramSafal.PlannedWorkAssigneeOutsidePlots.InvalidCommand",
        "The person does not cover all the plots of this work, so the work cannot be given to him.");

    /// <summary>The work was changed first (cancelled, or answered, or edited elsewhere): this step can no longer be applied. PROPOSED words.</summary>
    public static readonly Error PlannedWorkStateChanged = Error.Conflict(
        "ShramSafal.PlannedWorkState.InvalidCommand",
        "This work was changed first, so this step could not be applied.");

    /// <summary>The words or the shape of a task break a rule of the record (a date and a loose word, crew words without a person…).</summary>
    public static readonly Error PlannedWorkInvalid = Error.Validation(
        "ShramSafal.PlannedWork.InvalidCommand",
        "The work is not well formed.");

    // --- lane L8c-3 (founder D-24d): "काम झालं" through the real log, plot by plot. Both end ".InvalidCommand" so every shipped
    // phone parks them; Forbidden and DailyLogNotFound keep their own codes.

    /// <summary>A plot named in a complete is not a plot of the work (or none was named where one is needed).</summary>
    public static readonly Error PlannedWorkPlotsInvalid = Error.Validation(
        "ShramSafal.PlannedWorkPlots.InvalidCommand",
        "The plots named are not plots of this work.");

    /// <summary>Handed-out work needs a log on the plots done; or a log named is not on them.</summary>
    public static readonly Error PlannedWorkLogInvalid = Error.Validation(
        "ShramSafal.PlannedWorkLog.InvalidCommand",
        "The work needs a log made on the plots it was done on.");

    // --- Conflict (state preconditions / duplication) ---------------------------------------
    public static readonly Error CropCycleOverlap = Error.Conflict("ShramSafal.CropCycleOverlap", "Crop cycle dates overlap an existing cycle on this plot.");
    public static readonly Error DuplicateLogRequest = Error.Conflict("ShramSafal.DuplicateLogRequest", "A log already exists for this idempotency key.");
    public static readonly Error AttachmentAlreadyFinalized = Error.Conflict("ShramSafal.AttachmentAlreadyFinalized", "Attachment is already finalized and immutable.");
    // spec: 2026-08-25-prod-cutover-waves (voice archive path). The client mints the retained
    // clip id, so the id space is shared by every account. An id already held by ANOTHER
    // account must never be answered with the success a repeat upload by its owner gets:
    // that would acknowledge a recording the server did not store for the caller.
    public static readonly Error RetainedClipIdTaken = Error.Conflict("ShramSafal.RetainedClipIdTaken", "This recording id belongs to another account.");
    public static readonly Error ScheduleAlreadyAdopted = Error.Conflict("ShramSafal.ScheduleAlreadyAdopted", "This schedule is already followed on this plot-season.");
    // spec: plr-d10 lane L8b-2 fix round 1 (B006): a switch that names the choice it switches from, and that choice is no longer the plot's.
    public static readonly Error ScheduleChangedElsewhere = Error.Conflict("ShramSafal.ScheduleChangedElsewhere", "The plot's schedule was changed from another phone first.");
    public static readonly Error ScheduleTemplateUnpublished = Error.Conflict("ShramSafal.ScheduleTemplateUnpublished", "Schedule template has not been published.");

    // spec: plr-d10 lane L8b-1 fix round 1 (review M1) — a copy of this schedule (this source and version) is already kept:
    // the one-copy-per-version index (ix_schedule_templates_derived_version) allows no second, until lane SCH-OWN re-keys
    // it. THREE SEGMENTS, tail CONFLICT: every shipped phone classifies it PERMANENT (P11). Words PROPOSED, twinned at the
    // REST door (ScheduleTemplateEndpoints): "ही प्रत आधीच बनवलेली आहे." / this description.
    public static readonly Error ScheduleCopyExists = Error.Conflict(
        "ShramSafal.ScheduleCopy.Conflict",
        "A copy of this schedule already exists.");
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

    // spec: plr-d10 (lane OF-M fix pass 3, call 1) — a saved record's prices (a priced line's amount changed, a priced
    // line added, said again or removed) are changed only by the record's maker or by someone who reviews money (the
    // money book's rule). Anyone else's edit that changes one is refused WHOLE and nothing is saved: a backstop, since
    // his phone shows him the prices read-only. THREE SEGMENTS, tail CONFLICT: parked where he sees it, never retried
    // for ever (P10, P11). Only this build's phones send revise_log_content.
    public static readonly Error LogContentPricesNotYours = Error.Conflict(
        "ShramSafal.LogContentPrices.Conflict",
        "Only the person who made this entry, or someone who checks money entries, can change its prices. Nothing was saved.");

    // spec: plr-d10 lane BILL-1b (founder D-105 (b), answered 2026-11-08: "Only you, the main owner, can change an approved
    // bill's price. The bill then shows 'changed by owner' to everyone, you included."). A bill that carries a मंजूर stamp
    // keeps its price: a change to it from anyone but the farm's primary account holder is refused and nothing is saved.
    // THREE SEGMENTS, tail CONFLICT, like LogContentPricesNotYours: every phone already parks such a row where its owner
    // sees it, with this reason, and never retries it for ever (P10, P11). The phone says the reason in its own language by
    // this code; the sentence below is the server's English twin.
    public static readonly Error BillPriceLockedAfterApproval = Error.Conflict(
        "ShramSafal.BillPrice.Conflict",
        "This bill was approved, so only the farm's main owner can change its price. Nothing was changed.");

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

    // spec: plr-d10 (lane OF-S fix passes 3–4; orchestrator call) — the server never held the record's details as it was
    // created: a 1.0.15–1.0.17 save, or a create whose details did not fit and stayed on the phone. It cannot tell which
    // of its lines made money, so nobody can show its money follows: refused whole, from every phone (P4). Every record
    // this build makes outside the हजेरी door sends its details, even when empty.
    public static readonly Error LogMoveDetailsNotHeld = Error.Conflict(
        "ShramSafal.LogMoveDetailsNotHeld.Conflict",
        "This entry was saved by an older version of the app, or its details did not reach the server, so its money cannot be shown to move with it. Nothing was changed.");

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
    // spec: plr-d10 lane L8b-1F - an outside schedule is followed only once ShramSafal has checked it (D-82); a sample only while its crop has none (D-91 = 1).
    public static readonly Error ScheduleNotChecked = Error.Validation("ShramSafal.ScheduleNotChecked", "ShramSafal has not checked this schedule yet.");
    // spec: plr-d10 lane L8b-1F - the Own branch (a farm's own schedule) opened in SCH-OWN (D-82 = 3). ONE PRODUCER REMAINS: ScheduleLibrary.ChooseAsync, for
    // a schedule filed as Own whose row has no owner (F218). Kept also because shipped phones classify it (RejectionPolicy) and a parked row may carry it.
    public static readonly Error OwnScheduleNotOpenYet = Error.Validation("ShramSafal.OwnScheduleNotOpenYet", "Following the farm's own schedule is not open yet.");
    // spec: plr-d10 lane SCH-OWN (D-82 = 3; P4) - a farm's own schedule that stores no days has nothing to follow: adopt / migrate refuse it and write nothing
    // (never an invented stage or day). Words PROPOSED: "आधी कामं जोडा" ("add the works first").
    public static readonly Error OwnScheduleEmpty = Error.Validation("ShramSafal.OwnScheduleEmpty", "Add the works to this schedule before following it.");
    // spec: plr-d10 lane SCH-OWN (D5) - a farm's own schedule is made for a crop the farm grows (any season, past ones too). Words PROPOSED.
    public static readonly Error ScheduleCropNotOnFarm = Error.Validation("ShramSafal.ScheduleCropNotOnFarm", "This farm has no season of that crop.");
    // spec: plr-d10 lane SCH-OWN (E4; D10) - a schedule id the phone made is already taken (by anyone: the table has no row policy, so the answer is the
    // same for a row the caller may not see). THREE SEGMENTS, tail CONFLICT: every shipped phone classifies it PERMANENT (P11). Nothing is overwritten.
    public static readonly Error ScheduleIdTaken = Error.Conflict("ShramSafal.ScheduleIdTaken.Conflict", "A schedule with this id already exists.");
    // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - a plot-season follows at most 3 outside schedules plus 1 of his own. Two codes, not one with a
    // suffix: the phone keeps only the tail after the last dot of a code (RejectionPolicy.normalizeCode), so a suffix could not say which limit.
    public static readonly Error ScheduleLimitReached = Error.Conflict("ShramSafal.ScheduleLimitReached", "This plot-season already follows 3 outside schedules.");
    public static readonly Error OwnScheduleLimitReached = Error.Conflict("ShramSafal.OwnScheduleLimitReached", "This plot-season already follows 1 schedule of the farm's own.");
    // spec: plr-d10 lane L8b-3 - the plot-season follows several schedules and the request named none of them: never an arbitrary row.
    public static readonly Error ScheduleChoiceNeeded = Error.Conflict("ShramSafal.ScheduleChoiceNeeded", "This plot-season follows several schedules; say which one.");
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

    // --- lane PRV (founder D-26) — who may see one record ---------------------------------------
    // Every code below ends in ".Forbidden" or ".InvalidCommand" on purpose: every phone in the field (1.0.17 included)
    // reads the LAST segment and PARKS the change for the farmer to see (RejectionPolicy), never retrying it silently.

    /// <summary>
    /// A change (an edit, a confirmation, a correction, a photo) to a record the sender may no longer see. Nothing of it
    /// is applied; the phone keeps it, parked and visible (P10). Worded as ShramSafal's rule, never pointing at anyone.
    /// </summary>
    public static readonly Error RecordAudienceClosed = Error.Forbidden(
        "ShramSafal.RecordAudience.Forbidden",
        "By ShramSafal's rules this change could not be applied to this record. The change is kept on the phone.");

    /// <summary>Only the farm's primary account holder chooses who sees a record (D-26).</summary>
    public static readonly Error RecordAudienceNotHolder = Error.Forbidden(
        "ShramSafal.RecordAudienceHolder.Forbidden",
        "Only the farm's primary account holder chooses who sees a record.");

    /// <summary>A chosen person who holds no Active seat on the record's own farm (E4: tenancy both ways).</summary>
    public static readonly Error RecordAudienceStranger = Error.Forbidden(
        "ShramSafal.RecordAudienceMember.Forbidden",
        "Every chosen person must be an active member of this record's farm.");

    /// <summary>A record whose audience this release cannot change (a job card's payout follows its job card).</summary>
    public static readonly Error RecordAudienceNotSettable = Error.Validation(
        "ShramSafal.RecordAudienceState.InvalidCommand",
        "Who sees this record cannot be changed here.");

    // --- spec: plr-d10 lane MU-4 — plots per person ----------------------------------------------------------------
    // Ends in ".Forbidden" / ".InvalidCommand" on purpose, like PRV's codes: every phone in the field reads the LAST segment
    // and PARKS the change for the farmer to see (RejectionPolicy), never retrying it silently.

    /// <summary>
    /// A write that names a plot outside the sender's chosen plots (a record, a cost, a move, a split). Nothing of it is
    /// applied; the phone keeps it, parked and visible (P10). Worded as ShramSafal's rule, never pointing at anyone.
    /// </summary>
    public static readonly Error PlotScopeForbidden = Error.Forbidden(
        "ShramSafal.PlotScope.Forbidden",
        "By ShramSafal's rules this work could not be saved on this plot. The work is kept on the phone.");

    /// <summary>
    /// spec: plr-d10 lane F99 fix pass 1, item 11 (founder D-71) — cancelling an erasure request. Another person's request
    /// and a made-up id get this same answer (E4). PROPOSED words.
    /// </summary>
    public static readonly Error ErasureRequestNotFound = Error.NotFound(
        "ShramSafal.ErasureRequest.NotFound", "No such erasure request of yours.");

    /// <summary>Once the erasure has started, nothing can stop it: it is refused with this reason. PROPOSED words.</summary>
    public static readonly Error ErasureAlreadyStarted = Error.Conflict(
        "ShramSafal.ErasureRequest.AlreadyStarted",
        "Erasure has already started, so this request can no longer be cancelled.");

    /// <summary>
    /// spec: plr-d10 lane F99 fix pass 1 (review F-4; orchestrator call D-72) — the price list is ONE list for every farm, so
    /// only ShramSafal's platform admin writes it, on REST and on push alike. Ends in ".Forbidden": a phone parks a refused
    /// push visibly (P10), never drops it.
    /// </summary>
    public static readonly Error PriceListPlatformAdminOnly = Error.Forbidden(
        "ShramSafal.PriceList.Forbidden",
        "The price list is one list for every farm. Only ShramSafal can change it.");

    /// <summary>A chosen plot that is not a plot of this farm (E4: tenancy both ways; never an oracle for another farm).</summary>
    public static readonly Error MembershipPlotNotOnFarm = Error.Validation(
        "ShramSafal.MembershipPlot.InvalidCommand",
        "Every chosen plot must be a plot of this farm.");

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

    /// <summary>
    /// spec: plr-d10 lane MU-2 fix round 1 (review Q2) — the general approval refuses a request claimed from a personal
    /// invitation: that one is let in with EXACTLY the invitation's grant by its own one-tap route.
    /// </summary>
    public static readonly Error MembershipClaimedFromInvitation = Error.Conflict(
        "membership.claimed_from_invitation",
        "This request came from a personal invitation. Let the person in from that invitation.");

    // spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54). The worker-identity answers. Each
    // is a QUESTION the phone asks calmly in its own words (section 9: questions, never errors); none names a person,
    // a number or another farm (R6, case 11).
    public static readonly Error FieldOperatorNotFound = Error.NotFound(
        "ShramSafal.FieldOperatorNotFound", "No such worker on this farm.");

    public static readonly Error IdentityNotFound = Error.NotFound(
        "identity.not_found", "No working ShramSafal card or verified number matches.");

    public static readonly Error IdentityProofNeeded = Error.Validation(
        "identity.proof_needed", "Linking needs the worker's own proof: his card, or a code sent to his phone.");

    public static readonly Error IdentityCodeWrong = Error.Validation(
        "identity.code_wrong", "That code is not the one sent.");

    public static readonly Error IdentityCodeExpired = Error.Validation(
        "identity.code_expired", "That code has expired or was already used; send a new one.");

    public static readonly Error IdentityNumberHeldByVerified = Error.Conflict(
        "identity.number_verified_elsewhere",
        "This number belongs to a verified ShramSafal identity: scan his card, or enter the code sent to him.");

    public static readonly Error IdentityAlreadyOnTeam = Error.Conflict(
        "identity.already_on_team", "This person is already on this farm's team.");

    public static readonly Error IdentityNothingToUndo = Error.Conflict(
        "identity.nothing_to_undo", "There is nothing to undo here.");

    public static readonly Error IdentityCardRetired = Error.Conflict(
        "identity.card_retired", "This card no longer works.");

    public static readonly Error IdentityTooManyCodes = Error.Conflict(
        "identity.too_many_codes", "Too many codes were sent to this number; try again later.");

    public static readonly Error IdentityTooManyTries = Error.Conflict(
        "identity.too_many_tries", "Too many wrong codes from this farm today; try again tomorrow.");

    // Fix pass 3 add-on (P5) — ONE code's five tries are spent: ask a new code (it works today). Not the daily cap, which
    // stays IdentityTooManyTries ("try again tomorrow").
    public static readonly Error IdentityCodeUsedUp = Error.Validation(
        "identity.code_used_up", "This code can no longer be used; ask for a new code.");

    public static readonly Error IdentityOwnerOnly = Error.Conflict(
        "identity.owner_only", "Only the farm's owner may confirm this on his word.");

    public static readonly Error IdentityFlowOff = Error.NotFound(
        "identity.flow_off", "This step is not open yet.");

    public static readonly Error IdentityUseMove = Error.Conflict(
        "identity.use_move", "His verified number changes only by moving it to the new number with a code.");

    public static readonly Error IdentityNoPhone = Error.Conflict(
        "identity.no_phone", "No phone is on record for this worker on this farm.");

    public static readonly Error IdentityErased = Error.Conflict(
        "identity.erased", "This worker's identity has been erased.");

    public static readonly Error WorkerCodeSmsOff = Error.Conflict(
        "identity.sms_off", "Sending the worker's code by SMS is not switched on yet.");

    public static readonly Error WorkerCodeSmsFailed = Error.Conflict(
        "identity.sms_failed", "The code could not be sent just now.");
}
