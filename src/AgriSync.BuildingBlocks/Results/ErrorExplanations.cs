namespace AgriSync.BuildingBlocks.Results;

/// <param name="Meaning">What went wrong, in one plain sentence.</param>
/// <param name="UsualCause">What normally produces it — the first thing to check.</param>
public sealed record ErrorExplanation(string Meaning, string UsualCause);

/// <summary>
/// A plain-language explanation for every catalogued error. Written once, read
/// wherever the code appears — the recorded analytics row, the admin ops list,
/// and (later) the console. A code without an entry here fails
/// <c>ErrorExplanationCoverageTests</c>, which is deliberate: adding a named
/// error without explaining it recreates the problem this file was built to solve.
///
/// <para>
/// <b>Keys are the literal <c>Error.Code</c> string.</b> They are
/// namespace-prefixed, they are not uniformly shaped, and no key may be derived
/// from a field name. <c>ShramSafal.LabourAssignment.Conflict</c> has three
/// segments on purpose (ShramSafalErrors.cs:53-64 — RejectionPolicy.ts in every
/// shipped client depends on it). The <c>join.*</c> family carries no
/// <c>ShramSafal.</c> prefix at all. <c>UserErrors.UserNotFound</c> declares the
/// code <c>User.NotFound</c>. Read the code off the Error; do not infer it.
/// </para>
///
/// <para>
/// <b>Why this lives in BuildingBlocks.</b> It must cover both ShramSafal (52)
/// and User (6). ShramSafal.Domain may not reference User.Domain
/// (DependencyRuleTests.ShramSafal_Domain_Does_Not_Depend_On_User_Domain).
/// BuildingBlocks is referenced by both, references neither, and already owns
/// Error. It is keyed on strings precisely so it needs no reference back.
/// </para>
///
/// <para>
/// <b>Text authored here is the ONLY free text recorded into analytics props.</b>
/// analytics.events is append-only (DO INSTEAD NOTHING on UPDATE/DELETE), so
/// whatever lands there can never be scrubbed. Raw <c>Error.Description</c> is
/// NOT recorded, because descriptions are not uniformly static — several are
/// built with string interpolation. Nothing farmer-authored may appear below.
/// </para>
///
/// <para>
/// <b>Every UsualCause below was read off the handlers that return the code, not
/// paraphrased from its Description.</b> Where a code has no production call site
/// at all, that is what the entry says — an admitted gap beats a plausible
/// invention (doctrine P4). Six entries say so: DayLedgerNotFound,
/// DuplicateLogRequest, InvalidAiResponse, TestProtocolNotFound,
/// User.DuplicateMembership, and — for the catalogued instance only —
/// InvalidAmount.
/// </para>
///
/// <para>
/// <b>One mechanism worth knowing before reading any "not found" entry.</b>
/// ssf.daily_logs, cost_entries, crop_cycles, plots, attachments,
/// compliance_signals, job_cards, workers, test_instances, ai_jobs and
/// farm_memberships all carry FORCE ROW LEVEL SECURITY with
/// <c>USING (farm_id = current_setting('agrisync.farm_id'))</c>, and ssf.farms
/// keys the same policy on its own "Id"
/// (20260516130000_EnableRowLevelSecurity.cs:102-131). A row outside the
/// transaction's tenant GUC — or any row at all when the GUC was never set —
/// reads back as NULL, so the handler answers "not found" for what is really a
/// scope problem. Schedule templates, schedule subscriptions and planned
/// activities are NOT in that set, so their not-founds are genuinely missing rows.
/// </para>
/// </summary>
public static class ErrorExplanations
{
    private static readonly Dictionary<string, ErrorExplanation> Map = new(StringComparer.Ordinal)
    {
        // ── ShramSafal — NotFound ────────────────────────────────────────────
        ["ShramSafal.FarmNotFound"] = new(
            "The farm this request names does not exist, or the caller cannot see it.",
            "Far more often a tenant-scope problem than a deleted farm. ssf.farms is under FORCE "
            + "RLS keyed on current_setting('agrisync.farm_id'), so GetFarmByIdAsync returns null "
            + "whenever that GUC is unset or set to a different farm — the row is there and "
            + "invisible. GetFarmWeatherHandler.cs:31 also answers a failed membership check with "
            + "this instead of Forbidden, on purpose, so a stranger cannot probe which farm ids "
            + "exist. Check the transaction's farm_id GUC and the caller's membership before "
            + "checking the row."),

        ["ShramSafal.PlotNotFound"] = new(
            "The plot this request names is not readable as part of the farm the request is scoped to.",
            "The guard is `plot is null || plot.FarmId != farmId` in every handler, so a plot that "
            + "exists but belongs to a DIFFERENT farm reports as missing — typically a plot id "
            + "carried over after a farm switch, or a cached id on a multi-farm login. One outlier: "
            + "AllocateGlobalExpenseHandler.cs:74 returns this when the farm has zero plots at all, "
            + "which is a farm-setup gap, not a bad id."),

        ["ShramSafal.CropCycleNotFound"] = new(
            "The crop cycle this request names is not readable, or does not sit where the request says it does.",
            "The guard is a triple check — `cropCycle is null || cropCycle.FarmId != farmId || "
            + "cropCycle.PlotId != plotId` (CreateDailyLogHandler.cs:174). A cycle that exists on "
            + "the same farm but a different plot fails here, so this frequently means the plot id "
            + "and the cycle id in one payload disagree, not that the cycle is gone."),

        ["ShramSafal.DailyLogNotFound"] = new(
            "The daily log this request builds on is not readable by this caller.",
            "On /sync/push this is the offline parent-before-child case: add_log_task or verify_log "
            + "reached the server before — or instead of — the create_daily_log that would have made "
            + "the parent exist. EstablishFarmScopeForOwnedEntityAsync sets only the user-scoped GUC "
            + "and reads the log to discover its farm, so a log on a farm the actor has no "
            + "membership on also lands here rather than on Forbidden."),

        ["ShramSafal.PlannedActivityNotFound"] = new(
            "The planned activity this request targets is not available to change.",
            "The guard is `activity is null || activity.IsRemoved` "
            + "(OverridePlannedActivityHandler.cs:47) — a SOFT-DELETED activity reports as missing. "
            + "Usually a plan item removed on one device while another device still had it on screen."),

        ["ShramSafal.CostEntryNotFound"] = new(
            "The cost entry this request corrects or allocates is not readable by this caller.",
            "Same two-phase scope discovery as the daily-log case: correct_cost_entry and "
            + "allocate_global_expense carry only a costEntryId and no farmId, so "
            + "PushSyncBatchHandler.cs:1653/1728 must read ssf.cost_entries under the user GUC "
            + "first. A queued correction for an entry that was never accepted, or that belongs to "
            + "a farm the actor has left, arrives here."),

        ["ShramSafal.DayLedgerNotFound"] = new(
            "The day ledger this request names does not exist.",
            "NO HANDLER RETURNS THIS TODAY — a repo-wide search for ShramSafalErrors.DayLedgerNotFound "
            + "and for the literal code string finds only the declaration. If it ever appears in a "
            + "recorded row, something outside the catalogue minted the code; start by finding what "
            + "constructed it rather than by looking for a ledger."),

        ["ShramSafal.AttachmentNotFound"] = new(
            "The attachment could not be produced — either its record or its stored file is missing.",
            "Two very different failures share this code. GetAttachmentFileHandler.cs:22 is the "
            + "ordinary missing or out-of-scope row; line 40 fires AFTER the row was found and "
            + "passed its Finalized check, when storageService.OpenReadAsync returns null — the "
            + "metadata survived and the object-storage blob did not. If the caller could see the "
            + "attachment in a list and then failed to open it, it is the second one, and that is a "
            + "storage incident, not a bad id."),

        ["ShramSafal.ScheduleTemplateNotFound"] = new(
            "The schedule template being cloned, edited or adopted does not exist.",
            "Schedule templates are NOT under row-level security, so unlike most not-founds here "
            + "this really is a missing row: a template id from a stale client cache, or one deleted "
            + "between the list call and the adopt call."),

        ["ShramSafal.ScheduleSubscriptionNotFound"] = new(
            "No active schedule subscription matches this plot, crop and cycle.",
            "The lookup is composite, not by id: GetActiveScheduleSubscriptionAsync(plotId, cropKey, "
            + "cropCycleId), where cropKey is the crop cycle's CropName trimmed and lower-cased "
            + "(AbandonScheduleHandler.cs:67-69). RENAMING THE CROP ON THE CYCLE ORPHANS ITS OWN "
            + "SUBSCRIPTION — the row is still Active and can no longer be found. Compare the "
            + "cycle's current CropName against the subscription's stored crop key first."),

        // ── ShramSafal — Conflict ────────────────────────────────────────────
        ["ShramSafal.CropCycleOverlap"] = new(
            "Two crop cycles claim the same plot over the same dates.",
            "Almost always an UNCLOSED previous cycle rather than two genuinely overlapping ones: "
            + "CreateCropCycleHandler.cs:82 substitutes DateOnly.MaxValue for a null EndDate, so a "
            + "cycle nobody ever ended overlaps every future cycle on that plot forever. Check "
            + "whether the prior cycle has an EndDate before looking at the dates being submitted."),

        ["ShramSafal.DuplicateLogRequest"] = new(
            "A log already exists for this idempotency key.",
            "NO HANDLER RETURNS THIS TODAY, and the behaviour it describes was deliberately changed: "
            + "CreateDailyLogHandler.cs:233-236 now looks the existing log up by idempotency key and "
            + "returns it as a SUCCESS, because a resend is the expected shape of at-least-once sync "
            + "delivery. A duplicate push is a 200 carrying the original log, not a 409. If this code "
            + "appears, an older binary is answering."),

        ["ShramSafal.AttachmentAlreadyFinalized"] = new(
            "The file for this attachment was already uploaded and sealed.",
            "A retried upload for an attachment whose first upload actually succeeded "
            + "(UploadAttachmentHandler.cs:39). The work is stored — this is the immutability guard "
            + "doing its job, not lost data. Check whether the client lost the acknowledgement "
            + "rather than whether the file failed."),

        ["ShramSafal.ScheduleAlreadyAdopted"] = new(
            "This plot, crop and cycle already has a live schedule running.",
            "Invariant I-14 allows at most one Active subscription per (plot, cropKey, cycle), and "
            + "AdoptScheduleHandler.cs:88-91 refuses the second. Usually a double tap on Adopt, or "
            + "two devices adopting the same plan. The first subscription is intact; abandon or "
            + "migrate it if the intent was to change templates."),

        ["ShramSafal.ScheduleTemplateUnpublished"] = new(
            "The schedule template is still a draft, so it cannot be adopted.",
            "`!template.IsPublished` (AdoptScheduleHandler.cs:76). The template was authored and "
            + "listed but never published, or it was unpublished after the client cached the list. "
            + "Look at the authoring surface that offered it, not at the adopting client."),

        ["ShramSafal.ScheduleNotActive"] = new(
            "The schedule subscription has already ended, so it cannot be changed again.",
            "`subscription.State != ScheduleSubscriptionState.Active` on abandon, complete and "
            + "migrate. Nearly always a REPLAYED action — an offline complete or abandon that synced "
            + "twice, or two people ending the same schedule — so the first one succeeded and the "
            + "second is the one you are looking at."),

        ["ShramSafal.LabourAssignment.Conflict"] = new(
            "This labour entry is already recorded on another daily log.",
            "CreateDailyLogHandler.cs:315-318 finds the submitted labourAssignmentId already owned "
            + "by a DIFFERENT daily log. The client re-asserted an id that is already a committed "
            + "primary key, so no retry can ever satisfy it — the phone parks the row for review and "
            + "its orphaned children escalate instead of waiting. This is the 2026-08-27 prod "
            + "retry-loop incident; read the note at ShramSafalErrors.cs:45-64 before touching the "
            + "shape of this code."),

        // ── ShramSafal — Forbidden / role ────────────────────────────────────
        ["ShramSafal.Forbidden"] = new(
            "The caller is not allowed to act on this farm.",
            "The blunt instrument of the catalogue — 135 call sites, and the guard is almost always "
            + "one of `!isMember` / `!canWriteFarm` / `!canReadFarm` (IsUserMemberOfFarmAsync false) "
            + "or `callerRole is null` (no membership row resolved a role at all). A membership that "
            + "went Revoked or Exited produces both. A minority are rank gates such as "
            + "`role < AppRole.Mukadam`. Start at the caller's FarmMembership row and its Status: "
            + "most endpoints answer this with a bodyless 403, so that row is the only evidence "
            + "there is."),

        ["ShramSafal.VerificationTransitionNotAllowedForRole"] = new(
            "The caller's role cannot move this log's verification status to the one requested.",
            "Not a flat role check — VerifyLogHandler.cs:127 WALKS the verification state machine "
            + "toward the target, and this is the InvalidOperationException it throws when the caller "
            + "lacks an edge along the way. Draft->Verified is reached as Draft->Confirmed then "
            + "Confirmed->Verified, and only owner-tier roles hold the second hop, so a Mukadam or "
            + "foreman approving a Draft day is the standard producer. Read the log's CURRENT status "
            + "and the caller's role together; either one alone looks fine."),

        ["ShramSafal.ConsentRequired"] = new(
            "The Full History Journal consent toggle is off, so this voice note cannot be retained.",
            "One production call site — PersistVoiceClipRetainedHandler.cs:68, where "
            + "consentEnforcer.RequireGrantAsync(FullHistoryJournal) says no. The farmer has not "
            + "turned the toggle on in Settings; the frontend is expected to render a consent CTA "
            + "rather than an error. (The catalogue comment at ShramSafalErrors.cs:74-77 also names "
            + "ParseVoiceInputHandler, which no longer returns it — that comment is stale.)"),

        ["ShramSafal.LabourManagementCarriedByRole"] = new(
            "This member already manages labour records through their role, so the separate grant cannot be toggled.",
            "SetLabourPermissionHandler.cs:110 — LabourManagementPermission.IsRedundantGrantTarget "
            + "is true for owner-tier and Mukadam. Refused rather than silently stored, because "
            + "writing the flag would leave the owner looking at a switch that does nothing "
            + "(doctrine P5). The fix is a role change, not a permission change."),

        ["ShramSafal.WorkerRecordPortabilityForbidden"] = new(
            "Reading this worker's record here would carry it out of the farm that recorded it.",
            "The caller DOES share a farm with the worker — a stranger gets plain ShramSafal.Forbidden "
            + "instead (GetWorkerProfileHandler.cs:73-75). This fires on one of the other reasons in "
            + "WorkerRecordPortability.DenyReasons: an unscoped request (no farmId) spanning several "
            + "shared farms without the worker's own portability consent, a tier-1 "
            + "operational-detail read that no consent ever opens, a named farm the caller does not "
            + "belong to, or a named farm that holds no record of the worker. Sending a farmId with "
            + "the request resolves most of them."),

        // ── ShramSafal — Validation ──────────────────────────────────────────
        ["ShramSafal.InvalidAmount"] = new(
            "A money amount was zero, negative, or above the accepted ceiling.",
            "The catalogued instance has no call site. The code reaches the wire from two locally "
            + "constructed Errors instead — AllocateGlobalExpenseHandler.cs:312 and "
            + "CorrectCostEntryHandler.cs:137 — which enforce `> 0 and <= 999999999` and use the "
            + "two-argument Error constructor, so they carry ErrorKind.Internal rather than "
            + "Validation. Do not go looking for ShramSafalErrors.InvalidAmount; grep the string."),

        ["ShramSafal.InvalidVerificationReason"] = new(
            "A verification change that requires a written reason arrived without a usable one.",
            "Caught as ArgumentException out of the verification state machine "
            + "(VerifyLogHandler.cs:170), not checked at the endpoint — so the request passed "
            + "validation and the DOMAIN refused it. A Disputed transition with a blank reason is "
            + "the usual shape: the client sent the status without the reason field."),

        ["ShramSafal.MissingVoiceTranscript"] = new(
            "A voice request arrived with nothing to parse.",
            "ParseVoiceInputHandler.cs:120 requires text OR audio and got neither, so this normally "
            + "means capture failed on the device — a denied microphone permission, an empty "
            + "recording, or an on-device transcription that returned an empty string — rather than "
            + "anything server-side. AiEndpoints.cs:491 is the stricter text-only path."),

        ["ShramSafal.InvalidCommand"] = new(
            "A required field on the request was missing, empty, or self-contradictory.",
            "The catch-all of the catalogue — 206 call sites, overwhelmingly `x == Guid.Empty` or "
            + "`string.IsNullOrWhiteSpace(...)` guards at the top of a handler. Two shapes are worth "
            + "checking first: an identity claim that did not resolve, so the endpoint passed "
            + "Guid.Empty as the caller id; and an offline temporary id that was never rewritten to "
            + "the server id before sync. Read WHICH endpoint answered — the failing field is not in "
            + "the code."),

        ["ShramSafal.CorrectionFieldTooLong"] = new(
            "A correction carried a value longer than the column that stores it, and was refused whole.",
            "RecordCorrectionEventHandler.cs:53-61, added 2026-08-28 after over-long values reached "
            + "Postgres as 22001 and surfaced as unhandled 500s. Prompt version is the usual "
            + "offender: its identifying part is the trailing hash, so a trimmed value would be "
            + "byte-identical across every build ever shipped — refused, never truncated (P4/P10). "
            + "The field NAME is in the server log; the value deliberately is not."),

        ["ShramSafal.ScheduleTemplateCropMismatch"] = new(
            "The template's crop is not the crop growing in this cycle.",
            "The comparison is Ordinal between template.CropKey and the cycle's CropName trimmed and "
            + "lower-cased (AdoptScheduleHandler.cs:81-82), so it is a raw STRING match with no "
            + "synonym handling: a Devanagari crop name against an English template key, a spelling "
            + "variant, or a stray inner space all fail while looking identical to a human. Compare "
            + "the two strings character by character."),

        // ── ShramSafal — Internal / AI ───────────────────────────────────────
        ["ShramSafal.InvalidAiResponse"] = new(
            "The AI parser returned a payload the server could not use.",
            "NO HANDLER RETURNS THIS TODAY — neither the field nor the literal code string appears "
            + "anywhere outside its own declaration. Malformed model output currently surfaces as "
            + "ShramSafal.AiParsingFailed instead. Treat an occurrence as evidence of an older binary "
            + "or an uncatalogued producer."),

        ["ShramSafal.AiParsingFailed"] = new(
            "The AI step did not return a usable answer.",
            "Three producers, and the provider is the first suspect in all of them: no provider "
            + "wired for this deployment (CoVeReverifyHandler.cs:128 fails closed rather than falling "
            + "back to a different model), a provider call that threw, or a canonical result marked "
            + "unsuccessful — recorded as validationOutcome 'provider_fail' or 'exception' on the "
            + "ai-invocation row. Confirm the configured model is still alive and in quota BEFORE "
            + "reading any of our parsing code; a retired model id has caused this before."),

        // ── ShramSafal — Tests (CEI §4.5) ────────────────────────────────────
        ["ShramSafal.TestProtocolNotFound"] = new(
            "The test protocol this request names does not exist.",
            "NO HANDLER RETURNS THIS TODAY — declared during the CEI Phase 2 build and never wired; "
            + "there is no protocol-by-id lookup for it to answer. If it appears, find the producer "
            + "before looking for a protocol row."),

        ["ShramSafal.TestInstanceNotFound"] = new(
            "The test this request updates is not readable by this caller.",
            "ssf.test_instances is under FORCE RLS keyed on the farm_id GUC, so on /sync/push "
            + "PushSyncBatchHandler.cs:1893 must discover the farm through a user-scoped read first. "
            + "A queued collect or result mutation for a test on a farm the actor no longer belongs "
            + "to — or for a test that was never created server-side — lands here."),

        ["ShramSafal.TestRoleNotAllowed"] = new(
            "This role may not perform this particular step of the test workflow.",
            "The allowed set is DIFFERENT for every step, which is what surprises people: authoring "
            + "a protocol takes owner-tier / Agronomist / Consultant; recording collection takes "
            + "LabOperator, SecondaryOwner or Mukadam (PrimaryOwner is NOT in that set); recording a "
            + "RESULT takes LabOperator and nobody else. The same person legitimately passes one step "
            + "and is refused at the next — check the step, not just the role."),

        ["ShramSafal.TestInvalidState"] = new(
            "The test is not at a point in its lifecycle where this action is legal.",
            "Thrown by the TestInstance domain object (MarkCollected / RecordResult / Waive) and "
            + "caught as InvalidOperationException. Usually a repeat of a step already taken — a "
            + "replayed offline mutation or a second tap — so the earlier action succeeded. Read the "
            + "instance's current status; the sequence is the whole story."),

        ["ShramSafal.TestAttachmentInvalid"] = new(
            "A test result was submitted without the finalised document that must accompany it.",
            "Invariant CEI-I5, enforced at TestInstance.cs:222 and matched on message text at "
            + "RecordTestResultHandler.cs:76: a reported result requires at least one finalised "
            + "attachment, normally the lab report. The common shape is a race rather than an "
            + "omission — the report was picked but its upload had not reached Finalized when the "
            + "result was submitted. Check the attachment's status, not whether one was chosen."),

        // ── ShramSafal — Compliance (CEI §4.6) ───────────────────────────────
        ["ShramSafal.ComplianceSignalNotFound"] = new(
            "The compliance signal this request acts on is not readable by this caller.",
            "ssf.compliance_signals is under FORCE RLS on the farm_id GUC. On /sync/push the "
            + "two-phase scope discovery at PushSyncBatchHandler.cs:2195 is also what closed an "
            + "older gap where anyone who knew a SignalId could acknowledge it on a farm they did "
            + "not belong to — so a caller who used to manage this and now cannot is the fix "
            + "working, not a regression."),

        ["ShramSafal.ComplianceSignalRoleNotAllowed"] = new(
            "This role may not take this action on a compliance signal.",
            "Acknowledge and resolve carry different sets, and the difference is exactly one role: "
            + "Mukadam MAY acknowledge (AcknowledgeSignalHandler.cs:21-29) and MAY NOT resolve "
            + "(ResolveSignalHandler.cs:20-28). A Mukadam who acknowledged a signal and is then "
            + "refused on resolving it is the design, not a bug."),

        ["ShramSafal.ComplianceSignalInvalidState"] = new(
            "The signal has already moved past the point where this action applies.",
            "signal.Acknowledge or signal.Resolve throwing InvalidOperationException — acknowledging "
            + "one already acknowledged, or resolving one already resolved. A duplicate arrival, so "
            + "the first one landed."),

        ["ShramSafal.ComplianceSignalNoteRequired"] = new(
            "Resolving a compliance signal needs a written note, and this one was too short.",
            "ResolveSignalHandler.cs:34 requires at least 3 characters after trimming. Note the "
            + "ORDER: this check runs BEFORE the role check, so a caller who also lacks permission to "
            + "resolve still sees this code rather than RoleNotAllowed — supplying a longer note may "
            + "just reveal a permission error underneath."),

        // ── ShramSafal — Work Trust Ledger (CEI §4.8) ────────────────────────
        ["ShramSafal.JobCardNotFound"] = new(
            "The job card this request acts on is not readable by this caller.",
            "Always `jobCard is null` (12 sites). ssf.job_cards is under FORCE RLS on the farm_id "
            + "GUC, so a card on another farm — or any card at all when the GUC was never set — is "
            + "invisible rather than forbidden. Check the tenant scope of the request before "
            + "concluding the card was deleted."),

        ["ShramSafal.JobCardRoleNotAllowed"] = new(
            "This role may not take this step in the job-card lifecycle.",
            "Four separate eligibility sets that narrow as money gets closer: create and assign "
            + "allow Mukadam plus owner-tier (AssignJobCardHandler.cs:85-86), while verify-for-payout "
            + "and settle allow PrimaryOwner and SecondaryOwner ONLY. A Mukadam who can raise and "
            + "assign a card and is then refused at payout is behaving exactly as designed."),

        ["ShramSafal.JobCardWorkerNotMember"] = new(
            "The worker being put on this card is not currently a member of the farm.",
            "GetFarmMembershipAsync excludes Revoked and Exited memberships "
            + "(ShramSafalRepository.cs:59-66), so this covers three situations that look identical "
            + "in the app: the worker was invited but never claimed the join link, the worker was "
            + "removed, or the worker left. Read the membership row's Status — 'no row' and 'revoked "
            + "row' need different answers."),

        ["ShramSafal.JobCardInvalidState"] = new(
            "The job card has already reached a state where this action no longer applies.",
            "The domain throws and the handler catches on message text ('terminal', 'already "
            + "cancelled') at CancelJobCardHandler.cs:58-64. Acting on a card that is already "
            + "completed, cancelled or settled, which on an offline-first client usually means a "
            + "queued mutation arriving after the outcome it predates."),

        ["ShramSafal.JobCardDailyLogMismatch"] = new(
            "The day's log being used to complete this card belongs to a different farm or plot.",
            "`dailyLog.FarmId != jobCard.FarmId || dailyLog.PlotId != jobCard.PlotId` "
            + "(CompleteJobCardHandler.cs:47). The plot is the half that actually fails: a log "
            + "recorded against the wrong plot, or against the farm with no plot chosen, cannot "
            + "close a card that is pinned to one. Compare the two PlotIds first."),

        ["ShramSafal.JobCardActivityTypeMismatch"] = new(
            "Nothing in the day's log matches the work this card was raised for.",
            "CompleteJobCardHandler.cs:51-58 intersects the card's line-item ActivityType strings "
            + "with the log's task ActivityType strings, OrdinalIgnoreCase. Those are free-text-ish "
            + "activity names and several are AI-derived from speech, so the usual cause is naming "
            + "drift between what the card was raised for and what the voice parse wrote — not a "
            + "farmer logging the wrong work. Compare the two literal strings."),

        ["ShramSafal.UseSettleJobCardForLabourPayout"] = new(
            "Labour payouts may not be recorded as an ordinary expense.",
            "AddCostEntryValidator.cs:57 refuses any cost entry whose categoryId is 'labour_payout' "
            + "and routes it to SettleJobCardPayoutHandler instead, because that path links the money "
            + "to a job card that was verified for payout. A plain cost row would record the spend "
            + "with no link to the work — refused loudly rather than accepted quietly."),

        // ── ShramSafal — Farm geo / weather ──────────────────────────────────
        ["ShramSafal.FarmCentreMissing"] = new(
            "The farm has no map location, so there is nowhere to fetch weather for.",
            "`farm.CanonicalCentreLat is null || farm.CanonicalCentreLng is null` "
            + "(GetFarmWeatherHandler.cs:35). The centre is derived from the drawn farm boundary, so "
            + "this means onboarding finished without the boundary step — an expected state for a "
            + "new farm, and the client should offer 'draw your farm' rather than an error."),

        ["ShramSafal.WeatherProviderNotConfigured"] = new(
            "This server has no weather provider set up.",
            "`!weatherProvider.IsConfigured` — a missing or blank Tomorrow.io API key in this "
            + "environment's configuration. A DEPLOYMENT problem, identical for every farmer on the "
            + "box, so if you see one you should see them all. Check the environment, not the request."),

        ["ShramSafal.WeatherProviderUnavailable"] = new(
            "The upstream weather service did not answer usably.",
            "The catch of HttpRequestException / InvalidOperationException / TaskCanceledException "
            + "around the Tomorrow.io call (GetCoordinateWeatherHandler.cs:35), mapped to 503 rather "
            + "than 500 on purpose. Transient by assumption: an outage, a request timeout, or an "
            + "exhausted quota. Check Tomorrow.io's status and our quota before reading any of our "
            + "code."),

        // ── ShramSafal — Saving, revising, confirming and moving a record ────
        // Most of these carry THREE segments on purpose: every shipped phone reads
        // the tail after the last dot (CONFLICT / INVALIDCOMMAND / FORBIDDEN) and
        // parks the row for the farmer instead of retrying it for ever.
        ["ShramSafal.LogVersion.Conflict"] = new(
            "The record or bill being confirmed changed after the reviewer's phone last showed it, so nothing was confirmed.",
            "Two producers, and despite the name one of them is a bill. VerifyLogHandler.cs:188-192: "
            + "an owner confirmation that names the version it reviewed (ExpectedLogVersion) and "
            + "that version is no longer the log's ContentVersion; a phone that sends no version "
            + "never reaches it. ApproveCostEntryHandler.cs:121-123: a bill approval whose "
            + "BillVersion is not the bill's ContentVersion (a re-sent approval that already made "
            + "its stamp is answered as success first). Someone edited or moved the record while "
            + "it sat on the reviewer's screen; the reviewer needs the new version, not a retry."),

        ["ShramSafal.LogContent.InvalidCommand"] = new(
            "The details document sent with a record is not in the shape or size the server accepts, so nothing was saved.",
            "CreateDailyLogHandler.cs:112 (IsAcceptableContent) and ReviseLogContentHandler.cs:80 "
            + "both check the document before anything is staged. The phone applies the same rules "
            + "before it queues, so a current phone should not reach either. The reachable case is "
            + "the size cap: ReviseLogContentHandler.cs:198, 216 and 234 re-check the document "
            + "AFTER the server carries forward the words, amounts or prices the editor's copy was "
            + "sent without, and only the cap can fail there, so an edit that fitted on the phone "
            + "no longer fits once the carried content is added. The server log line names which "
            + "rule failed."),

        ["ShramSafal.LogContent.Conflict"] = new(
            "An edit to a record's details lost the race for the record's next version every time the server tried to apply it.",
            "One call site: ReviseLogContentHandler.cs:94-99, after MaxAttempts (3) re-applications "
            + "each found that another edit to the same record had landed first. It takes three "
            + "other writes to one record inside the time one edit is saved, so it points at "
            + "several devices or a replaying queue editing the same record at once, not at the "
            + "edit itself. Nothing was saved."),

        ["ShramSafal.LogContentPrices.Conflict"] = new(
            "An edit changed a price on a saved record, and the editor neither made the record nor reviews money.",
            "EditMoney.cs:132. MayChangePricesAsync (EditMoney.cs:286) passes only for the log's own "
            + "operator, or for a member who holds FarmAuthority.ReviewMoney and from whom the "
            + "record's money is not hidden. Anyone else is refused only for a REAL price change: "
            + "the edit must differ in price from the current version and also from the version "
            + "the editor saw (or that version cannot be found); otherwise the edit simply takes "
            + "the current prices. The phone shows such a person the prices read-only, so this is "
            + "a backstop: look for an authority switched off while the edit was queued, or a "
            + "client that let a price be typed."),

        ["ShramSafal.LogDateInFuture.InvalidCommand"] = new(
            "The record names a day that has not happened yet on the farm's India calendar.",
            "Two handlers with DIFFERENT limits. CreateDailyLogHandler.cs:318 refuses only a day "
            + "after the farm's TOMORROW (LogDayRule.IsAfterFarmTomorrow): one day of slack on "
            + "purpose, because installed phones date a save by their own clock. It sits after the "
            + "idempotency return, so a resend of a record already stored is still answered as "
            + "saved. MoveDailyLogHandler.cs:152 refuses a chosen day after the farm's TODAY. On "
            + "create this is nearly always a phone whose date is set ahead; on move it is a "
            + "future day picked in the day chooser."),

        ["ShramSafal.LogMove.Conflict"] = new(
            "A move of a record to another day or plot was made from an older version than the one the server holds.",
            "MoveDailyLogHandler.cs:206, `command.BaseVersion < log.ContentVersion`. The record was "
            + "changed after this phone last pulled it; an offline move queued behind another "
            + "device's edit is the usual shape. The check runs AFTER the already-there shortcut "
            + "(line 200), so a move to where the record already sits succeeds even from a stale "
            + "version. Nothing was changed."),

        ["ShramSafal.LogMoveNoCropCycle.InvalidCommand"] = new(
            "A record was being placed on a single plot on a day that no crop season on that plot covers.",
            "MoveDailyLogHandler.cs:189-195: the target is exactly one plot and CycleCoveringAsync "
            + "(line 455) finds no cycle on it with StartDate <= day and EndDate null or >= day. "
            + "It applies to a day-only move too, because the record's existing single plot is "
            + "re-checked against the new day; whole-farm and multi-plot targets skip it. Usual "
            + "shape: the chosen day is before the season on that plot began or after it was "
            + "closed. Compare the day against that plot's cycle dates."),

        ["ShramSafal.LogMoveAttendance.Conflict"] = new(
            "A record cannot move to another day because an attendance ruling already names a person on it.",
            "MoveDailyLogHandler.cs:284-297, reached only when the DAY changes; a place-only move is "
            + "never stopped here. For each worker named on the record's labour rows, either an "
            + "attendance mark exists for that worker on the record's CURRENT day (line 284), or "
            + "the worker is marked Absent on the TARGET day (line 293). A present mark on the "
            + "target day does not block. Compare the record's named workers against the "
            + "attendance marks of both days."),

        ["ShramSafal.LogMoveJobCard.Conflict"] = new(
            "A record cannot be moved because a job card is tied to it or to its money.",
            "Two checks in MoveDailyLogHandler. Lines 216-222: any job card linked to the log whose "
            + "status is not Cancelled. Lines 256-259: one of the money entries made from the "
            + "record's lines carries a JobCardId, meaning it is a card's payout. Nothing the "
            + "sender can change clears it (a verified or paid card is never cancelled), so this "
            + "is a standing limit of the record, not a fault to chase."),

        ["ShramSafal.LogMoveMoneyShared.Conflict"] = new(
            "A record cannot be moved because its money was already shared out across plots.",
            "MoveDailyLogHandler.cs:262-265: GetDayLedgerBySourceCostEntryIdAsync finds a day ledger "
            + "for one of the money entries made from the record's lines, meaning that entry went "
            + "through allocate-global-expense. No command removes an allocation, so the record "
            + "stays where it is; nothing was changed."),

        ["ShramSafal.LogMoveMoneyNotFound.Conflict"] = new(
            "A record cannot be moved because a line of it states an amount and the matching money entry is not on the server.",
            "MoveDailyLogHandler.cs:242-251: a line the record's create-time details priced has no "
            + "cost entry under its derived id on the record's farm. Three shapes: the money was "
            + "saved by an older app with random ids, it is still queued on a phone, or its push "
            + "was refused. Check the sync queue of the phone that made the record before "
            + "anything else. This is the one code whose Description is rewritten per request "
            + "(the missing ids are appended), which is why descriptions are never recorded."),

        ["ShramSafal.LogMoveDetailsNotHeld.Conflict"] = new(
            "A record cannot be moved because the server never held its details as they were when it was created.",
            "MoveDailyLogHandler.cs:231-234, `!lines.HeldFromCreate` from RecordFirstMoney.OfAsync. "
            + "Without the create-time details the server cannot tell which lines made money, so "
            + "it cannot show the money moving with the record and refuses whole. The record was "
            + "saved by app 1.0.15 to 1.0.17, or its create arrived without its details. No phone "
            + "can unlock it; it is a property of when the record was made."),

        ["ShramSafal.RecordedBeforeConsent"] = new(
            "A voice clip sent for cloud keeping says it was recorded before the current cloud-save consent began.",
            "One call site: PersistVoiceClipRetainedHandler.cs:87-92, after the consent gate itself "
            + "has passed. The consent ledger shows when the CURRENT continuous grant began and the "
            + "clip's client-declared recordedAt is earlier. Usual shape: clips recorded while the "
            + "toggle was off (or before it was turned off and on again) and uploaded once it was "
            + "on. The phone is meant to filter these first, so a row here means that filter "
            + "missed, or the phone's clock runs behind. When the ledger cannot show a start the "
            + "check is skipped."),

        ["ShramSafal.PlotScope.Forbidden"] = new(
            "The work names a plot outside the plots this member's seat on the farm covers.",
            "Only a seat limited to CHOSEN plots can get this (FarmReadGate scope with PlotIds set); "
            + "every other seat passes. Producers: PlotScopeGate.cs:47 (a named plot not among "
            + "his) and :104 (a crop season on another farm or on a plot not his), called from "
            + "about two dozen write handlers; PushSyncBatchHandler.cs:4597 (a change to an "
            + "existing record that lies outside his plots) and :4686 (a new mutation naming such "
            + "a plot); MoveDailyLogHandler.cs:141 (a move that reaches a plot not his). Usual "
            + "shape: work queued offline on a plot that the owner has since taken out of the "
            + "member's plots. Read the member's chosen plots on the farm first; the push keeps "
            + "the refused change for the owner."),

        ["ShramSafal.ReadNotAllowed"] = new(
            "The caller is on the farm but may not read this particular information.",
            "A READ refusal with four producers. GetFieldOperatorsHandler.cs:72-76: an own-records "
            + "seat asking for the crew list while holding neither the take-attendance nor the "
            + "confirm-records authority. GetLogOriginalVoiceHandler.cs:113: no role on the "
            + "record's farm at all; :119: the record's chosen audience leaves the caller out; "
            + ":133: RecordWordsGate says this caller may not hear the record's words (not the "
            + "speaker and no confirm-records authority). Check which endpoint answered, then the "
            + "caller's authorities on that farm."),

        ["ShramSafal.ScheduleChangedElsewhere"] = new(
            "The schedule choice this request acts on is no longer one the plot-season follows.",
            "Three producers. FollowedScheduleChoice.cs:39-41: an abandon or complete names a "
            + "subscription that belongs to this plot-season and is no longer Active. "
            + "MigrateScheduleHandler.cs:130-133: a switch names the schedule it switches FROM and "
            + "that one is not among the Active ones. MigrateScheduleHandler.cs:271: the save "
            + "itself lost the place to a rival write. In all three another phone, or an offline "
            + "action that synced first, already changed the plot's schedules; nothing was "
            + "written and the phone needs a fresh pull."),

        // ── ShramSafal — Schedules: following, copying and making one ────────
        ["ShramSafal.ScheduleChoiceNeeded"] = new(
            "The plot-season follows several schedules and the request did not say which one it means.",
            "FollowedScheduleChoice.cs:45-49 (an abandon or complete with no subscriptionId while "
            + "more than one subscription is Active) and MigrateScheduleHandler.cs:138-144 (a "
            + "switch that names no schedule to switch from, same condition). Phones built before "
            + "a plot-season could follow several never name one, so this is an older app acting "
            + "on a plot-season that a newer app gave a second schedule. Nothing was written; the "
            + "server never picks one arbitrarily."),

        ["ShramSafal.ScheduleCopy.Conflict"] = new(
            "A copy of this schedule is already kept, so a second one was not made.",
            "TrySaveNewScheduleAsync answered CopyExists at the save: CloneScheduleTemplateHandler.cs:159, "
            + "CreateOwnScheduleHandler.cs:123, EditScheduleTemplateHandler.cs:168. A unique index "
            + "refused the row: one copy per source and version, and one own copy of a source per "
            + "PERSON whichever of his farms is named. So besides a second tap on copy, a person "
            + "copying the same schedule for a second farm lands here. The first copy is intact."),

        ["ShramSafal.ScheduleCropNotOnFarm"] = new(
            "The schedule is for a crop this farm has no season of.",
            "ScheduleTemplateWriteGate.FarmGrowsAsync (ScheduleTemplateWriteGate.cs:101) is false, "
            + "returned from CreateOwnScheduleHandler.cs:85-87 (making the farm's own schedule) "
            + "and ScheduleTemplateWriteGate.cs:93 (copying a checked schedule into the farm's "
            + "own). Two ways to fail: the crop key is not a crop the library knows at all, or no "
            + "crop cycle on the farm, past ones included, has the same crop code. The comparison "
            + "is on the derived crop code, so check how the farm's cycle names its crop before "
            + "concluding the farm does not grow it."),

        ["ShramSafal.ScheduleIdTaken.Conflict"] = new(
            "The id the phone made for a new schedule is already used by a stored schedule.",
            "Two places in each of CloneScheduleTemplateHandler, CreateOwnScheduleHandler and "
            + "EditScheduleTemplateHandler. The pre-check (Clone :104, CreateOwn :80, Edit :75) "
            + "refuses whenever any row has the id, and it does NOT tell a re-send of this "
            + "request's own earlier success from someone else's row. The save branch (Clone "
            + ":165, CreateOwn :130, Edit :174) fires when a rival took the id between check and "
            + "save and ScheduleReplay.IsSameRequest says the stored row is not this request. "
            + "First thing to check: whether the schedule with that id is in fact the sender's "
            + "own, saved by an earlier attempt whose answer the phone never received."),

        ["ShramSafal.ScheduleLimitReached"] = new(
            "The plot-season already follows the most outside schedules it may, which is three.",
            "ScheduleSlots.MaxOutsideSchedulesPerPlot = 3. AdoptScheduleHandler.cs:183-191 and "
            + "MigrateScheduleHandler.cs:164-174 count the Active subscriptions of outside origin "
            + "on the plot-season (a row with no slot still counts) and refuse a fourth. "
            + "AdoptScheduleHandler.cs:207-209 is the second route: two phones raced for the last "
            + "free place and this one lost twice. One of the followed schedules has to be ended "
            + "before another can be followed."),

        ["ShramSafal.ScheduleNotChecked"] = new(
            "The schedule has not passed ShramSafal's check, so it cannot be followed or copied yet.",
            "Two producers. ScheduleLibrary.ChooseAsync (ScheduleLibrary.cs:241-253), on adopt and "
            + "switch: an outside schedule whose check state is not Checked, that is neither a "
            + "bridged carry-over nor a sample still open for its crop. A sample (a built-in, or a "
            + "library row storing no days) stops being open once its crop has a Checked outside "
            + "schedule, so a schedule that could be followed last week can be refused today. "
            + "ScheduleTemplateWriteGate.cs:82-90, on copying into the farm's own: the source is "
            + "not a Public row with stored days, or its check state is not Checked. Read the "
            + "schedule's check state, then whether its crop gained a checked schedule."),

        ["ShramSafal.OwnScheduleEmpty"] = new(
            "The farm's own schedule has no works stored in it yet, so there is nothing to follow.",
            "ScheduleLibrary.cs:235-237, on adopt and switch: the chosen schedule is the farm's own "
            + "and its row stores no days (HasStoredDays false). The schedule was made and then "
            + "followed before any work was added to it. Refused rather than followed, because "
            + "following it would need invented days. The phone should send the person to add "
            + "works first."),

        ["ShramSafal.OwnScheduleLimitReached"] = new(
            "The plot-season already follows one schedule of the farm's own, which is the most it may.",
            "ScheduleSlots.MaxOwnSchedulesPerPlot = 1. Same counting as ScheduleLimitReached "
            + "(AdoptScheduleHandler.cs:183-191 and :207-209, MigrateScheduleHandler.cs:164-174), "
            + "for a schedule whose origin is Own. Two codes instead of one on purpose: the phone "
            + "keeps only the tail after the last dot, so a suffix could not say which limit was "
            + "hit. The own schedule already followed has to be ended, or switched from, first."),

        ["ShramSafal.OwnScheduleNotOpenYet"] = new(
            "The schedule is filed as a farm's own but has no owner on its row, so it cannot be followed.",
            "One call site remains: ScheduleLibrary.cs:227-229, on adopt and switch, when the chosen "
            + "schedule classifies as Own and its row's OwnerUserId is null (a Team row nobody "
            + "owns). The declaration comment at ShramSafalErrors.cs:336-337 says nothing produces "
            + "this code any more; that comment is stale for this one branch. A current row here "
            + "means an ownerless Team schedule row exists, which is a data question, not "
            + "something the farmer did. Shipped phones may also still hold older parked rows "
            + "carrying it."),

        // ── ShramSafal — Planned work and reminders ──────────────────────────
        ["ShramSafal.PlannedWorkNotFound"] = new(
            "The planned work this request names is not one this person can act on in this farm.",
            "PlannedWorkDoor.OpenAsync. Lines 58-61: no row with that id, or the row belongs to "
            + "another farm than the one the request names. Lines 64-71: the row exists and the "
            + "caller's seat sees none of its plots, or it was made from a record the caller may "
            + "not see. All three answer alike on purpose, so one cannot be told from another "
            + "from outside. Usual shapes: a task queued offline whose create never landed, or a "
            + "member whose plots or record access changed after the task reached his phone. A "
            + "seat that reads nothing of the farm gets ShramSafal.Forbidden instead."),

        ["ShramSafal.PlannedWork.InvalidCommand"] = new(
            "A planned-work request was missing a required part or had a shape the record forbids.",
            "Thirteen sites in PlannedWorkHandlers.cs, in four kinds. Empty ids or a missing caller "
            + "or details at the top of every step (:30, :110, :185, :229, :294, :437). A create "
            + "whose id already belongs to a task of another farm or another maker (:45-49; the "
            + "same maker's re-send is answered as success). A create whose recorded-on day is "
            + "more than two days from the server's today (:68, PlannedWorkDoor.cs:40). And the "
            + "domain object refusing the shape with ArgumentException on create, edit, cancel or "
            + "reopen (:86, :159, :254, :462), which includes a reopen sent without a reason. On "
            + "complete: an empty, repeated or too many linked log ids (:301-305). Read which "
            + "step answered; a phone clock days off shows up as the recorded-on case."),

        ["ShramSafal.PlannedWorkAssigneeNotMember.InvalidCommand"] = new(
            "The person the work is being given to is not an active member of this farm.",
            "PlannedWorkDoor.cs:103-108: the assignee is someone other than the sender and "
            + "FarmAccessPolicy.MayRead is false for his access on the farm. He was removed, left, "
            + "or never completed joining, after the sender's phone last refreshed its list of "
            + "people. Read the assignee's membership row and its status on that farm."),

        ["ShramSafal.PlannedWorkAssigneeOutsidePlots.InvalidCommand"] = new(
            "The person the work is being given to does not cover every plot the work names.",
            "PlannedWorkDoor.cs:111-113: the assignee's seat is limited to chosen plots "
            + "(CoveredPlotIds set) and at least one plot of the work is not among them. A seat "
            + "with no plot limit never fails here. Either the work names a plot too many, or the "
            + "assignee's plots were narrowed after the sender's phone last refreshed. Compare "
            + "the work's plots with the assignee's chosen plots."),

        ["ShramSafal.PlannedWorkState.InvalidCommand"] = new(
            "The planned work was changed first, so this step no longer applies to it.",
            "Declared with kind Conflict although the code's tail is InvalidCommand (the tail is "
            + "what makes phones park it). Producers in PlannedWorkHandlers.cs: an edit of a "
            + "closed task (:125), an edit that would take off a plot already done (:150), a seen "
            + "or accept on a closed task (:207), a cancel of a done task (:261), a complete of a "
            + "cancelled task (:324) or one the domain reports closed (:416), a reopen of a task "
            + "that is not Done (:467). PlannedWorkDoor.cs:158-160 adds the lost save race. "
            + "Nearly always two people, or one person on two phones, acting on the same task; "
            + "the earlier action stands."),

        ["ShramSafal.PlannedWorkPlots.InvalidCommand"] = new(
            "The plots named when marking planned work done are not plots that work still has open.",
            "PlannedWorkHandlers.cs:337-342: a plot id is empty, repeated, or not one of the work's "
            + "live plots, or no plot was named while some are still Pending. Line 407-409: the "
            + "domain's Complete refused the plots with ArgumentException. A plot of another farm "
            + "and a made-up plot get this same answer. Usual shape: the task was edited to other "
            + "plots after the sender's phone last pulled it."),

        ["ShramSafal.PlannedWorkLog.InvalidCommand"] = new(
            "Handed-out work was marked done without a record made on the plots it was done on.",
            "Applies only to work given to someone, never to a reminder (`!work.IsReminder`). "
            + "PlannedWorkHandlers.cs:346-348: no record id was sent at all. Line 375-377: a "
            + "record was sent that stands on none of the plots this step is about. Line 397-399: "
            + "one of the named plots has no record on it. A record that is on another farm or "
            + "hidden from the sender answers ShramSafal.DailyLogNotFound instead. Check that the "
            + "day's record was saved on the same plots the work names."),

        // ── ShramSafal — Who may see one record (record audience) ────────────
        ["ShramSafal.RecordAudience.Forbidden"] = new(
            "A change was sent to a record that the sender is no longer among the people allowed to see.",
            "The record's audience was narrowed by the farm's holder and leaves the sender out. "
            + "About twenty producers, all the same guard (RecordAudienceGate / RecordAudienceRule "
            + "MaySee is false): PushSyncBatchHandler.cs:4606-4616 for any queued change to an "
            + "existing record, and the REST doors for confirm (VerifyLogHandler.cs:85), add "
            + "task, attachments, cost approve and correct, allocate, labour attach and correct, "
            + "job-card complete and verify, compliance acknowledge and resolve. One odd case: "
            + "CreateDailyLogHandler.cs:262-273 answers it to a RE-SENT create whose stored "
            + "record is now kept from the sender. Usual shape: an edit queued offline before "
            + "the audience changed. Nothing was applied; the phone keeps the change."),

        ["ShramSafal.RecordAudienceHolder.Forbidden"] = new(
            "Someone other than the farm's primary account holder tried to choose who sees a record.",
            "SetRecordAudienceHandler.cs:75-79: GetFarmAccessForUserAsync for the sender is not "
            + "`{ IsRegistrant: true }`. The test is the farm's REGISTRANT, not the PrimaryOwner "
            + "role, so a second owner-tier member is refused here too. A current phone only "
            + "offers the control to the registrant, so look for a stale client or a farm whose "
            + "registrant is not who the team assumes."),

        ["ShramSafal.RecordAudienceMember.Forbidden"] = new(
            "One of the people chosen to see a record holds no active seat on that record's farm.",
            "SetRecordAudienceHandler.cs:83-89: FarmAccessPolicy.MayRead is false for a chosen user "
            + "on the record's own farm. Checked after the holder check, so the sender is the "
            + "registrant. Usual shape: a member who was removed or left after the sender's "
            + "phone last refreshed its people list; the whole request is refused, not just "
            + "that one person."),

        ["ShramSafal.RecordAudienceState.InvalidCommand"] = new(
            "Who sees this record cannot be chosen separately, because it follows another record.",
            "One call site: SetRecordAudienceHandler.cs:93-96, for a money entry that is a job "
            + "card's payout (IsJobCardPayout). Its audience follows its job card, so no request "
            + "can set it here. The phone offered a control it should not have for this entry."),

        // ── ShramSafal — Attendance and labour corrections ───────────────────
        ["ShramSafal.AttendanceFutureDate.InvalidCommand"] = new(
            "An attendance mark was sent for a day that has not happened yet on the farm's India calendar.",
            "RecordAttendanceMarkHandler.cs:64, `command.WorkDate > FarmLocalDay.From(now)`. The "
            + "server's clock in India time decides today, never the phone and never UTC, and "
            + "unlike creating a record there is NO one-day slack. Usual shape: a phone whose "
            + "date is set ahead, or a mark made just after midnight on a phone clock running "
            + "fast. Past days are never refused here."),

        ["ShramSafal.LabourDoorLog.InvalidCommand"] = new(
            "The record was saved at the attendance door and holds labour only, so this change does not apply to it.",
            "LogEditGate.cs:58, `log.WasCapturedAtLabourDoor`, the last check of the shared gate "
            + "(membership, entitlement and who-may-edit all passed first). The gate serves two "
            + "handlers, so the code reaches the wire from an edit of the record's details "
            + "(ReviseLogContentHandler.cs:140) AND from a move of the record "
            + "(MoveDailyLogHandler.cs:123), although its wording speaks only of details. The "
            + "phone offered an edit or a move on an attendance-door record; that is the thing "
            + "to check."),

        ["ShramSafal.LabourCorrection.Conflict"] = new(
            "A correction to a work entry's worker count or hours was made against values the entry no longer holds.",
            "CorrectLabourHandler.cs:233-238: the request carries what the reviewer saw (Seen) and "
            + "IsStale finds a section he is correcting no longer matches it. Only the sections "
            + "being corrected are compared, and a request without Seen never reaches the check. "
            + "A replay of a correction already applied is answered as success just above. Two "
            + "people corrected the same entry, or one phone corrected from a stale copy; the "
            + "newer correction stands and nothing was written."),

        ["ShramSafal.Attribution.ExceedsHeadcount"] = new(
            "Naming one more person on a work entry would name more people than the entry says worked.",
            "AttachFieldOperatorHandler.cs:136-140: the person is not already on the work and the "
            + "names already attached plus one exceed the entry's stated headcount. "
            + "CorrectLabourHandler.cs:276-284: a correction that adds names exceeds the "
            + "headcount as it will stand after that same correction's own count section. The "
            + "count is read and never raised to fit the names. REST only, never a sync "
            + "mutation. Check the entry's stated count: the usual cause is a count spoken or "
            + "typed lower than the crew that is now being named."),

        // ── Memberships / ClaimJoin (codes carry no ShramSafal. prefix) ──────
        ["join.unauthenticated"] = new(
            "The server could not tell who is making this request.",
            "Despite the name this is NOT only the join flow — GetConsentHandler.cs:22 and "
            + "UpdateConsentHandler.cs:34 return it whenever the userId reaching them is Guid.Empty. "
            + "That means the token was accepted by the middleware and its subject claim still did "
            + "not resolve to a user id at the endpoint. Look at claim mapping, not at the login."),

        ["join.phone_not_verified"] = new(
            "The caller tried to join a farm before verifying their phone by OTP.",
            "ClaimJoinValidator.cs:47 reads a PhoneVerified flag carried on the command from the "
            + "token, and short-circuits so no later join error can mask it. A join link or QR opened "
            + "while the account was still unverified; the client should route to OTP verification "
            + "rather than surface a failure."),

        ["join.invalid_payload"] = new(
            "The join request was missing part of what the farm QR encodes.",
            "`string.IsNullOrWhiteSpace(command.Token) || string.IsNullOrWhiteSpace(command.FarmCode)` "
            + "(ClaimJoinValidator.cs:53) — one of the two halves is absent, which is what a "
            + "partially decoded or hand-typed code looks like, not a wrong code. A "
            + "wrong-but-complete code fails later, with a different error."),

        // ── User ─────────────────────────────────────────────────────────────
        ["User.PhoneAlreadyRegistered"] = new(
            "Someone already holds an account on this phone number.",
            "ExistsByPhoneAsync is true at RegisterUserHandler.cs:24. In practice this is a farmer "
            + "who already has an account trying to sign UP again instead of logging in — a flow "
            + "problem, and the right answer is to route them to login, not to report a failure."),

        ["User.InvalidCredentials"] = new(
            "The phone number and password together did not match an account.",
            "Returned DELIBERATELY for two different situations — no account for that phone "
            + "(LoginHandler.cs:26) and a wrong password (LoginHandler.cs:36) — so the response "
            + "cannot be used to discover which numbers are registered. Do not read it as 'wrong "
            + "password': it does not distinguish, and it will not tell you which one it was."),

        ["User.NotFound"] = new(
            "No account row exists for the user id in this request.",
            "One call site: GetMeContextHandler.cs:28, where a token that VALIDATED carries a user "
            + "id no longer present in the table — a session outliving its account, typically after "
            + "a re-seed or a deletion. Login never returns this code; it answers "
            + "User.InvalidCredentials instead."),

        ["User.Deactivated"] = new(
            "The account exists but is not allowed to act.",
            "`!user.IsActive` at login (LoginHandler.cs:29). At token refresh the guard is wider — "
            + "`user is null || !user.IsActive` (RefreshTokenHandler.cs:47) — so on the refresh path "
            + "a MISSING user also reports as deactivated. If this appears on refresh, confirm the "
            + "row still exists before assuming somebody switched a flag."),

        ["User.InvalidRefreshToken"] = new(
            "The refresh token presented was not one this server will renew.",
            "Three branches, and they are not equally benign: unknown hash, expired-but-not-revoked, "
            + "and REVOKED. The revoked branch is token REUSE detection — RefreshTokenHandler.cs:30-36 "
            + "responds by revoking every active session for that user and device with reason "
            + "'reuse_detected'. A burst of these from one device means sessions were just killed on "
            + "purpose; read refresh_tokens.revoked_reason before treating it as an expiry."),

        ["User.DuplicateMembership"] = new(
            "The user already has an active membership in this app.",
            "NO HANDLER RETURNS THIS TODAY — neither the field nor the literal code string appears "
            + "anywhere but its own declaration. It belongs to the deprecated AppMembership model "
            + "that FarmMembership replaced (spec §3.2). Farm-level duplicate membership is handled "
            + "on the ShramSafal side; do not wire new code to this."),
    };

    /// <summary>
    /// The explanation for a code, or <c>null</c> if the code is not catalogued.
    /// Null is the honest answer for an uncatalogued failure — never a guess.
    /// </summary>
    public static ErrorExplanation? For(string? code)
        => code is not null && Map.TryGetValue(code, out var e) ? e : null;
}
