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
