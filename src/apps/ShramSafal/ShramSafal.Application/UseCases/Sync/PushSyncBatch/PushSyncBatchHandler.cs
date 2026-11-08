using AgriSync.BuildingBlocks.Analytics;
using System.Diagnostics;
using System.Collections.Immutable;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Abstractions.Sync;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;
using ShramSafal.Application.UseCases.Compliance.ResolveSignal;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.MoveDailyLog;
using ShramSafal.Application.UseCases.Logs.ReviseLogContent;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Planning.PlannedWork;
using ShramSafal.Application.UseCases.Tests.RecordTestCollected;
using ShramSafal.Application.UseCases.Tests.RecordTestResult;
using ShramSafal.Application.UseCases.Work.AssignJobCard;
using ShramSafal.Application.UseCases.Work.CancelJobCard;
using ShramSafal.Application.UseCases.Work.CompleteJobCard;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Application.UseCases.Work.SettleJobCardPayout;
using ShramSafal.Application.UseCases.Work.StartJobCard;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Sync.PushSyncBatch;

public sealed class PushSyncBatchHandler(
    IClock clock,
    ISyncMutationStore syncMutationStore,
    IShramSafalRepository repository,
    DbContext dbContext,
    CreateFarmHandler createFarmHandler,
    CreatePlotHandler createPlotHandler,
    CreateCropCycleHandler createCropCycleHandler,
    CreateDailyLogHandler createDailyLogHandler,
    // T-IGH-03-PIPELINE-ROLLOUT (AddLogTask): switched from raw
    // AddLogTaskHandler to the pipeline-wrapped IHandler.
    //
    // IMPORTANT: HandleAddLogTaskAsync below runs its own pre-flight
    // GetDailyLogByIdAsync + IsUserMemberOfFarmAsync checks BEFORE
    // invoking this handler (those checks pre-date the rollout and
    // remain in place). That means on the sync entry path the
    // canonical pipeline ordering "InvalidCommand → DailyLogNotFound
    // → Forbidden" is NOT what the wire sees: an empty DailyLogId,
    // for example, is masked as DailyLogNotFound by the pre-check
    // before the validator's InvalidCommand can fire. The pipeline's
    // additional contribution on the sync path is therefore narrow:
    // caller-shape validation for blank ActivityType / explicit-empty
    // LogTaskId on commands where the log exists and the caller is a
    // member. The endpoint path (/logs/{id}/tasks) is the entry that
    // gets the full canonical pipeline ordering.
    //
    // Removing the pre-checks would make the pipeline canonical on
    // sync too, but that requires sync integration tests for empty
    // DailyLogId / missing log / non-member that don't exist yet.
    // Tracked as a follow-up under PIPELINE-ROLLOUT.
    IHandler<AddLogTaskCommand, DailyLogDto> addLogTaskHandler,
    // T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): switched from raw
    // VerifyLogHandler to the pipeline-wrapped IHandler so the strict
    // EnsureCanVerify owner-tier authorization keeps running on the
    // sync entry path (the body's defense-in-depth check is membership-
    // existence only and would have been a regression on its own).
    //
    // Same caveat as AddLogTask: HandleVerifyLogAsync below has its
    // own pre-flight DailyLogNotFound + Forbidden checks before the
    // pipeline runs. The correctness win (EnsureCanVerify on sync) is
    // real because that owner-tier check did not exist anywhere else
    // on the sync path. The ordering win is endpoint-only.
    IHandler<VerifyLogCommand, DailyLogDto> verifyLogHandler,
    AddCostEntryHandler addCostEntryHandler,
    // Labour V2 R1 Task 3.5b — the attendance write path rides the existing
    // sync pipeline; no second offline system, no new REST route.
    ShramSafal.Application.UseCases.Labour.RecordAttendanceMark.RecordAttendanceMarkHandler recordAttendanceMarkHandler,
    AllocateGlobalExpenseHandler allocateGlobalExpenseHandler,
    CorrectCostEntryHandler correctCostEntryHandler,
    SetPriceConfigVersionHandler setPriceConfigVersionHandler,
    CreateAttachmentHandler createAttachmentHandler,
    RecordTestCollectedHandler recordTestCollectedHandler,
    RecordTestResultHandler recordTestResultHandler,
    ITestInstanceRepository testInstanceRepository,
    // Phase 1 tenant-scope fix (2026-07-19 labour deploy hardening) — needed so
    // HandleComplianceAcknowledgeAsync / HandleComplianceResolveAsync can read
    // ssf.compliance_signals under the new user-scoped SELECT policy to learn
    // the signal's FarmId before establishing scope. See
    // EstablishFarmScopeForOwnedEntityAsync.
    IComplianceSignalRepository complianceSignalRepository,
    AcknowledgeSignalHandler acknowledgeSignalHandler,
    ResolveSignalHandler resolveSignalHandler,
    CreateJobCardHandler createJobCardHandler,
    AssignJobCardHandler assignJobCardHandler,
    StartJobCardHandler startJobCardHandler,
    // T-IGH-03-PIPELINE-ROLLOUT (CompleteJobCard): switched from raw
    // CompleteJobCardHandler to the pipeline-wrapped IHandler. The sync
    // pre-flight in HandleJobCardCompleteAsync below is just an empty-
    // id null-payload check (no overlapping membership lookup), so the
    // pipeline's InvalidCommand → JobCardNotFound → Forbidden ordering
    // is the canonical entry path on both sync and HTTP for this
    // command — no pre-check duplication, no masking caveats.
    IHandler<CompleteJobCardCommand, CompleteJobCardResult> completeJobCardHandler,
    // T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): switched from
    // raw SettleJobCardPayoutHandler to the pipeline-wrapped IHandler.
    // HandleJobCardSettleAsync's pre-flight (empty-id, amount > 0,
    // non-empty currency) overlaps the validator exactly; the pipeline
    // additionally enforces caller-shape (CallerUserId.IsEmpty), so
    // the pipeline ordering is canonical on both sync and HTTP.
    IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult> settleJobCardPayoutHandler,
    // T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): switched from raw
    // CancelJobCardHandler to the pipeline-wrapped IHandler. The sync
    // pre-flight in HandleJobCardCancelAsync is empty-id +
    // non-empty-Reason, the same gates as the validator. No overlapping
    // membership lookup, so the pipeline's
    // InvalidCommand → JobCardNotFound → Forbidden ordering is the
    // canonical entry path on both sync and HTTP.
    IHandler<CancelJobCardCommand, CancelJobCardResult> cancelJobCardHandler,
    // Sub-plan 05 Task 2a (T-IGH-05-FAIL-PUSHES-WIRING): E2E test probe.
    // Production default: NoOpFailPushesProbe (always returns null).
    // When ALLOW_E2E_SEED=true the Bootstrapper re-registers an adapter over
    // E2eFailPushesToggle so the Playwright harness can arm forced failures.
    IE2eFailPushesProbe failPushesProbe,
    // RG5 (Rulebook §4.1 — Observability): before this parameter existed, all
    // 71 MutationExecutionOutcome.Failure sites in this file emitted NOTHING.
    // A rejected mutation is farmer work the server refused, and /sync/push
    // answers HTTP 200 either way, so a rejection was invisible to the server
    // logs, to RequestObservabilityMiddleware (status-code driven) and to every
    // CloudWatch alarm on the account. See LogMutationRejected below.
    ILogger<PushSyncBatchHandler> logger,
    // spec: plr-d10 (lane F1) — an edit to what Sathi understood (revise_log_content).
    ReviseLogContentHandler reviseLogContentHandler,
    // spec: plr-d10 (lane OF-S) — a saved record moved to another place / day (move_daily_log).
    MoveDailyLogHandler moveDailyLogHandler,
    // spec: plr-d10 (lane OF-S) — a worker-count / hours correction sent later (correct_labour_assignment). The SAME
    // handler the online route (POST …/labour/assignments/{id}/corrections) resolves — never a copy of its rule.
    IHandler<CorrectLabourCommand, CorrectLabourResult> correctLabourHandler,
    // spec: plr-d10 lane PRV (founder D-26) — the primary account holder chooses who sees one record (set_record_audience).
    ShramSafal.Application.UseCases.RecordPrivacy.SetRecordAudience.SetRecordAudienceHandler setRecordAudienceHandler,
    // spec: plr-d10 lane RATE-1 part A (founder D-72) — a change to the farm's own rate list (set_farm_rate). The SAME
    // handler the REST door (POST /shramsafal/finance/farm-rates) resolves.
    ShramSafal.Application.UseCases.Finance.SetFarmRate.SetFarmRateHandler setFarmRateHandler,
    // spec: plr-d10 lane BILL-1 (founder D-12) — a reviewer's मंजूर stamp on one bill (approve_cost_entry). The SAME handler
    // the REST door (POST /shramsafal/finance/cost-entry/{id}/approve) resolves.
    ShramSafal.Application.UseCases.Finance.ApproveCostEntry.ApproveCostEntryHandler approveCostEntryHandler,
    // spec: plr-d10 lane L8b-1 — a plot's schedule choice (adopt / migrate / abandon), the SAME handlers the REST routes call.
    ShramSafal.Application.UseCases.Schedules.AdoptSchedule.AdoptScheduleHandler adoptScheduleHandler,
    ShramSafal.Application.UseCases.Schedules.MigrateSchedule.MigrateScheduleHandler migrateScheduleHandler,
    ShramSafal.Application.UseCases.Schedules.AbandonSchedule.AbandonScheduleHandler abandonScheduleHandler,
    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2; founders D-92 / D-95) — his हो / नाही / फोटो answer about one
    // product of one saved record (assert_input_identity): an append-only overlay, never an edit of the record.
    ShramSafal.Application.UseCases.Inputs.AssertInputIdentity.AssertInputIdentityHandler assertInputIdentityHandler,
    // spec: plr-d10 lane L8c-1 (founder D-24c) — planned work and reminders (plannedwork.create / edit / seen / accept / cancel).
    ShramSafal.Application.UseCases.Planning.PlannedWork.CreatePlannedWorkHandler createPlannedWorkHandler,
    ShramSafal.Application.UseCases.Planning.PlannedWork.EditPlannedWorkHandler editPlannedWorkHandler,
    ShramSafal.Application.UseCases.Planning.PlannedWork.AnswerPlannedWorkHandler answerPlannedWorkHandler,
    ShramSafal.Application.UseCases.Planning.PlannedWork.CancelPlannedWorkHandler cancelPlannedWorkHandler,
    // spec: plr-d10 lane L8c-3 (founder D-24d) - the work done through the real log, and the owner's reopen.
    ShramSafal.Application.UseCases.Planning.PlannedWork.CompletePlannedWorkHandler completePlannedWorkHandler,
    ShramSafal.Application.UseCases.Planning.PlannedWork.ReopenPlannedWorkHandler reopenPlannedWorkHandler)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    // spec: plr-d10 (lane OF-S fix pass 3, R2-2) — the answer of a MOVE is stored in the shape it is first sent in
    // (camelCase, ASP.NET's web defaults), so a repeated request answers `{ log, moneyMoved }` exactly as the first one
    // did and the phone writes the same money. Every other mutation's stored answer keeps its shape: released phones
    // read those as they are. Lane OF-M: an EDIT's answer too (`{ log, moneyChanged, moneyCorrections, moneyNotFollowed }`)
    // — revise_log_content was never released, and a repeat must name the same money the first answer did.
    private static readonly JsonSerializerOptions MoveAnswerOptions = new(JsonSerializerDefaults.Web);
    // spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — the buckets a
    // manual draft may carry. Deliberately the SAME eight names as
    // CreateDailyLogHandler.EvidenceArrayKeys and the canonical zod schema
    // (sync-contract/schemas/payloads/create_daily_log.zod.ts): one vocabulary for the
    // farmer's day, never a second list that can drift out of step with the first.
    private static readonly ImmutableHashSet<string> ManualDraftBuckets =
    [
        "labour", "inputs", "irrigation", "observations",
        "plannedTasks", "cropActivities", "machinery", "activityExpenses"
    ];

    /// <summary>
    /// wave-3.10, founder decision 8 (2026-08-16) — the two NON-bucket keys a manual draft
    /// may carry: the farmer's own statement about the DAY (<c>dayOutcome</c>) and the
    /// optional reason chip explaining it (<c>disturbance</c>).
    ///
    /// <para>They are held SEPARATE from <see cref="ManualDraftBuckets"/> on purpose. The
    /// eight-bucket vocabulary is "arrays of rows the farmer typed", and every one of them
    /// is array-shape-checked below. These two are scalars — a string and an object — so
    /// folding them into that set would have quietly disabled the array check for them and
    /// let a malformed client send <c>dayOutcome: [...]</c>. One vocabulary each, both
    /// closed.</para>
    /// </summary>
    private static readonly ImmutableHashSet<string> ManualDraftScalars = ["dayOutcome", "disturbance"];

    /// <summary>Upper bound on one manual draft's raw JSON, in UTF-8 bytes.</summary>
    private const int MaxManualDraftBytes = 64 * 1024;

    private static readonly Regex DeviceIdPattern = new(
        "^[a-zA-Z0-9\\-_]+$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant,
        TimeSpan.FromMilliseconds(100));
    private const string MutationTypeUnimplementedCode = "MUTATION_TYPE_UNIMPLEMENTED";

    /// <summary>
    /// Wire status string for a mutation the server refused to apply. Kept as a
    /// constant so the rejection observability in <c>HandleAsync</c> and the
    /// <c>CreateFailedResult</c> factory below can never drift apart.
    /// </summary>
    public const string RejectedStatus = "failed";

    /// <summary>
    /// Literal token that opens every rejection log line. Stable on purpose: a
    /// CloudWatch Logs metric filter matching this exact string is the cheapest
    /// route from these lines to an alarm, and renaming it silently breaks that
    /// alarm. See <see cref="SyncPushMetrics"/> for the metric-native route.
    /// </summary>
    internal const string RejectionLogToken = "SyncMutationRejected";

    /// <summary>
    /// Value logged for an identifier the server genuinely does not have. Never
    /// substitute a plausible-looking id here — doctrine P4 (no fabricated
    /// numbers) applies to operator-facing telemetry exactly as it does to
    /// farmer-facing screens.
    /// </summary>
    private const string UnknownIdentifier = "unknown";

    /// <summary>
    /// Single metric bucket for any mutation type the client invented. Keeps
    /// the counter's <c>mutation_type</c> tag bounded by the catalog rather
    /// than by whatever a client chooses to send.
    /// </summary>
    internal const string UnregisteredMutationType = "unregistered";

    public async Task<Result<SyncPushResponseDto>> HandleAsync(PushSyncBatchCommand command, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command.DeviceId) || command.AuthenticatedUserId == Guid.Empty)
        {
            return Result.Failure<SyncPushResponseDto>(Domain.Common.ShramSafalErrors.InvalidCommand);
        }

        var actorRole = string.IsNullOrWhiteSpace(command.ActorRole)
            ? "unknown"
            : command.ActorRole.Trim();
        var mutations = command.Mutations ?? [];
        var normalizedDeviceId = command.DeviceId.Trim();
        if (normalizedDeviceId.Length > 128 || !DeviceIdPattern.IsMatch(normalizedDeviceId))
        {
            return Result.Failure<SyncPushResponseDto>(Domain.Common.ShramSafalErrors.InvalidCommand);
        }

        var results = new List<SyncMutationResultDto>(mutations.Count);

        foreach (var mutation in mutations)
        {
            SyncMutationResultDto result;
            try
            {
                result = await ProcessMutationAsync(
                    normalizedDeviceId,
                    mutation,
                    command.AuthenticatedUserId,
                    actorRole,
                    command.AppVersion,
                    ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // The caller went away. That is not this mutation's verdict, and we
                // do not manufacture one for it.
                throw;
            }
            catch (Exception ex)
            {
                // 2026-08-28 containment. This loop had no guard, so one row's
                // unexpected fault took every OTHER mutation in the batch down with
                // it -- including ones that had already committed their own
                // transaction and would otherwise have been acknowledged. One row's
                // failure is now one row's failure.
                //
                // The code is deliberately NOT in the client's
                // PERMANENT_REJECTION_CODES: we do not know this is permanent, and
                // RejectionPolicy's documented default for an unknown code is
                // RETRYABLE, which is the honest answer for an unexplained fault.
                var failedRequestId = string.IsNullOrWhiteSpace(mutation.ClientRequestId)
                    ? UnknownIdentifier
                    : mutation.ClientRequestId.Trim();
                var failedMutationType = string.IsNullOrWhiteSpace(mutation.MutationType)
                    ? UnknownIdentifier
                    : mutation.MutationType.Trim();

                logger.LogError(
                    ex,
                    "SyncMutationUnhandled: mutationType={MutationType} device={DeviceId} clientRequestId={ClientRequestId}. "
                    + "The batch continues; this row alone is reported failed.",
                    LogSafe.Text(failedMutationType),
                    LogSafe.Text(normalizedDeviceId),
                    LogSafe.Text(failedRequestId));

                result = CreateFailedResult(
                    failedRequestId,
                    failedMutationType,
                    "ShramSafal.SyncMutationUnhandled",
                    "This mutation failed unexpectedly and was rolled back. Nothing was saved for it; other mutations in the batch were unaffected.");
            }

            results.Add(result);

            // RG5 chokepoint. Every rejection in this handler — all 71
            // MutationExecutionOutcome.Failure sites, the two blank-field
            // guards in ProcessMutationAsync, the DbUpdateException path and
            // the store-failure path — becomes a SyncMutationResultDto here
            // and nowhere else. Logging at this single seam is why the fix is
            // ~30 lines instead of 71 edits, and why it cannot be bypassed by
            // a future failure site. The invariant that this loop is the only
            // place a result enters the response is locked by
            // PushSyncBatchRejectionObservabilityTests.
            if (string.Equals(result.Status, RejectedStatus, StringComparison.Ordinal))
            {
                LogMutationRejected(
                    result,
                    mutation,
                    normalizedDeviceId,
                    command.AuthenticatedUserId,
                    actorRole,
                    command.AppVersion);
            }
        }

        return Result.Success(new SyncPushResponseDto(clock.UtcNow, results));
    }

    /// <summary>
    /// Emits the one operator-visible signal that a farmer's mutation was
    /// refused: a structured <c>Warning</c> (production Serilog minimum level
    /// is <c>Warning</c>, so this survives on the box) plus a counter on the
    /// already-wired Prometheus/OTLP meter.
    /// </summary>
    /// <remarks>
    /// <para><b>Redaction.</b> Identifiers and codes only, per the founder's
    /// standing redacted-only rule. <c>ErrorMessage</c> is deliberately NOT
    /// logged: several rejection sites interpolate caller-supplied values into
    /// it, and <c>Result.Error.Description</c> can carry domain text derived
    /// from the payload. <c>ErrorCode</c> is a closed, developer-authored
    /// vocabulary and is safe. No transcripts, no names, no phone numbers, no
    /// payload bodies — only <c>farmId</c> is read out of the payload, and only
    /// when it parses as a GUID.</para>
    /// <para><b>Where a failed emit lands.</b> The emit is wrapped because it
    /// runs inside the per-mutation loop: an exception here would abort the
    /// whole batch, which is worse than the defect being fixed. It is NOT
    /// swallowed — the catch records an <c>ActivityEvent</c> on the current
    /// span and increments
    /// <c>agrisync.shramsafal.sync.observability_emit_failed</c>. If the
    /// logger, the meter AND the tracer are all broken simultaneously the
    /// rejection is unobservable; that residue is named here rather than left
    /// implied.</para>
    /// </remarks>
    private void LogMutationRejected(
        SyncMutationResultDto result,
        PushSyncMutationCommand mutation,
        string deviceId,
        Guid actorUserId,
        string actorRole,
        string? appVersion)
    {
        var errorCode = string.IsNullOrWhiteSpace(result.ErrorCode)
            ? UnknownIdentifier
            : result.ErrorCode;

        // Metric tags must stay low-cardinality. mutationType is CLIENT-supplied
        // and is echoed back verbatim on the MUTATION_TYPE_UNKNOWN path, so
        // tagging it raw would let a buggy or hostile client mint unbounded time
        // series (and unbounded CloudWatch cost). Anything outside the catalog
        // collapses into one bucket here; the raw value still reaches the log
        // line below, which is where per-incident detail belongs.
        var mutationTypeTag = SyncMutationCatalog.IsKnown(result.MutationType)
            ? result.MutationType
            : UnregisteredMutationType;

        try
        {
            SyncPushMetrics.RecordMutationRejected(mutationTypeTag, errorCode);

            logger.LogWarning(
                RejectionLogToken + ": mutationType={MutationType} errorCode={ErrorCode} "
                + "actorUserId={ActorUserId} actorRole={ActorRole} farmId={FarmId} "
                + "deviceId={DeviceId} clientRequestId={ClientRequestId} appVersion={AppVersion}",
                // Every value below that the CLIENT controls goes through
                // LogSafe.Text — CWE-117, flagged by CodeQL on PR #56. A
                // newline in any of these would let a client forge a log line,
                // and these lines are the evidence a human reads when farmer
                // work starts being refused. errorCode is a closed
                // developer-authored vocabulary, actorUserId and farmId are
                // Guids, and actorRole is server-derived — none is attacker
                // controlled, so none is wrapped.
                LogSafe.Text(result.MutationType),
                errorCode,
                actorUserId,
                actorRole,
                TryExtractFarmId(mutation.Payload)?.ToString() ?? UnknownIdentifier,
                LogSafe.Text(deviceId),
                LogSafe.Text(result.ClientRequestId),
                LogSafe.Text(appVersion));
        }
        catch (Exception ex)
        {
            // Named landing place — see the remarks above. Only the exception
            // TYPE is recorded; exception messages can carry payload text.
            SyncPushMetrics.RecordObservabilityEmitFailed(ex.GetType().Name);
            Activity.Current?.AddEvent(new ActivityEvent(
                "sync.rejection_emit_failed",
                tags: new ActivityTagsCollection
                {
                    { "exception.type", ex.GetType().Name },
                    { "mutation_type", result.MutationType },
                    { "error_code", errorCode }
                }));
        }
    }

    /// <summary>
    /// Best-effort <c>farmId</c> lift out of a mutation payload for the
    /// rejection log. Returns <c>null</c> when the payload has no parseable
    /// <c>farmId</c> — the caller then logs "unknown" rather than inventing an
    /// id. Only this one field is ever read; nothing else in the payload is
    /// touched, so no farmer content can reach the log.
    /// </summary>
    private static Guid? TryExtractFarmId(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return payload.TryGetProperty("farmId", out var farmIdElement)
            && farmIdElement.ValueKind == JsonValueKind.String
            && farmIdElement.TryGetGuid(out var farmId)
            ? farmId
            : null;
    }

    private async Task<SyncMutationResultDto> ProcessMutationAsync(
        string deviceId,
        PushSyncMutationCommand mutation,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        var clientRequestId = mutation.ClientRequestId?.Trim();
        var mutationType = mutation.MutationType?.Trim();

        if (string.IsNullOrWhiteSpace(clientRequestId) || string.IsNullOrWhiteSpace(mutationType))
        {
            return CreateFailedResult(
                mutation.ClientRequestId ?? string.Empty,
                mutation.MutationType ?? string.Empty,
                Domain.Common.ShramSafalErrors.InvalidCommand.Code,
                "Each mutation must contain clientRequestId and mutationType.");
        }

        // Sub-plan 05 Task 2a (T-IGH-05-FAIL-PUSHES-WIRING): E2E test probe.
        // When the probe reports a failure reason, short-circuit every mutation
        // so the Playwright harness can exercise the client retry path.
        // Re-uses the existing MUTATION_TYPE_UNIMPLEMENTED error code to avoid
        // introducing a new ErrorKind — production never reaches this branch.
        var probeReason = failPushesProbe.FailReason;
        if (probeReason is not null)
        {
            return CreateFailedResult(
                clientRequestId,
                mutationType,
                MutationTypeUnimplementedCode,
                $"E2E forced failure: {probeReason}");
        }

        var existing = await syncMutationStore.GetAsync(deviceId, clientRequestId, ct);
        if (existing is not null)
        {
            return CreateDuplicateResult(clientRequestId, mutationType, existing);
        }

        // EnableRetryOnFailure (Npgsql resilience for RDS reboots / failover)
        // forbids user-initiated transactions outside an execution strategy:
        // BeginTransactionAsync would throw InvalidOperationException. Routing
        // the transactional block through the strategy lets it retry the
        // entire mutation on transient connection errors. Idempotency is safe
        // because the pre-execution dedup check inside the helper catches a
        // retry whose first attempt had already committed.
        var strategy = dbContext.Database.CreateExecutionStrategy();
        var outcome = await strategy.ExecuteAsync(
            async innerCt =>
            {
                var result = await ExecuteMutationInTransactionAsync(
                    deviceId,
                    clientRequestId,
                    mutationType,
                    mutation,
                    actorUserId,
                    actorRole,
                    appVersion,
                    costEntryClashSeenBefore: false,
                    innerCt);

                // spec: pre-launch-repair L2b (R-1) — an add_cost_entry whose id hit an EXISTING row's
                // primary key, and that the sync store does not know as this device's own earlier send, is
                // run ONCE more in a fresh transaction. If the row is this farm's, the handler now sees it and
                // answers (the stored entry, or the typed conflict for another person); if it is still
                // invisible it belongs to another farm, and the second clash is the typed conflict.
                return result.ErrorCode == CostEntryIdClashRecheckCode
                    ? await ExecuteMutationInTransactionAsync(
                        deviceId,
                        clientRequestId,
                        mutationType,
                        mutation,
                        actorUserId,
                        actorRole,
                        appVersion,
                        costEntryClashSeenBefore: true,
                        innerCt)
                    : result;
            },
            ct);

        // lane 2b (MU design §11.2; P9 / P10) — work refused for want of an authority, or of a
        // working seat, is not dropped: when the sender once worked on the farm, the server keeps
        // the whole mutation for the owner before answering. The refusal itself is unchanged (same
        // code, so every installed phone still parks it visibly; never a silent drop).
        if (string.Equals(outcome.Status, RejectedStatus, StringComparison.Ordinal)
            && IsAuthorityRefusal(outcome.ErrorCode))
        {
            await KeepRefusedWorkForOwnerAsync(
                deviceId, clientRequestId, mutationType, mutation.Payload, actorUserId, outcome.ErrorCode, appVersion, ct);
        }

        return outcome;
    }

    /// <summary>
    /// lane 2b — the refusal codes that mean "this person may not do this here (any more)": the
    /// uniform Forbidden and the four role-shaped codes the job-card, test, compliance and
    /// verification gates still answer with (their wire codes are kept for the installed phones).
    /// spec: plr-d10 lane MU-4 fix pass 1 (M6) — and the plot refusal: work queued on a plot that has since left his
    /// scope is kept whole for the owner (the same mark), while his phone parks it visibly (its code ends "Forbidden").
    /// </summary>
    private static bool IsAuthorityRefusal(string? errorCode) =>
        errorCode is "ShramSafal.Forbidden"
            or "ShramSafal.PlotScope.Forbidden"
            or "ShramSafal.JobCardRoleNotAllowed"
            or "ShramSafal.TestRoleNotAllowed"
            or "ShramSafal.ComplianceSignalRoleNotAllowed"
            or "ShramSafal.VerificationTransitionNotAllowedForRole";

    /// <summary>The audit entity type of a refused mutation kept for the owner.</summary>
    internal const string KeptMutationEntityType = "RefusedSyncMutation";

    /// <summary>
    /// lane 2b (MU design §11.2) — keep a refused mutation whole for the farm's owner, as ONE audit
    /// row (<see cref="Services.LateAuthorityAudit.KeptForOwner"/>) holding the mutation exactly as it
    /// arrived. Only for a sender who once worked on the farm (<see cref="Domain.Farms.FarmMembership.WasEverLetIn"/>):
    /// a stranger's refusal is not written into anyone's history. Idempotent per (device, request):
    /// a re-send keeps no second copy. Runs in its OWN transaction after the refused one rolled
    /// back, so nothing of the refused write survives — only the record that it was refused.
    ///
    /// <para><b>Which farm.</b> The payload's <c>farmId</c>, else the farm of the record it names
    /// (log, cost, test, job card, warning) read under the sender's own row policies — so a sender
    /// who is no longer let in, and whose mutation names only a record, cannot be placed: that
    /// refusal stays on his phone, parked and visible (unsynchronised intent, P10).</para>
    ///
    /// <para><b>Never fatal, never silent.</b> A failure to keep is logged and counted; the refusal
    /// the phone gets is the same either way.</para>
    /// </summary>
    private async Task KeepRefusedWorkForOwnerAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        JsonElement payload,
        Guid actorUserId,
        string? refusalCode,
        string? appVersion,
        CancellationToken ct)
    {
        try
        {
            var strategy = dbContext.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(
                async innerCt =>
                {
                    await using var transaction = await BeginTransactionIfSupportedAsync(innerCt);
                    try
                    {
                        if (dbContext.Database.IsRelational())
                        {
                            await SetUserScopedReadGucsAsync(actorUserId, innerCt);
                        }

                        var farmId = TryExtractFarmId(payload)
                            ?? await ResolveFarmOfNamedRecordAsync(payload, innerCt);
                        if (farmId is not { } farm)
                        {
                            await RollbackAsync(transaction, innerCt);
                            return;
                        }

                        var history = await repository.GetFarmMembershipHistoryAsync(farm, actorUserId, innerCt);
                        var seat = history.LastOrDefault(m => m.FarmId == new FarmId(farm) && m.WasEverLetIn);
                        if (seat is null)
                        {
                            await RollbackAsync(transaction, innerCt);
                            return;
                        }

                        if (dbContext.Database.IsRelational())
                        {
                            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                                $"SELECT set_config('agrisync.farm_id', {farm.ToString()}, true)", innerCt);
                        }

                        var keyId = KeptMutationKey(deviceId, clientRequestId);
                        var already = await repository.GetAuditEventsForEntityAsync(keyId, KeptMutationEntityType, innerCt);
                        if (already.Any(a => a.Action == Services.LateAuthorityAudit.KeptForOwner))
                        {
                            await RollbackAsync(transaction, innerCt);
                            return;
                        }

                        // fix 1 (MEDIUM-1) — at most MaxKeptPerSenderPerFarmPerDay copies per sender per
                        // farm per farm-day; past it, ONE row says so for that day (the ledger is
                        // append-only, so the count past the cap lives in the log line and the counter).
                        var receivedAt = clock.UtcNow;
                        var farmDay = ShramSafal.Domain.Dfes.FarmLocalDay.From(receivedAt);
                        var (dayStartUtc, dayEndUtc) = ShramSafal.Domain.Dfes.FarmLocalDay.UtcWindow(farmDay);
                        var keptToday = await repository.CountAuditEventsByActorAsync(
                            farm, actorUserId, KeptMutationEntityType, Services.LateAuthorityAudit.KeptForOwner,
                            dayStartUtc, dayEndUtc, innerCt);
                        if (keptToday >= MaxKeptPerSenderPerFarmPerDay)
                        {
                            await KeepDailyCapReachedOnceAsync(
                                farm, actorUserId, seat.Role.ToString(), farmDay, receivedAt, deviceId, appVersion, innerCt);
                            if (transaction is not null)
                            {
                                await transaction.CommitAsync(innerCt);
                            }

                            SyncPushMetrics.RecordRefusedWorkNotKept("DailyCapReached");
                            logger.LogWarning(
                                "SyncRefusedWorkNotKept: daily cap {Cap} reached; mutationType={MutationType} device={DeviceId} clientRequestId={ClientRequestId}",
                                MaxKeptPerSenderPerFarmPerDay,
                                LogSafe.Text(mutationType),
                                LogSafe.Text(deviceId),
                                LogSafe.Text(clientRequestId));
                            return;
                        }

                        // fix 1 (MEDIUM-1) — a body over MaxKeptBodyBytes is kept as its type, size,
                        // SHA-256 and first part, never whole.
                        var body = payload.GetRawText();
                        var bodyBytes = Encoding.UTF8.GetByteCount(body);
                        var tooLarge = bodyBytes > MaxKeptBodyBytes;

                        await repository.AddAuditEventAsync(
                            Domain.Audit.AuditEventFactory.Create(
                                entityType: KeptMutationEntityType,
                                entityId: keyId,
                                action: Services.LateAuthorityAudit.KeptForOwner,
                                actorUserId: actorUserId,
                                actorRole: seat.Role.ToString(),
                                payload: new
                                {
                                    mutationType,
                                    clientRequestId,
                                    deviceId,
                                    refusal = refusalCode,
                                    seatStatus = seat.Status.ToString(),
                                    receivedAtUtc = receivedAt,
                                    // The work exactly as it arrived (P10: nothing is dropped) — or, over
                                    // the size cap, what identifies it.
                                    mutation = tooLarge ? (JsonElement?)null : payload,
                                    mutationTooLarge = tooLarge
                                        ? new
                                        {
                                            sizeBytes = bodyBytes,
                                            sha256 = Convert.ToHexString(
                                                System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(body))),
                                            head = body[..Math.Min(body.Length, KeptBodyHeadChars)],
                                        }
                                        : null,
                                },
                                farmId: farm,
                                clientCommandId: clientRequestId,
                                appVersion: string.IsNullOrWhiteSpace(appVersion)
                                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                                    : appVersion,
                                deviceId: deviceId,
                                ipHash: "sha256:unknown"),
                            innerCt);
                        await repository.SaveChangesAsync(innerCt);
                        if (transaction is not null)
                        {
                            await transaction.CommitAsync(innerCt);
                        }
                    }
                    finally
                    {
                        dbContext.ChangeTracker.Clear();
                    }
                },
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Named landing place: the refusal still reaches the phone (parked, visible); this line
            // and the counter are how an operator learns the server copy was not kept.
            SyncPushMetrics.RecordRefusedWorkNotKept(ex.GetType().Name);
            logger.LogWarning(
                "SyncRefusedWorkNotKept: mutationType={MutationType} device={DeviceId} clientRequestId={ClientRequestId} exception={ExceptionType}",
                LogSafe.Text(mutationType),
                LogSafe.Text(deviceId),
                LogSafe.Text(clientRequestId),
                ex.GetType().Name);
        }
    }

    /// <summary>
    /// lane 2b — the farm of the record a refused mutation names, read under the sender's own row
    /// policies (so only a farm he can still read resolves). <c>null</c> when nothing resolves.
    /// </summary>
    private async Task<Guid?> ResolveFarmOfNamedRecordAsync(JsonElement payload, CancellationToken ct)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        Guid? Id(string name) =>
            payload.TryGetProperty(name, out var element)
            && element.ValueKind == JsonValueKind.String
            && element.TryGetGuid(out var id)
                ? id
                : null;

        if ((Id("dailyLogId") ?? Id("logId")) is { } logId)
        {
            return (await repository.GetDailyLogByIdAsync(logId, ct))?.FarmId.Value;
        }

        if (Id("costEntryId") is { } costEntryId)
        {
            return (await repository.GetCostEntryByIdAsync(costEntryId, ct))?.FarmId.Value;
        }

        if (Id("testInstanceId") is { } testInstanceId)
        {
            return (await testInstanceRepository.GetByIdAsync(testInstanceId, ct))?.FarmId.Value;
        }

        if (Id("jobCardId") is { } jobCardId)
        {
            return (await repository.GetJobCardByIdAsync(jobCardId, ct))?.FarmId.Value;
        }

        if (Id("signalId") is { } signalId)
        {
            return (await complianceSignalRepository.GetByIdAsync(signalId, ct))?.FarmId.Value;
        }

        return null;
    }

    /// <summary>fix 1 (MEDIUM-1, orchestrator's number) — the largest mutation body kept whole (32 KB).</summary>
    internal const int MaxKeptBodyBytes = 32 * 1024;

    /// <summary>How much of an over-size body is kept, from its start.</summary>
    internal const int KeptBodyHeadChars = 2048;

    /// <summary>fix 1 (MEDIUM-1, orchestrator's number) — kept copies per sender per farm per farm-day.</summary>
    internal const int MaxKeptPerSenderPerFarmPerDay = 200;

    /// <summary>The audit action of the one row that says a sender's daily cap was reached.</summary>
    internal const string KeptDailyCapReachedAction = "WorkKeptForOwnerDailyCapReached";

    /// <summary>
    /// fix 1 (MEDIUM-1) — the ONE row per (sender, farm, farm-day) that says "the cap was reached:
    /// refused work after this was not kept". Idempotent by a stable id; the caller's transaction.
    /// </summary>
    private async Task KeepDailyCapReachedOnceAsync(
        Guid farm, Guid actorUserId, string actorRole, DateOnly farmDay, DateTime receivedAt,
        string deviceId, string? appVersion, CancellationToken ct)
    {
        var day = farmDay.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var capKey = new Guid(System.Security.Cryptography.SHA256.HashData(
            Encoding.UTF8.GetBytes($"kept-for-owner-cap|{actorUserId}|{farm}|{day}")).AsSpan(0, 16));
        var already = await repository.GetAuditEventsForEntityAsync(capKey, KeptMutationEntityType, ct);
        if (already.Any(a => a.Action == KeptDailyCapReachedAction))
        {
            return;
        }

        await repository.AddAuditEventAsync(
            Domain.Audit.AuditEventFactory.Create(
                entityType: KeptMutationEntityType,
                entityId: capKey,
                action: KeptDailyCapReachedAction,
                actorUserId: actorUserId,
                actorRole: actorRole,
                payload: new
                {
                    farmDay = day,
                    cap = MaxKeptPerSenderPerFarmPerDay,
                    firstNotKeptAtUtc = receivedAt,
                },
                farmId: farm,
                clientCommandId: null,
                appVersion: string.IsNullOrWhiteSpace(appVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : appVersion,
                deviceId: deviceId,
                ipHash: "sha256:unknown"),
            ct);
        await repository.SaveChangesAsync(ct);
    }

    /// <summary>A stable id for one (device, request) pair, so a re-sent refusal is kept once.</summary>
    internal static Guid KeptMutationKey(string deviceId, string clientRequestId)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(
            Encoding.UTF8.GetBytes($"kept-for-owner|{deviceId}|{clientRequestId}"));
        return new Guid(hash.AsSpan(0, 16));
    }

    /// <summary>
    /// spec: pre-launch-repair L2b (R-1) — internal only, never sent: "this add_cost_entry clashed on the
    /// cost-entry primary key once; look again". See the caller above.
    /// </summary>
    private const string CostEntryIdClashRecheckCode = "ShramSafal.Internal.CostEntryIdClashRecheck";

    /// <summary>
    /// spec: pre-launch-repair L2b (R-1) — did this write fail on the PRIMARY KEY of <c>ssf.cost_entries</c>
    /// (SQLSTATE 23505)? The table was created by raw SQL with an inline <c>PRIMARY KEY</c>, so Postgres named
    /// it <c>cost_entries_pkey</c>; <c>PK_cost_entries</c> is EF's name, for a database EF created. Matched by
    /// reflection — the same technique as <c>ShramSafalRepository.IsUniqueViolationOn</c> — so no provider
    /// type reaches this layer.
    /// </summary>
    private static bool IsCostEntryIdClash(DbUpdateException ex)
    {
        for (Exception? inner = ex; inner is not null; inner = inner.InnerException)
        {
            if (inner.GetType().Name != "PostgresException")
            {
                continue;
            }

            var sqlState = inner.GetType().GetProperty("SqlState")?.GetValue(inner) as string;
            var constraint = inner.GetType().GetProperty("ConstraintName")?.GetValue(inner) as string;
            return string.Equals(sqlState, "23505", StringComparison.Ordinal)
                && (string.Equals(constraint, "cost_entries_pkey", StringComparison.Ordinal)
                    || string.Equals(constraint, "PK_cost_entries", StringComparison.Ordinal));
        }

        return false;
    }

    private async Task<SyncMutationResultDto> ExecuteMutationInTransactionAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        PushSyncMutationCommand mutation,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        bool costEntryClashSeenBefore,
        CancellationToken ct)
    {
        await using var transaction = await BeginTransactionIfSupportedAsync(ct);

        try
        {
            var persistedBeforeExecution = await syncMutationStore.GetAsync(deviceId, clientRequestId, ct);
            if (persistedBeforeExecution is not null)
            {
                await RollbackAsync(transaction, ct);
                return CreateDuplicateResult(clientRequestId, mutationType, persistedBeforeExecution);
            }

            var execution = await ExecuteMutationAsync(
                deviceId,
                clientRequestId,
                mutationType,
                mutation.Payload,
                actorUserId,
                actorRole,
                appVersion,
                ct);

            if (!execution.IsSuccess)
            {
                await RollbackAsync(transaction, ct);
                return CreateFailedResult(clientRequestId, mutationType, execution.ErrorCode, execution.ErrorMessage);
            }

            var responsePayloadJson = JsonSerializer.Serialize(
                execution.Data,
                mutationType is "move_daily_log" or "revise_log_content" ? MoveAnswerOptions : SerializerOptions);
            var stored = await syncMutationStore.TryStoreSuccessAsync(
                deviceId,
                clientRequestId,
                mutationType,
                responsePayloadJson,
                clock.UtcNow,
                ct);

            if (!stored)
            {
                await RollbackAsync(transaction, ct);
                dbContext.ChangeTracker.Clear();
                return await ResolveDuplicateOrStoreFailureAsync(deviceId, clientRequestId, mutationType, ct);
            }

            if (transaction is not null)
            {
                await transaction.CommitAsync(ct);
            }

            return CreateAppliedResult(clientRequestId, mutationType, execution.Data);
        }
        catch (DbUpdateException ex)
        {
            await RollbackAsync(transaction, ct);
            dbContext.ChangeTracker.Clear();

            var deduplicated = await syncMutationStore.GetAsync(deviceId, clientRequestId, ct);
            if (deduplicated is not null)
            {
                return CreateDuplicateResult(clientRequestId, mutationType, deduplicated);
            }

            // spec: pre-launch-repair L2b (R-1) — a money entry id already stored. Not this device's own
            // earlier send (checked just above), so: look once more (the caller), then say what it is — the
            // typed conflict, which every phone parks for the farmer instead of retrying the same bytes.
            if (string.Equals(mutationType, "add_cost_entry", StringComparison.Ordinal) && IsCostEntryIdClash(ex))
            {
                var conflict = Domain.Common.ShramSafalErrors.CostEntryIdConflict;
                return costEntryClashSeenBefore
                    ? CreateFailedResult(clientRequestId, mutationType, conflict.Code, conflict.Description)
                    : CreateFailedResult(clientRequestId, mutationType, CostEntryIdClashRecheckCode, conflict.Description);
            }

            return CreateFailedResult(
                clientRequestId,
                mutationType,
                "ShramSafal.SyncMutationStoreError",
                // The previous message asserted two things that are false on the
                // path that actually reaches here most often. This catch fires for
                // ANY DbUpdateException raised anywhere in the mutation -- including
                // one raised by the DOMAIN write, long before the sync-mutation
                // store is touched. On 2026-08-27 that was a 23505 on
                // PK_labour_assignments, and the operator was told the sync mutation
                // store had failed and that deduplication had been attempted.
                // Neither happened. The one thing this branch can honestly claim is
                // what the rollback guarantees.
                //
                // The CODE is deliberately UNCHANGED: tests assert on it, it is the
                // error_code tag on the RG5 rejection metric, and it drives
                // RejectionPolicy classification for every other DbUpdateException,
                // where RETRYABLE remains the honest default because we do not know
                // the cause.
                "A database constraint rejected this mutation. It was rolled back in full — nothing was saved.");
        }
        finally
        {
            dbContext.ChangeTracker.Clear();
        }
    }

    private async Task<IDbContextTransaction?> BeginTransactionIfSupportedAsync(CancellationToken ct)
    {
        if (!dbContext.Database.IsRelational())
        {
            return null;
        }

        return await dbContext.Database.BeginTransactionAsync(ct);
    }

    private static async Task RollbackAsync(IDbContextTransaction? transaction, CancellationToken ct)
    {
        if (transaction is not null)
        {
            await transaction.RollbackAsync(ct);
        }
    }

    private async Task<MutationExecutionOutcome> ExecuteMutationAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Catalog guard — single source of truth is sync-contract/schemas/mutation-types.json.
        // Names are case-sensitive on purpose; ToLowerInvariant was dropped because
        // dotted names (compliance.acknowledge, jobcard.create, schedule.publish)
        // and any future PascalCase entry would silently mismatch under lowercasing.
        if (!SyncMutationCatalog.IsKnown(mutationType))
        {
            return MutationExecutionOutcome.Failure(
                "MUTATION_TYPE_UNKNOWN",
                $"Mutation type '{mutationType}' is not registered in the SyncMutationCatalog. Regenerate sync-contract.");
        }

        // Sub-plan 02 Task 11: client min-version gate.
        // Each catalog entry declares the sinceVersion it requires from the
        // emitting client. If the client stamped X-App-Version and that
        // version is older than the mutation's sinceVersion, reject — the
        // client knows about the mutation type but predates its schema.
        // Clients that don't send the header (legacy / pre-Task-11 builds)
        // bypass the gate; that lenience is removed once sub-plan 04 ships
        // the new build everywhere.
        if (!string.IsNullOrWhiteSpace(appVersion))
        {
            var descriptor = SyncMutationCatalog.All.Single(m => m.Name == mutationType);
            if (System.Version.TryParse(appVersion, out var clientSemver) &&
                System.Version.TryParse(descriptor.SinceVersion, out var minSemver) &&
                clientSemver.CompareTo(minSemver) < 0)
            {
                return MutationExecutionOutcome.Failure(
                    "CLIENT_TOO_OLD",
                    $"Mutation '{mutationType}' requires app >= {descriptor.SinceVersion}; client reports {appVersion}.");
            }
        }

        // spec: plr-d10 lane PRV (founder D-26) — a change to a record the sender may no longer see (its audience was
        // narrowed while his change waited on the phone) is refused WHOLE before any handler runs, with a code every
        // phone parks visibly (nothing is lost, P10). Asked here once for every kind of change, so no handler can forget.
        if (await RefuseChangeToClosedRecordAsync(mutationType, payload, actorUserId, ct) is { } closed)
        {
            return closed;
        }

        // spec: plr-d10 lane MU-4 (MU design §3 G2) — a chosen-plots seat's write that names a plot outside his plots (a
        // record, a cost, a move, a split, a crop season, a task, a test) is refused WHOLE before any handler runs, with a
        // code every phone parks visibly (P10: never dropped). Asked here once for every kind of change.
        if (await RefuseOutsidePlotScopeAsync(mutationType, payload, actorUserId, ct) is { } outside)
        {
            return outside;
        }

        switch (mutationType)
        {
            case "create_farm":
                return await HandleCreateFarmAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_plot":
                return await HandleCreatePlotAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_crop_cycle":
                return await HandleCreateCropCycleAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_daily_log":
                return await HandleCreateDailyLogAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "add_log_task":
                return await HandleAddLogTaskAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "revise_log_content":
                return await HandleReviseLogContentAsync(clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "move_daily_log":
                return await HandleMoveDailyLogAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "correct_labour_assignment":
                return await HandleCorrectLabourAssignmentAsync(deviceId, clientRequestId, payload, actorUserId, ct);
            case "set_record_audience":
                return await HandleSetRecordAudienceAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            // spec: plr-d10 lane RATE-1 part A (founder D-72) — the farm's own rate list.
            case "set_farm_rate":
                return await HandleSetFarmRateAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            // spec: plr-d10 lane BILL-1 (founder D-12) — a bill's मंजूर stamp.
            case "approve_cost_entry":
                return await HandleApproveCostEntryAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2; founders D-92 / D-95) — his answer about a product.
            case "assert_input_identity":
                return await HandleAssertInputIdentityAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "verify_log":
                return await HandleVerifyLogAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "verify_log_v2":
                return await HandleVerifyLogV2Async(clientRequestId, payload, actorUserId, actorRole, ct);
            case "add_cost_entry":
                return await HandleAddCostEntryAsync(clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "allocate_global_expense":
                return await HandleAllocateGlobalExpenseAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "correct_cost_entry":
                return await HandleCorrectCostEntryAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "set_price_config":
                return await HandleSetPriceConfigAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_attachment":
                return await HandleCreateAttachmentAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "testinstance.collected":
                return await HandleTestInstanceCollectedAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "testinstance.reported":
                return await HandleTestInstanceReportedAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "attendance.mark":
                return await HandleAttendanceMarkAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "compliance.acknowledge":
                return await HandleComplianceAcknowledgeAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "compliance.resolve":
                return await HandleComplianceResolveAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            // CEI Phase 4 §4.8 — Work Trust Ledger mutations
            case "jobcard.create":
                return await HandleJobCardCreateAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "jobcard.assign":
                return await HandleJobCardAssignAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "jobcard.start":
                return await HandleJobCardStartAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "jobcard.complete":
                return await HandleJobCardCompleteAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "jobcard.settle":
                return await HandleJobCardSettleAsync(clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "jobcard.cancel":
                return await HandleJobCardCancelAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "add_location":
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.InvalidMutationType",
                    "Mutation type 'add_location' is not allowed as standalone command. Send location with create_daily_log.");
            // spec: plr-d10 lane L8b-1 — a plot's schedule choice, on the same handlers as the REST routes.
            case "adopt_schedule":
                return await HandleAdoptScheduleAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "migrate_schedule":
                return await HandleMigrateScheduleAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "abandon_schedule":
                return await HandleAbandonScheduleAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            // spec: plr-d10 lane L8c-1 (founder D-24c) — planned work and reminders (the aggregate; plan.* is PlannedActivity's).
            case "plannedwork.create":
                return await HandlePlannedWorkCreateAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "plannedwork.edit":
                return await HandlePlannedWorkEditAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "plannedwork.seen":
                return await HandlePlannedWorkSeenAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "plannedwork.accept":
                return await HandlePlannedWorkAcceptAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "plannedwork.cancel":
                return await HandlePlannedWorkCancelAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "plannedwork.complete":
                return await HandlePlannedWorkCompleteAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            case "plannedwork.reopen":
                return await HandlePlannedWorkReopenAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, appVersion, ct);
            // Schedule-template + Plan mutations (Sub-plan 03 wires real handlers; plan.* is lane L8c-1).
            case "schedule.publish":
            case "schedule.edit":
            case "schedule.clone":
            case "plan.add":
            case "plan.override":
            case "plan.remove":
                return MutationExecutionOutcome.Failure(
                    MutationTypeUnimplementedCode,
                    $"Mutation type '{mutationType}' is registered in the catalog but its server handler is not yet wired. Tracked in Sub-plan 03.");
            default:
                // Catalog drift: a name was added to mutation-types.json but no
                // case here. The IsKnown guard above caught the unknown-type
                // path; reaching default with an IsKnown name means the catalog
                // grew faster than the dispatch. Surface this as a distinct
                // error so the contract test (which scans this file) can
                // report exactly which case is missing.
                return MutationExecutionOutcome.Failure(
                    MutationTypeUnimplementedCode,
                    $"Mutation type '{mutationType}' is registered in the catalog but has no dispatch case. Add a case to PushSyncBatchHandler.cs ExecuteMutationAsync.");
        }
    }

    private async Task<MutationExecutionOutcome> HandleCreateFarmAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "farmId", "name", "ownerUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_farm payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateFarmPayload>(payload);
        if (request is null || string.IsNullOrWhiteSpace(request.Name))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_farm.");
        }

        var result = await createFarmHandler.HandleAsync(
            new CreateFarmCommand(
                request.Name,
                actorUserId,
                request.FarmId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreatePlotAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "plotId", "farmId", "name", "areaInAcres"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_plot payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreatePlotPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_plot.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — /sync/push is admin-elevated
        // with no GUC set, so the naked IsUserMemberOfFarmAsync this used to
        // call would ALWAYS return false under prod's FORCE-RLS (the read
        // matches zero rows). Establish scope via the known-farmId helper
        // (farmId is on the wire) BEFORE calling the handler, so both this
        // membership gate AND the handler's own internal re-checks
        // (GetFarmByIdAsync / GetUserRoleForFarmAsync) succeed.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createPlotHandler.HandleAsync(
            new CreatePlotCommand(
                request.FarmId,
                request.Name,
                request.AreaInAcres,
                actorUserId,
                request.PlotId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreateCropCycleAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "cropCycleId", "farmId", "plotId", "cropName", "stage", "startDate", "endDate"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_crop_cycle payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateCropCyclePayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_crop_cycle.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleCreatePlotAsync.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createCropCycleHandler.HandleAsync(
            // Stage A0 Task 3 — named arguments, deliberately. This call was fully
            // positional, with ActorRole sitting between two same-typed neighbours.
            // Removing that parameter would have slid actorRole into ClientCommandId
            // and clientRequestId into ClientAppVersion — string into string, so the
            // compiler would have stayed silent while the audit ledger recorded the
            // role as a command id. Naming them makes any future removal a build error.
            // Behaviour-neutral: every argument binds exactly as it did before.
            new CreateCropCycleCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropName: request.CropName,
                Stage: request.Stage,
                StartDate: request.StartDate,
                EndDate: request.EndDate,
                ActorUserId: actorUserId,
                CropCycleId: request.CropCycleId,
                // Stage A0 / A3 — ActorRole no longer travels on the command; the handler
                // resolves the role on the target farm. This argument's removal was caught
                // by the compiler ONLY because Task 3 made this call named first.
                ClientCommandId: clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreateDailyLogAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Doctrine F5 — this is a STRICT ALLOW-LIST and it is checked BEFORE
        // DeserializePayload below, so an unlisted key does not merely get
        // ignored: the whole mutation is rejected as SyncInvalidPayload and
        // never reaches CreateDailyLogHandler at all. A farm-scoped log would
        // then fail in a way that looks nothing like a scope problem.
        // LABOUR_PHASE2 P2.2 adds "scope" and "plotIds" here, in lockstep with
        // sync-contract/schemas/payloads/create_daily_log.zod.ts and the
        // generated CreateDailyLogPayload record.
        // B002 adds "captureScope" (which door captured the record), same lockstep.
        // PLR-D10 I13 adds "autoSavedFromVoice" (saved from a voice parse, never reviewed).
        // PLR-D10 I27 adds "voiceClipId" (the recording this log was saved from).
        // PLR-D10 lane F1 adds "content" (what Sathi understood, stored with the log).
        if (!PayloadHasOnly(payload, "dailyLogId", "farmId", "scope", "plotIds", "plotId", "cropCycleId", "operatorUserId", "logDate", "location", "weatherStamp", "sourceAiJobId", "labour", "manualDraft", "captureScope", "autoSavedFromVoice", "voiceClipId", "content"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_daily_log payload contains unsupported fields.");
        }

        // spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — validate the
        // manual draft at the SAME boundary and in the same posture as its neighbours:
        // known keys only, bounded, and loud. Deserialization alone would silently drop
        // an unrecognised bucket, and a farmer whose day was quietly halved is exactly
        // the failure this task exists to end — so a malformed draft is REJECTED, never
        // trimmed. An ABSENT draft skips all of this and behaves as it always did.
        if (ValidateManualDraft(payload) is { } draftFailure)
        {
            return draftFailure;
        }

        // spec: 2026-08-25-prod-cutover-waves — the names a farmer gave for each
        // engagement. Same boundary, same posture as the manual draft above:
        // shape and size only, loud on violation, ABSENT = skipped, which is what
        // every shipped APK sends (none has ever carried the field).
        if (ValidateLabourWorkerNames(payload) is { } namesFailure)
        {
            return namesFailure;
        }

        // PLR-D10 I13 — a plain JSON boolean, or nothing. Checked BEFORE deserialisation
        // so a string/number stand-in ("true", 1) is refused as an invalid payload, loudly
        // and permanently, instead of surfacing as an unhandled fault the phone retries.
        if (payload.TryGetProperty("autoSavedFromVoice", out var autoSavedFromVoice)
            && autoSavedFromVoice.ValueKind is not (JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_daily_log autoSavedFromVoice must be a boolean.");
        }

        // spec: plr-d10 (lane F1) — the content document: same boundary, same posture as the
        // manual draft above — known structure only, bounded, loud. ABSENT = skipped, which is
        // what every shipped APK sends. Read RAW: the generated record types it as `object`, and
        // the document is stored exactly as the phone sent it.
        var contentJson = ReadContentDocument(payload, "create_daily_log", out var contentFailure);
        if (contentFailure is not null)
        {
            return contentFailure;
        }

        var request = DeserializePayload<CreateDailyLogPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_daily_log.");
        }

        // Wire-stability guard for the generated payload swap (T-IGH-02-CS-PAYLOADS).
        // The generated CreateDailyLogPayload.DailyLogId is non-nullable `Guid`
        // (the canonical zod schema marks dailyLogId required) whereas the old
        // hand-authored record was `Guid?`. A payload that omits the field now
        // deserializes to Guid.Empty instead of null. CreateDailyLogHandler does
        // `command.DailyLogId ?? idGenerator.New()`, so passing Guid.Empty would
        // silently create a log with an empty id instead of a server-generated
        // one. Map Empty back to null to preserve the prior wire behavior exactly.
        Guid? dailyLogId = request.DailyLogId == Guid.Empty ? null : request.DailyLogId;

        // LABOUR_PHASE2 P2.2 — the wire carries `scope` as a string (the zod
        // enum's exact member names); map it here, TOTALLY and explicitly.
        //
        // Absent / empty => Plot. Every client shipped before this change omits
        // the field, and "one plot with its crop cycle" is precisely what those
        // payloads mean — so the legacy wire shape keeps its exact V1 behaviour.
        //
        // An UNRECOGNISED value is rejected, never defaulted: silently reading an
        // unknown scope as Plot would turn a farmer's "संपूर्ण शेत" into an
        // assertion about one plot they never named. Enum.TryParse is deliberately
        // NOT used — it also accepts the underlying numeric values ("0", "1"),
        // which are not part of this contract.
        DailyLogScope scope;
        switch (request.Scope)
        {
            case null or "":
            case "Plot":
                scope = DailyLogScope.Plot;
                break;
            case "MultiPlot":
                scope = DailyLogScope.MultiPlot;
                break;
            case "Farm":
                scope = DailyLogScope.Farm;
                break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    "create_daily_log payload carries an unrecognised scope.");
        }

        // B002 (PR #82 review), founder ruling 2026-08-31 — which door captured the
        // record. Absent => the whole parse, which is what every older client means.
        // "labour" => derive the labour bucket only. Anything else is REFUSED, never
        // read as absent: an unknown door silently widened to the whole parse would
        // write exactly the records this field exists to keep out (P1). Exact match,
        // like the zod enum it mirrors. Checked here, before any write is staged.
        DailyLogCaptureScope captureScope;
        switch (request.CaptureScope)
        {
            case null:
                captureScope = DailyLogCaptureScope.WholeDay;
                break;
            case "labour":
                captureScope = DailyLogCaptureScope.Labour;
                break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    "create_daily_log payload carries an unrecognised captureScope.");
        }

        // Fix 1 (ai-intelligence-plan-2026-06-25) — establish the membership-
        // VALIDATED single-farm tenant scope so the confirm-time typed-ledger
        // derivation inside CreateDailyLogHandler can WRITE ssf.farm_operations
        // (whose tenant WITH CHECK is a direct farm_id = agrisync.farm_id match).
        //
        // /sync/push is admin-elevated (TenantTransactionMiddleware skip-list),
        // so TenantConnectionInterceptor no-ops and NO agrisync.* GUC is set for
        // this request — which is why the derivation was previously inert on the
        // real path (the parent WITH CHECK rejected the write with 42501, silently
        // swallowed by the non-blocking side-car). We set the GUCs ourselves on the
        // ambient per-mutation transaction (opened at ExecuteMutationInTransactionAsync;
        // is_local=true keeps them scoped to THIS mutation's tx, so a multi-farm
        // batch cannot leak). This mirrors the prod-proven CallerFarmTenantScope
        // used by the voice HTTP path; do NOT mutate TenantContext (SetTenant
        // throws once admin-elevated) — raw set_config is the only correct
        // mechanism.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(
            request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — propagate batch-level
        // PushSyncBatchCommand.AppVersion onto the replayed CreateDailyLogCommand
        // so Provenance.AppVersion is stamped consistently with the HTTP
        // endpoint path. No schema change to mutation payload shape.
        var result = await createDailyLogHandler.HandleAsync(
            new CreateDailyLogCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                RequestedByUserId: actorUserId,
                OperatorUserId: actorUserId,
                LogDate: request.LogDate,
                Location: ToLocationSnapshot(request.Location),
                DeviceId: deviceId,
                ClientRequestId: clientRequestId,
                DailyLogId: dailyLogId,
                ActorRole: actorRole,
                // AI Intelligence Plan WP-2a — thread the parse job linkage from
                // the sync payload so CreateDailyLogHandler can derive the typed
                // ledger rows. Null on manual/offline logs (no source job).
                SourceAiJobId: request.SourceAiJobId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                WeatherStamp: request.WeatherStamp,
                // Labour V1 Task 5 — transport only; CreateDailyLogHandler does not
                // persist this yet (Task 6 adds the write path).
                Labour: request.Labour,
                // LABOUR_PHASE2 P2.2 — the farmer's spatial assertion, carried
                // straight through. Passed RAW: this path deliberately resolves
                // the RAW handler and skips the validator pipeline (see the
                // header comment on CreateDailyLogHandler), so the handler body
                // — not this mapping — is the gate that must reject an
                // incoherent scope/plot combination.
                Scope: scope,
                PlotIds: request.PlotIds,
                // task-0b — the farmer's typed day. Null on voice confirms and on every
                // client older than this contract, which is the pre-task-0b path exactly.
                ManualDraft: request.ManualDraft,
                // B002 — the door, mapped strictly above.
                CaptureScope: captureScope,
                // PLR-D10 I13 — absent/false is today's behaviour (P11); only an explicit
                // JSON true keeps the log out of the creator's self-attestation. A
                // non-boolean value was already refused above, before any write.
                AutoSavedFromVoice: request.AutoSavedFromVoice == true,
                VoiceClipId: request.VoiceClipId is { } clip && clip != Guid.Empty ? clip : null,
                // lane F1 — checked above; null on every older phone (P11).
                ContentJson: contentJson),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 (lane F1) — the optional <c>content</c> document, read RAW and checked with
    /// <see cref="LogContentDocument.Validate"/> (the same rules the phone's zod schema applies at
    /// enqueue). Returns the document's JSON text, or <c>null</c> when it is absent; a malformed
    /// document sets <paramref name="failure"/> and is refused whole, never trimmed.
    /// </summary>
    private static string? ReadContentDocument(JsonElement payload, string mutationType, out MutationExecutionOutcome? failure)
    {
        failure = null;
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var property in payload.EnumerateObject())
        {
            // Case-insensitive, like the deserializer: a check casing can steer around is not a boundary.
            if (!string.Equals(property.Name, "content", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (property.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                return null;
            }

            if (LogContentDocument.Validate(property.Value) is { } problem)
            {
                failure = MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    $"{mutationType} {problem}");
                return null;
            }

            return property.Value.GetRawText();
        }

        return null;
    }

    /// <summary>
    /// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b). Boundary check for
    /// the optional <c>manualDraft</c>: it must be an object whose keys are all known
    /// buckets, each holding an array, and the whole draft must fit
    /// <see cref="MaxManualDraftBytes"/>. Returns <c>null</c> when the draft is absent or
    /// acceptable, or the failure outcome to return to the client.
    /// </summary>
    private static MutationExecutionOutcome? ValidateManualDraft(JsonElement payload)
    {
        if (!payload.TryGetProperty("manualDraft", out var draft)
            || draft.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null; // absent — pre-task-0b behaviour, unchanged.
        }

        if (draft.ValueKind != JsonValueKind.Object)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_daily_log manualDraft must be an object.");
        }

        // A day's typed entry is tens of rows, not thousands. 64 KiB leaves generous room
        // for a very full day in Devanagari (3 bytes/char in UTF-8) while keeping one
        // mutation from dominating a sync batch or handing the normaliser unbounded work.
        // The limit is on the RAW draft so it is independent of how it later parses.
        var draftBytes = Encoding.UTF8.GetByteCount(draft.GetRawText());
        if (draftBytes > MaxManualDraftBytes)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                $"create_daily_log manualDraft exceeds {MaxManualDraftBytes} bytes.");
        }

        foreach (var bucket in draft.EnumerateObject())
        {
            // wave-3.10 — the declaration and its optional chip are scalars, not buckets.
            // They are PERMITTED here rather than rejected as unknown bucket names, and
            // they are shape-checked on their own terms below: without this branch a
            // farmer tapping "आज काम नाही" would have his entire day refused with
            // "unsupported buckets".
            if (ManualDraftScalars.Contains(bucket.Name))
            {
                var expected = bucket.Name == "disturbance" ? JsonValueKind.Object : JsonValueKind.String;
                if (bucket.Value.ValueKind is not JsonValueKind.Null && bucket.Value.ValueKind != expected)
                {
                    return MutationExecutionOutcome.Failure(
                        "ShramSafal.SyncInvalidPayload",
                        $"create_daily_log manualDraft '{bucket.Name}' must be a {(expected == JsonValueKind.Object ? "object" : "string")}.");
                }

                continue;
            }

            if (!ManualDraftBuckets.Contains(bucket.Name))
            {
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    "create_daily_log manualDraft contains unsupported buckets.");
            }

            if (bucket.Value.ValueKind is not (JsonValueKind.Array or JsonValueKind.Null))
            {
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    $"create_daily_log manualDraft bucket '{bucket.Name}' must be an array.");
            }
        }

        return null;
    }

    /// <summary>
    /// spec: 2026-08-25-prod-cutover-waves. Boundary check for the OPTIONAL
    /// <c>labour[].workerNames</c> on <c>create_daily_log</c>: when present it must be an
    /// array of strings, at most <see cref="LabourAssignmentFactory.MaxWorkerNamesPerEngagement"/>
    /// long, each name at most <see cref="LabourAssignmentFactory.MaxWorkerNameLength"/>
    /// after trimming. Returns <c>null</c> when every engagement is acceptable, or the
    /// failure outcome to return to the client.
    /// </summary>
    /// <remarks>
    /// <para><b>What it does NOT police, on purpose.</b> A blank or <c>null</c> entry is
    /// "no name", not malformed: <c>LabourAssignment.Create</c>'s own write boundary
    /// already sheds it (B002), so rejecting the farmer's whole day over it would let an
    /// optional field reject a record (P9). Names out-numbering the stated headcount are
    /// accepted too: the count is the farmer's statement and names are an overlay on it
    /// (P7), so a mismatch is something to show him, never a reason to refuse him.</para>
    /// <para><b>Why loud, not trimmed.</b> Silently dropping names is the very defect
    /// this field was added to close, so an over-bound list is refused whole, exactly as
    /// an over-sized manual draft is. The bounds sit far above any real dictation.</para>
    /// <para>Property names are matched case-insensitively because
    /// <see cref="SerializerOptions"/> deserializes them that way: a check the
    /// deserializer can be steered around by casing is not a boundary.</para>
    /// </remarks>
    private static MutationExecutionOutcome? ValidateLabourWorkerNames(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return null; // PayloadHasOnly has already refused a non-object payload.
        }

        foreach (var labour in payload.EnumerateObject())
        {
            // Not an array: a shape DeserializePayload owns, exactly as before this check.
            if (!string.Equals(labour.Name, "labour", StringComparison.OrdinalIgnoreCase)
                || labour.Value.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var item in labour.Value.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                foreach (var field in item.EnumerateObject())
                {
                    if (!string.Equals(field.Name, "workerNames", StringComparison.OrdinalIgnoreCase)
                        || field.Value.ValueKind == JsonValueKind.Null)
                    {
                        continue; // absent and null both mean "no names given".
                    }

                    if (field.Value.ValueKind != JsonValueKind.Array)
                    {
                        return MutationExecutionOutcome.Failure(
                            "ShramSafal.SyncInvalidPayload",
                            "create_daily_log labour[].workerNames must be an array of strings.");
                    }

                    if (field.Value.GetArrayLength() > LabourAssignmentFactory.MaxWorkerNamesPerEngagement)
                    {
                        return MutationExecutionOutcome.Failure(
                            "ShramSafal.SyncInvalidPayload",
                            $"create_daily_log labour[].workerNames exceeds {LabourAssignmentFactory.MaxWorkerNamesPerEngagement} names.");
                    }

                    foreach (var name in field.Value.EnumerateArray())
                    {
                        if (name.ValueKind == JsonValueKind.Null)
                        {
                            continue;
                        }

                        if (name.ValueKind != JsonValueKind.String)
                        {
                            return MutationExecutionOutcome.Failure(
                                "ShramSafal.SyncInvalidPayload",
                                "create_daily_log labour[].workerNames must be an array of strings.");
                        }

                        if (name.GetString()!.Trim().Length > LabourAssignmentFactory.MaxWorkerNameLength)
                        {
                            return MutationExecutionOutcome.Failure(
                                "ShramSafal.SyncInvalidPayload",
                                $"create_daily_log labour[].workerNames has a name longer than {LabourAssignmentFactory.MaxWorkerNameLength} characters.");
                        }
                    }
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Fix 1 (ai-intelligence-plan-2026-06-25) — membership-validated single-farm
    /// tenant scope for the create_daily_log derivation on the admin-elevated
    /// <c>/sync/push</c> path. Mirrors
    /// <c>CallerFarmTenantScope.EstablishForCallerAsync</c> (the prod-proven voice
    /// HTTP template): set <c>agrisync.user_id</c> so the user-scoped SELECT
    /// policies surface the caller's OWN farm/membership for the read, validate
    /// membership, then set <c>agrisync.farm_id</c> + <c>agrisync.owner_account_id</c>
    /// so the typed-ledger writes (<c>ssf.farm_operations</c> WITH CHECK) pass.
    /// GUCs are transaction-local (<c>is_local=true</c>) on the ambient
    /// per-mutation tx, so a multi-farm batch cannot leak scope.
    ///
    /// <para>
    /// Phase 1 tenant-scope fix (2026-07-19 labour deploy hardening) — this is
    /// now the SHARED "known farmId" scope-establishment helper reused by every
    /// <c>/sync/push</c> mutation whose payload carries the target farmId
    /// up-front: create_daily_log (original Fix 1 caller), create_plot,
    /// create_crop_cycle, add_cost_entry, create_attachment, jobcard.create. See
    /// <see cref="EstablishFarmScopeForOwnedEntityAsync{TEntity}"/> for the
    /// sibling "unknown farmId" two-phase variant (verify_log, add_log_task,
    /// correct_cost_entry, allocate_global_expense, testinstance.*,
    /// compliance.*, jobcard.assign/start/complete/settle/cancel) used when the
    /// wire only carries a child entity id and the farm must be discovered via
    /// a user-scoped read first. Both share <see cref="SetUserScopedReadGucsAsync"/>
    /// / <see cref="SetFarmScopeGucsAsync"/> — one GUC mechanism, not two.
    /// </para>
    /// </summary>
    private async Task<(bool IsMember, Guid OwnerAccountId)> EstablishFarmScopeForDerivationAsync(
        Guid farmId, Guid actorUserId, CancellationToken ct)
    {
        // Under a NON-relational provider (the EF InMemory harness used by the
        // sync-endpoint tests) there is no FORCE-RLS to satisfy and raw SQL is
        // unavailable, so fall back to the provider-agnostic LINQ membership
        // check. Behaviour is unchanged there: the derivation writes to the
        // in-memory store regardless of GUCs. OwnerAccountId is unused on that
        // path (only the IsMember gate matters), so return Guid.Empty for it.
        if (!dbContext.Database.IsRelational())
        {
            var inMemoryMember = await repository.IsUserMemberOfFarmAsync(farmId, actorUserId, ct);
            return (inMemoryMember, Guid.Empty);
        }

        // Set the caller's user_id GUC so the user-scoped PERMISSIVE SELECT
        // policies (p_user_select_farms / p_user_select_memberships) surface ONLY
        // the caller's own farms/memberships for the membership read below.
        await SetUserScopedReadGucsAsync(actorUserId, ct);

        // The isolation gate: reads ssf.farms (owner shortcut) + ssf.farm_memberships
        // under the user-scoped policies. A forged/cross-farm farmId resolves to no
        // owner/membership row → not a member → Forbidden, with the real farm_id
        // GUC never set (nothing leaks).
        var (isMember, ownerAccountId) = await repository
            .GetFarmMembershipForTenantAsync(farmId, actorUserId, ct);
        if (!isMember)
        {
            return (false, Guid.Empty);
        }

        // Member: establish the single-farm scope so the typed-ledger derivation
        // writes (ssf.farm_operations + children) pass their tenant WITH CHECK.
        await SetFarmScopeGucsAsync(farmId, ownerAccountId, ct);

        return (true, ownerAccountId);
    }

    /// <summary>
    /// Phase 1 tenant-scope fix (2026-07-19 labour deploy hardening) — the
    /// "unknown farmId" sibling of <see cref="EstablishFarmScopeForDerivationAsync"/>.
    ///
    /// <para>
    /// Several <c>/sync/push</c> mutations carry only a CHILD entity id on the
    /// wire (dailyLogId / costEntryId / testInstanceId / signalId / jobCardId),
    /// never the farmId itself — the headline example is <c>verify_log</c>
    /// (payload: <c>{verificationEventId, dailyLogId, status, reason,
    /// verifiedByUserId}</c>, no farmId). The obvious single-phase fix does not
    /// work: we cannot set <c>agrisync.farm_id</c> before knowing which farm the
    /// entity belongs to, and we cannot learn that without a read that FORCE-RLS
    /// itself blocks when no GUC is set at all.
    /// </para>
    /// <para>
    /// Three phases, reusing the exact same GUC primitives as the known-farmId
    /// helper:
    /// (a) <see cref="SetUserScopedReadGucsAsync"/> — set <c>agrisync.user_id</c>
    /// ALONE (+ neutralise farm_id to the empty-GUID sentinel) so the entity's
    /// OWN user-scoped PERMISSIVE SELECT policy (20260607120000 for daily_logs
    /// / cost_entries; this session's new migration for job_cards /
    /// compliance_signals / test_instances) makes the row visible ONLY if the
    /// caller owns or is an active member of its farm.
    /// (b) Read the entity via <paramref name="lookupUnderUserScopeAsync"/>. A
    /// null result means EITHER the row genuinely does not exist OR the caller
    /// is not a member of its farm (RLS hid it) — both map to
    /// <paramref name="notFoundError"/>, exactly the not-found-vs-forbidden
    /// conflation the entity's own pre-fix code already used (no new
    /// information is leaked; if anything this closes a latent hole for the
    /// compliance mutations, which had no farm-membership check at all before).
    /// (c) Re-confirm membership via <c>GetFarmMembershipForTenantAsync</c>
    /// (defense-in-depth, mirrors the known-farmId helper — also yields
    /// OwnerAccountId) and <see cref="SetFarmScopeGucsAsync"/> so the caller's
    /// handler can WRITE (the parent's <c>p_tenant_{t}</c> WITH CHECK needs the
    /// real farm_id, not the sentinel).
    /// </para>
    /// <para>
    /// Under a NON-relational provider (EF InMemory), same fallback contract as
    /// <see cref="EstablishFarmScopeForDerivationAsync"/>: just read the entity
    /// directly (no RLS to satisfy) and let the caller's own defense-in-depth
    /// membership check run as before.
    /// </para>
    /// </summary>
    private async Task<Result<TEntity>> EstablishFarmScopeForOwnedEntityAsync<TEntity>(
        Guid actorUserId,
        Func<CancellationToken, Task<TEntity?>> lookupUnderUserScopeAsync,
        Func<TEntity, Guid> resolveFarmId,
        Error notFoundError,
        CancellationToken ct)
        where TEntity : class
    {
        // Under a NON-relational provider (EF InMemory), mirror the exact
        // membership-gating the pre-fix code performed inline in each
        // dispatcher case: look the entity up directly (no RLS to satisfy),
        // then check membership via the provider-agnostic LINQ helper.
        // Compliance signals had NO such check before this fix (see the class
        // remark); adding one here keeps InMemory and real-Postgres behaviour
        // consistent rather than leaving a provider-dependent gap.
        if (!dbContext.Database.IsRelational())
        {
            var entity = await lookupUnderUserScopeAsync(ct);
            if (entity is null)
            {
                return Result.Failure<TEntity>(notFoundError);
            }

            var inMemoryIsMember = await repository.IsUserMemberOfFarmAsync(resolveFarmId(entity), actorUserId, ct);
            return inMemoryIsMember
                ? Result.Success(entity)
                : Result.Failure<TEntity>(Domain.Common.ShramSafalErrors.Forbidden);
        }

        await SetUserScopedReadGucsAsync(actorUserId, ct);

        var found = await lookupUnderUserScopeAsync(ct);
        if (found is null)
        {
            return Result.Failure<TEntity>(notFoundError);
        }

        var farmId = resolveFarmId(found);
        var (isMember, ownerAccountId) = await repository
            .GetFarmMembershipForTenantAsync(farmId, actorUserId, ct);
        if (!isMember)
        {
            return Result.Failure<TEntity>(Domain.Common.ShramSafalErrors.Forbidden);
        }

        await SetFarmScopeGucsAsync(farmId, ownerAccountId, ct);

        return Result.Success(found);
    }

    /// <summary>
    /// Phase (a) of both scope-establishment helpers above — set the caller's
    /// user_id GUC so the user-scoped PERMISSIVE SELECT policies surface ONLY
    /// the caller's own rows, and neutralise agrisync.farm_id to the all-zeros
    /// sentinel BEFORE any read. The ORIGINAL 03.3 tenant policies cast
    /// <c>current_setting('agrisync.farm_id', true)::uuid</c> — even though
    /// a15aae65 NULLIF-hardened every ssf policy, an UNSET (never assigned)
    /// GUC still reads as NULL either way, so pre-seeding the zero-UUID keeps
    /// the tenant policy's contribution deterministic (matches no real farm)
    /// rather than relying on NULL-propagation semantics.
    /// </summary>
    private async Task SetUserScopedReadGucsAsync(Guid actorUserId, CancellationToken ct)
    {
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {actorUserId.ToString()}, true)", ct);
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {Guid.Empty.ToString()}, true)", ct);
    }

    /// <summary>
    /// Phase (c) of both scope-establishment helpers above — the caller has
    /// been membership-validated; establish the single-farm scope so every
    /// subsequent farm-scoped read AND write (parent <c>p_tenant_{t}</c> WITH
    /// CHECK) passes for the rest of this mutation's transaction.
    /// </summary>
    private async Task SetFarmScopeGucsAsync(Guid farmId, Guid ownerAccountId, CancellationToken ct)
    {
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmId.ToString()}, true)", ct);
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {ownerAccountId.ToString()}, true)", ct);
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — the same membership-validated
    /// single-farm scope <see cref="EstablishFarmScopeForDerivationAsync"/> builds, for a
    /// mutation that names a LOG rather than a farm.
    ///
    /// <para><b>Why it is needed at all.</b> <c>/sync/push</c> is admin-elevated
    /// (<c>TenantTransactionMiddleware</c> skip-list), so <c>TenantConnectionInterceptor</c>
    /// no-ops and NO <c>agrisync.*</c> GUC is set. Under prod FORCE-RLS (the app connects as
    /// <c>agrisync_app</c>, no <c>BYPASSRLS</c>) every farm-scoped read then matches
    /// <c>farm_id = NULL</c> and returns ZERO rows — so a verify mutation that simply looked
    /// the log up would answer <c>DailyLogNotFound</c> for a log that plainly exists, and
    /// would do it silently. That is not a hypothetical: it is measured behaviour, and it is
    /// why "just fall back to the v1 <c>verify_log</c> handler" is not a working route
    /// either — v1 has the same gap on this path.</para>
    ///
    /// <para><b>The chicken-and-egg, and how the isolation survives it.</b> The scope needs a
    /// farm id; the payload carries only a log id. So the log is read FIRST under the
    /// caller's OWN user-scoped policies (<c>agrisync.user_id</c> from the JWT, farm GUC
    /// neutralised to the all-zeros sentinel) — <c>p_user_select_daily_logs</c> surfaces only
    /// logs belonging to farms the caller owns or actively belongs to. A forged log id from
    /// another farm therefore resolves to NOTHING, and the real farm GUC is never set, so
    /// there is no window in which a caller reads a farm he has no claim on.</para>
    /// </summary>
    private async Task<(Domain.Logs.DailyLog? Log, bool IsMember)> EstablishFarmScopeForLogAsync(
        Guid logId, Guid actorUserId, CancellationToken ct)
    {
        // Non-relational (the EF InMemory sync-endpoint harness): no RLS to satisfy and no
        // raw SQL available. Same fallback shape as EstablishFarmScopeForDerivationAsync.
        if (!dbContext.Database.IsRelational())
        {
            var inMemoryLog = await repository.GetDailyLogByIdAsync(logId, ct);
            if (inMemoryLog is null)
            {
                return (null, false);
            }

            return (inMemoryLog, await repository.IsUserMemberOfFarmAsync(inMemoryLog.FarmId, actorUserId, ct));
        }

        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {actorUserId.ToString()}, true)", ct);
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {Guid.Empty.ToString()}, true)", ct);

        var log = await repository.GetDailyLogByIdAsync(logId, ct);
        if (log is null)
        {
            return (null, false);
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(log.FarmId, actorUserId, ct);
        return (log, isMember);
    }

    private async Task<MutationExecutionOutcome> HandleAddLogTaskAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "logTaskId", "dailyLogId", "activityType", "notes", "occurredAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "add_log_task payload contains unsupported fields.");
        }

        var request = DeserializePayload<AddLogTaskPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_log_task.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — add_log_task carries only a
        // dailyLogId, not the farmId, so the farmId must be DISCOVERED via a
        // user-scoped read before scope can be established (same two-phase
        // trap as verify_log — see EstablishFarmScopeForOwnedEntityAsync).
        var dailyLogScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetDailyLogByIdAsync(request.DailyLogId, c),
            log => (Guid)log.FarmId,
            Domain.Common.ShramSafalErrors.DailyLogNotFound,
            ct);
        if (!dailyLogScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(dailyLogScope.Error.Code, dailyLogScope.Error.Description);
        }

        var result = await addLogTaskHandler.HandleAsync(
            new AddLogTaskCommand(
                request.DailyLogId,
                request.ActivityType,
                request.Notes,
                request.OccurredAtUtc,
                request.LogTaskId,
                actorUserId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 (lane F1) — an edit to what Sathi understood. Carries only the log id, so
    /// the farm is DISCOVERED by a user-scoped read before the tenant scope is set — the same
    /// two-phase shape as add_log_task. Authority, the version rules and the re-open live in
    /// <see cref="ReviseLogContentHandler"/>.
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleReviseLogContentAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "dailyLogId", "baseVersion", "content", "reason", "revisedAtUtc", "amountsWithheld", "wordsWithheld"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "revise_log_content payload contains unsupported fields.");
        }

        var contentJson = ReadContentDocument(payload, "revise_log_content", out var contentFailure);
        if (contentFailure is not null)
        {
            return contentFailure;
        }

        if (contentJson is null)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "revise_log_content carries no content.");
        }

        var request = DeserializePayload<ReviseLogContentPayload>(payload);
        if (request is null || request.DailyLogId == Guid.Empty || request.BaseVersion < 1)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for revise_log_content.");
        }

        if (request.Reason is { Length: > 400 })
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "revise_log_content reason exceeds 400 characters.");
        }

        var dailyLogScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetDailyLogByIdAsync(request.DailyLogId, c),
            log => (Guid)log.FarmId,
            Domain.Common.ShramSafalErrors.DailyLogNotFound,
            ct);
        if (!dailyLogScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(dailyLogScope.Error.Code, dailyLogScope.Error.Description);
        }

        var result = await reviseLogContentHandler.HandleAsync(
            new ReviseLogContentCommand(
                request.DailyLogId,
                request.BaseVersion,
                contentJson,
                request.Reason,
                actorUserId,
                actorRole,
                clientRequestId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                // lane MU-3 fix 1 (F8) — the phone says its copy was sent without amounts.
                AmountsWithheld: request.AmountsWithheld,
                WordsWithheld: request.WordsWithheld),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 (lane OF-S) — a saved record moved to another place and/or day. Carries only the log id, so the
    /// farm is DISCOVERED by a user-scoped read before the tenant scope is set (the add_log_task / revise shape).
    /// Who may, where, when, the stale rule and what is tied to the record live in <see cref="MoveDailyLogHandler"/>.
    /// The device + request id dedupe is this class's, like every mutation: a replay answers from the stored result.
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleMoveDailyLogAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "dailyLogId", "baseVersion", "newPlotIds", "wholeFarm", "newLogDate", "reason", "revisedAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "move_daily_log payload contains unsupported fields.");
        }

        var request = DeserializePayload<MoveDailyLogPayload>(payload);
        if (request is null || request.DailyLogId == Guid.Empty || request.BaseVersion < 1)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for move_daily_log.");
        }

        if (request.Reason is { Length: > 400 })
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "move_daily_log reason exceeds 400 characters.");
        }

        var dailyLogScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetDailyLogByIdAsync(request.DailyLogId, c),
            log => (Guid)log.FarmId,
            Domain.Common.ShramSafalErrors.DailyLogNotFound,
            ct);
        if (!dailyLogScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(dailyLogScope.Error.Code, dailyLogScope.Error.Description);
        }

        var result = await moveDailyLogHandler.HandleAsync(
            new MoveDailyLogCommand(
                request.DailyLogId,
                request.BaseVersion,
                request.NewPlotIds,
                request.WholeFarm == true,
                request.NewLogDate,
                request.Reason,
                request.RevisedAtUtc == default ? null : request.RevisedAtUtc,
                actorUserId,
                actorRole,
                clientRequestId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 (lane OF-S) — a worker-count / hours correction made with no internet. The farm is named in the
    /// payload, so its membership-validated scope is set first (the online route's <c>EstablishForCallerAsync</c>);
    /// then the SAME <see cref="CorrectLabourHandler"/> the online route uses runs it: labour authority, the engagement
    /// belonging to this farm AND this log, the stale check against what he saw, the history rows. Idempotency is
    /// this class's (device + request id), so the handler is told not to store its own key — two owners would burn
    /// two keys for one action.
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleCorrectLabourAssignmentAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "labourAssignmentId", "dailyLogId", "farmId", "quantity", "durationHours", "seen", "reason", "correctedAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "correct_labour_assignment payload contains unsupported fields.");
        }

        var request = DeserializePayload<CorrectLabourAssignmentPayload>(payload);
        if (request is null || request.LabourAssignmentId == Guid.Empty || request.DailyLogId == Guid.Empty
            || request.FarmId == Guid.Empty || request.Seen is null)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload", "Invalid payload for correct_labour_assignment.");
        }

        if (request.Reason is { Length: > 400 })
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "correct_labour_assignment reason exceeds 400 characters.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(
                Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        // lane OF-S fix 1 (B004) — a correction can reach the server before its record's create does (the create is
        // held, or waits on a plot made offline). Then the answer is "that record is not here yet" — the code every
        // phone reads as "wait for its create" — never "Forbidden", which would park a farmer's honest change as "not
        // allowed". Read under this farm's scope: a record of another farm resolves to nothing, exactly like add_log_task.
        if (await repository.GetDailyLogByIdAsync(request.DailyLogId, ct) is null)
        {
            return MutationExecutionOutcome.Failure(
                Domain.Common.ShramSafalErrors.DailyLogNotFound.Code, Domain.Common.ShramSafalErrors.DailyLogNotFound.Description);
        }

        var result = await correctLabourHandler.HandleAsync(
            new CorrectLabourCommand(
                new FarmId(request.FarmId),
                request.LabourAssignmentId,
                new UserId(actorUserId),
                deviceId,
                clientRequestId,
                request.Reason,
                request.Quantity is { } q ? new LabourQuantityCorrection(q.WorkerCount, q.MaleCount, q.FemaleCount) : null,
                request.DurationHours,
                AttributionAdds: null,
                AttributionRemovals: null)
            {
                DailyLogId = request.DailyLogId,
                Seen = new LabourCorrectionSeen(
                    request.Seen.WorkerCount, request.Seen.MaleCount, request.Seen.FemaleCount, request.Seen.DurationHours),
                IdempotencyStoredByCaller = true,
            },
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleVerifyLogAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "verificationEventId", "dailyLogId", "status", "reason", "verifiedByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "verify_log payload contains unsupported fields.");
        }

        var request = DeserializePayload<VerifyLogPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for verify_log.");
        }

        if (!TryMapVerificationStatus(request.Status, out var status))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.InvalidVerificationStatus",
                "Status must be one of Approved, Rejected, Draft, Confirmed, Verified, Disputed, CorrectionPending.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — THE verify_log trap. There is
        // no farmId on the wire (payload allow-list above is {verificationEventId,
        // dailyLogId, status, reason, verifiedByUserId}), and the log's farm
        // cannot be learned without the very read FORCE-RLS blocks when no GUC
        // is set at all. Two-phase discovery via EstablishFarmScopeForOwnedEntityAsync:
        // (a) set agrisync.user_id alone → activates the user-scoped daily_logs
        // read policy so this GetDailyLogByIdAsync call is no longer blind;
        // (b) derive FarmId from the log, validate membership;
        // (c) THEN set agrisync.farm_id + agrisync.owner_account_id, because the
        // verifyLogHandler's writes (verification_events, daily_logs) need them.
        var dailyLogScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetDailyLogByIdAsync(request.DailyLogId, c),
            log => (Guid)log.FarmId,
            Domain.Common.ShramSafalErrors.DailyLogNotFound,
            ct);
        if (!dailyLogScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(dailyLogScope.Error.Code, dailyLogScope.Error.Description);
        }

        var result = await verifyLogHandler.HandleAsync(
            new VerifyLogCommand(
                request.DailyLogId,
                status,
                request.Reason,
                actorUserId,
                request.VerificationEventId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — THE APPROVE BUTTON'S ONLY PATH.
    ///
    /// <para>Until this landed, <c>verify_log_v2</c> answered
    /// <c>MUTATION_TYPE_UNIMPLEMENTED</c>, which <c>RejectionPolicy.ts</c> classifies
    /// PERMANENT, which parks the queue row in <c>REJECTED_USER_REVIEW</c> — a state
    /// <c>pendingMutations.ts</c> does not shield — so the next pull reverted the farmer's
    /// approval. An owner could not approve a mukadam's log AT ALL, and the failure was
    /// silent.</para>
    ///
    /// <para><b>The payload is the canonical contract</b>
    /// (<c>sync-contract/schemas/payloads/verify_log_v2.zod.ts</c> →
    /// <see cref="VerifyLogV2Payload"/>), and the allow-list below is exactly its fields.
    /// It deliberately does NOT include <c>callerRole</c>: authority is read from the
    /// operator's membership by <see cref="VerifyLogHandler"/> (and gated owner-tier by
    /// <c>IAuthorizationEnforcer.EnsureCanVerify</c> in the pipeline), never from the wire.
    /// A payload that carries one is refused rather than silently stripped — a client that
    /// thinks it is sending its own authority and is told "applied" has been lied to.</para>
    ///
    /// <para><b><c>verifierUserId</c> is not believed either.</b> It rides the contract for
    /// the client's own bookkeeping; the command is built with <paramref name="actorUserId"/>,
    /// which came from the JWT. Whoever the payload names, the ledger records who acted.</para>
    ///
    /// <para><b>The decision vocabulary is the FSM's, not a synonym list.</b> <c>confirm</c>
    /// and <c>verify</c> are separate decisions precisely because they are separate edges;
    /// collapsing them is what a <c>Draft → Verified</c> shortcut would have done.</para>
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleVerifyLogV2Async(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        // PLR-D10 I27 adds "reviewBasis" (heard / read) and "logVersion" (the version he saw).
        if (!PayloadHasOnly(payload, "logId", "verifierUserId", "decision", "reason", "decidedAt", "reviewBasis", "logVersion"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "verify_log_v2 payload contains unsupported fields.");
        }

        var request = DeserializePayload<VerifyLogV2Payload>(payload);
        if (request is null || request.LogId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for verify_log_v2.");
        }

        if (!TryMapVerifyDecision(request.Decision, out var status))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.InvalidVerificationStatus",
                "decision must be one of confirm, verify, dispute, request_correction.");
        }

        var (dailyLog, isMember) = await EstablishFarmScopeForLogAsync(request.LogId, actorUserId, ct);
        if (dailyLog is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.DailyLogNotFound", "Daily log was not found.");
        }

        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        // PLR-D10 I27 — a basis we do not know, or a version below 1, is a malformed payload
        // (the phone's own schema cannot produce one): refused, never guessed.
        if (!Domain.Logs.ReviewBasis.TryNormalize(request.ReviewBasis, out var reviewBasis)
            || request.LogVersion is < 1)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "verify_log_v2 reviewBasis must be heard or read, and logVersion at least 1.");
        }

        var result = await verifyLogHandler.HandleAsync(
            new VerifyLogCommand(
                request.LogId,
                status,
                request.Reason,
                actorUserId,
                VerificationEventId: null,
                actorRole,
                clientRequestId,
                ReviewBasis: reviewBasis,
                ExpectedLogVersion: request.LogVersion,
                ReviewBasisOmittedOnV2: reviewBasis is null,
                // lane 2b (MU design §11.2) — when the phone says he decided, so a decision made
                // offline while his confirm-records authority was alive still counts (flagged).
                DecidedAtUtc: request.DecidedAt),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleAddCostEntryAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Widened for the money-direction wave. `direction` is the farmer's own
        // statement of which way the money moved — before it existed, income and
        // expense were byte-identical on this wire and both landed as a CostEntry,
        // so a ₹50,000 sale rebuilt on a new phone as ₹50,000 spent. The other six
        // keys are the line detail the client held locally and dropped here.
        // Set equality with add_cost_entry.zod.ts is enforced by
        // sync-contract/tests/allowlist-parity.test.ts — which parses THIS line,
        // so it must stay on one line.
        if (!PayloadHasOnly(payload, "costEntryId", "farmId", "plotId", "cropCycleId", "categoryId", "description", "amount", "currencyCode", "entryDate", "createdByUserId", "location", "direction", "qty", "unit", "unitPrice", "paymentMode", "vendorName", "attachments"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "add_cost_entry payload contains unsupported fields.");
        }

        var request = DeserializePayload<AddCostEntryPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_cost_entry.");
        }

        // Wire-stability guard for the generated payload swap (T-IGH-02-CS-PAYLOADS).
        // Same rationale as HandleCreateDailyLogAsync: the generated
        // AddCostEntryPayload.CostEntryId is non-nullable `Guid` (the canonical
        // zod schema marks costEntryId required), whereas the old hand-authored
        // record was `Guid?`. AddCostEntryHandler does
        // `command.CostEntryId ?? idGenerator.New()`, so a Guid.Empty (from an
        // omitted field) would silently create a cost entry with an empty id
        // instead of a server-generated one. Map Empty back to null to preserve
        // the prior wire behavior exactly.
        Guid? costEntryId = request.CostEntryId == Guid.Empty ? null : request.CostEntryId;

        // Which way the money moved. Mapped TOTALLY and explicitly, exactly like
        // `scope` in HandleCreateDailyLogAsync.
        //
        // Absent / empty => NULL, meaning NOBODY SAID. Every client shipped
        // before this field existed omits it, and those clients pushed income
        // down this same wire — so reading their silence as Expense would be the
        // very inversion this field exists to end (`P4`). Null travels all the
        // way to the column; nothing downstream may fill it in.
        //
        // An UNRECOGNISED value is rejected, never nulled: a producer that said
        // something we cannot read has still SAID something, and quietly
        // demoting that to "unknown" would lose a statement rather than surface
        // a broken producer. Enum.TryParse is deliberately not used — it also
        // accepts the underlying numeric values, which are not on this contract.
        MoneyDirection? direction;
        switch (request.Direction)
        {
            case null or "":
                direction = null;
                break;
            case "Expense":
                direction = MoneyDirection.Expense;
                break;
            case "Income":
                direction = MoneyDirection.Income;
                break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    "add_cost_entry payload carries an unrecognised direction.");
        }

        // Same treatment for the one other closed vocabulary on this payload.
        // A value outside the four is a non-conforming producer, and storing it
        // would silently overflow the column rather than say so here.
        switch (request.PaymentMode)
        {
            case null or "" or "Cash" or "UPI" or "Bank" or "Credit":
                break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload",
                    "add_cost_entry payload carries an unrecognised paymentMode.");
        }

        // The client's stated attachment ids, stored verbatim as a JSON array.
        // NULL when the producer said nothing; "[]" when it said "none linked".
        // The two are different facts and both are preserved.
        var clientAttachmentIdsJson = request.Attachments is null
            ? null
            : JsonSerializer.Serialize(request.Attachments);

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleCreatePlotAsync.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — propagate batch-level AppVersion
        // onto the replayed AddCostEntryCommand. Same rationale as
        // HandleCreateDailyLogAsync above.
        var result = await addCostEntryHandler.HandleAsync(
            new AddCostEntryCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                CategoryId: request.CategoryId,
                Description: request.Description,
                Amount: request.Amount,
                CurrencyCode: request.CurrencyCode,
                EntryDate: request.EntryDate,
                CreatedByUserId: actorUserId,
                Location: ToLocationSnapshot(request.Location),
                CostEntryId: costEntryId,
                ActorRole: actorRole,
                ClientCommandId: clientRequestId,
                SourceAiJobId: null,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                Direction: direction,
                Quantity: request.Qty,
                Unit: request.Unit,
                UnitPrice: request.UnitPrice,
                PaymentMode: request.PaymentMode,
                VendorName: request.VendorName,
                ClientAttachmentIdsJson: clientAttachmentIdsJson),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleAttendanceMarkAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        // Set equality with attendance_mark.zod.ts is enforced by
        // sync-contract/tests/allowlist-parity.test.ts, which parses THIS line —
        // so it must stay on one line.
        if (!PayloadHasOnly(payload, "attendanceMarkId", "farmId", "fieldOperatorId", "workDate", "dayMark", "nightMark", "hoursWorked", "extraHours", "resolvedLabourAssignmentId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "attendance.mark payload contains unsupported fields.");
        }

        var request = DeserializePayload<AttendanceMarkPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for attendance.mark.");
        }

        // Closed vocabularies, mapped TOTALLY like `direction` in
        // HandleAddCostEntryAsync. Absence = null = "this door said NOTHING
        // about that half" (B002): every capture door speaks ONE half per
        // mark, so on a first mark a null half lands as Unmarked ("nobody
        // said") and on an amend it PRESERVES the stored fact — never a
        // full-replace that erases a stated half with an unspoken one. An
        // unrecognised value is a broken producer and is refused, never
        // demoted to unknown.
        DayMark? day;
        switch (request.DayMark)
        {
            case null or "": day = null; break;
            case "Full": day = DayMark.Full; break;
            case "Half": day = DayMark.Half; break;
            case "Absent": day = DayMark.Absent; break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload", "attendance.mark payload carries an unrecognised dayMark.");
        }
        NightMark? night;
        switch (request.NightMark)
        {
            case null or "": night = null; break;
            case "Worked": night = NightMark.Worked; break;
            case "NotWorked": night = NightMark.NotWorked; break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload", "attendance.mark payload carries an unrecognised nightMark.");
        }

        // WorkDate arrives as the generated payload's DateOnly (the zod
        // YYYY-MM-DD regex maps to DateOnly in generate-csharp-payloads.ts) —
        // a malformed date fails DESERIALIZATION above and lands, named, in
        // the batch loop's SyncMutationUnhandled guard, the same posture as
        // add_cost_entry's entryDate. No second parse here to drift from it.

        // C5 — /sync/ is on TenantTransactionMiddleware's skip list (:225), so no
        // GUC is set until this call, and p_tenant_attendance_marks' WITH CHECK
        // (20260831180408:57) would refuse the INSERT with a NULL comparison.
        // EstablishFarmScopeForDerivationAsync is what makes the mark writable here.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await recordAttendanceMarkHandler.HandleAsync(
            new UseCases.Labour.RecordAttendanceMark.RecordAttendanceMarkCommand(
                request.AttendanceMarkId, request.FarmId, request.FieldOperatorId, request.WorkDate,
                day, night, request.HoursWorked, request.ExtraHours,
                request.ResolvedLabourAssignmentId, actorUserId),
            ct);

        if (result.IsSuccess
            && result.Value.Outcome == UseCases.Labour.RecordAttendanceMark.AttendanceDayOutcome.Contradicted)
        {
            // A fact the OWNER must rule on, surfaced to the device as a
            // PERMANENT rejection (the answer arrives as a NEW mutation carrying
            // resolvedLabourAssignmentId — re-pushing these bytes can never
            // succeed). Nothing was staged: the check runs pre-staging, so the
            // rollback above this frame has nothing to lose.
            return MutationExecutionOutcome.Failure(
                "ShramSafal.AttendanceContradiction",
                "Two of today's works claim different attendance for this person. Answer in Labour, then it will sync.");
        }

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleAllocateGlobalExpenseAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "dayLedgerId", "costEntryId", "allocationBasis", "allocations", "createdByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "allocate_global_expense payload contains unsupported fields.");
        }

        var request = DeserializePayload<AllocateGlobalExpensePayload>(payload);
        if (request is null || request.CostEntryId == Guid.Empty || string.IsNullOrWhiteSpace(request.AllocationBasis))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for allocate_global_expense.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — this dispatch case had NO
        // membership check at all (AllocateGlobalExpenseHandler does its own
        // GetCostEntryByIdAsync + IsUserMemberOfFarmAsync internally, but both
        // are RLS-protected reads that need scope established first — same
        // unknown-farmId trap as correct_cost_entry, via ssf.cost_entries).
        var costEntryScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetCostEntryByIdAsync(request.CostEntryId, c),
            entry => (Guid)entry.FarmId,
            Domain.Common.ShramSafalErrors.CostEntryNotFound,
            ct);
        if (!costEntryScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(costEntryScope.Error.Code, costEntryScope.Error.Description);
        }

        var mappedAllocations = (request.Allocations ?? [])
            .Select(a => new AllocateGlobalExpenseAllocationCommand(a.PlotId, a.Amount))
            .ToList();

        var result = await allocateGlobalExpenseHandler.HandleAsync(
            new AllocateGlobalExpenseCommand(
                request.CostEntryId,
                request.AllocationBasis,
                mappedAllocations,
                actorUserId,
                request.DayLedgerId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private static LocationSnapshot? ToLocationSnapshot(LocationItem? payload)
    {
        if (payload is null)
        {
            return null;
        }

        return new LocationSnapshot
        {
            Latitude = payload.Latitude,
            Longitude = payload.Longitude,
            AccuracyMeters = payload.AccuracyMeters,
            Altitude = payload.Altitude,
            CapturedAtUtc = payload.CapturedAtUtc,
            Provider = payload.Provider,
            PermissionState = payload.PermissionState
        };
    }

    private async Task<MutationExecutionOutcome> HandleCorrectCostEntryAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "financeCorrectionId", "costEntryId", "correctedAmount", "currencyCode", "reason", "correctedByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "correct_cost_entry payload contains unsupported fields.");
        }

        var request = DeserializePayload<CorrectCostEntryPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for correct_cost_entry.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — correct_cost_entry carries
        // only a costEntryId, not the farmId; same unknown-farmId two-phase
        // trap as verify_log, via ssf.cost_entries.
        var costEntryScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetCostEntryByIdAsync(request.CostEntryId, c),
            entry => (Guid)entry.FarmId,
            Domain.Common.ShramSafalErrors.CostEntryNotFound,
            ct);
        if (!costEntryScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(costEntryScope.Error.Code, costEntryScope.Error.Description);
        }

        var result = await correctCostEntryHandler.HandleAsync(
            new CorrectCostEntryCommand(
                request.CostEntryId,
                request.CorrectedAmount,
                request.CurrencyCode,
                request.Reason,
                actorUserId,
                request.FinanceCorrectionId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleSetPriceConfigAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "priceConfigId", "itemName", "unitPrice", "currencyCode", "effectiveFrom", "version", "createdByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "set_price_config payload contains unsupported fields.");
        }

        var request = DeserializePayload<SetPriceConfigPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for set_price_config.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — GetFarmIdsForUserAsync reads
        // ssf.farms + ssf.farm_memberships filtered by userId; under FORCE-RLS
        // with no GUC set at all it always returns empty (fail-closed). Only
        // phase (a) is needed here — PriceConfig is a global (non-farm-scoped)
        // lookup, so there is no known/derived farmId to scope a write to.
        if (dbContext.Database.IsRelational())
        {
            await SetUserScopedReadGucsAsync(actorUserId, ct);
        }

        var farmIds = await repository.GetFarmIdsForUserAsync(actorUserId, ct);
        if (farmIds.Count == 0)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User must belong to at least one farm.");
        }

        var result = await setPriceConfigVersionHandler.HandleAsync(
            new SetPriceConfigVersionCommand(
                request.ItemName,
                request.UnitPrice,
                request.CurrencyCode,
                request.EffectiveFrom,
                request.Version,
                actorUserId,
                request.PriceConfigId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreateAttachmentAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "attachmentId", "farmId", "linkedEntityId", "linkedEntityType", "fileName", "mimeType", "createdByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_attachment payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateAttachmentPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_attachment.");
        }

        // Wire-stability guard for the generated payload swap (T-IGH-02-CS-PAYLOADS).
        // Same rationale as HandleCreateDailyLogAsync / HandleAddCostEntryAsync: the
        // generated CreateAttachmentPayload.AttachmentId is non-nullable `Guid` (the
        // canonical zod schema marks attachmentId required), whereas the old
        // hand-authored record was `Guid?`. CreateAttachmentHandler does
        // `command.AttachmentId ?? idGenerator.New()`, so a Guid.Empty (from an
        // omitted field) would silently create an attachment with an empty id
        // instead of a server-generated one. Map Empty back to null to preserve
        // the prior wire behavior exactly.
        Guid? attachmentId = request.AttachmentId == Guid.Empty ? null : request.AttachmentId;

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleCreatePlotAsync.
        // Photo/attachment upload has been dead in production since May for
        // exactly this reason (the naked IsUserMemberOfFarmAsync always
        // returned false under FORCE-RLS with no GUC set).
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createAttachmentHandler.HandleAsync(
            // Stage A0 Task 3 — named arguments; see HandleCreateCropCycleAsync for why.
            // Note CreatedByUserId, NOT ActorUserId: this record names its actor
            // differently from CreateCropCycleCommand. It is deliberately the
            // token-derived actorUserId and never request.CreatedByUserId — trusting
            // the client's claim of who created an attachment would be an attribution
            // regression. Behaviour-neutral: every argument binds exactly as before.
            new CreateAttachmentCommand(
                FarmId: request.FarmId,
                LinkedEntityId: request.LinkedEntityId,
                LinkedEntityType: request.LinkedEntityType,
                FileName: request.FileName,
                MimeType: request.MimeType,
                CreatedByUserId: actorUserId,
                AttachmentId: attachmentId,
                // Stage A0 / A3 — ActorRole no longer travels on the command; the handler
                // resolves the role on the target farm. Caught by the compiler ONLY because
                // Task 3 made this call named first.
                ClientCommandId: clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleTestInstanceCollectedAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "testInstanceId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "testInstance.collected payload contains unsupported fields.");
        }

        var request = DeserializePayload<TestInstanceCollectedPayload>(payload);
        if (request is null || request.TestInstanceId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "Invalid payload for testInstance.collected.");
        }

        if (!TryParseAppRole(actorRole, out var role))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.TestRoleNotAllowed",
                $"Unknown actorRole '{actorRole}' for testInstance.collected.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — testInstanceId carries no
        // farmId; ssf.test_instances also had NO user-scoped read policy until
        // this session's migration (job_cards / compliance_signals /
        // test_instances), so this read was blind under FORCE-RLS regardless.
        // Two-phase discovery via EstablishFarmScopeForOwnedEntityAsync.
        var instanceScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => testInstanceRepository.GetByIdAsync(request.TestInstanceId, c),
            instance => instance.FarmId.Value,
            Domain.Common.ShramSafalErrors.TestInstanceNotFound,
            ct);
        if (!instanceScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(instanceScope.Error.Code, instanceScope.Error.Description);
        }

        var result = await recordTestCollectedHandler.HandleAsync(
            new RecordTestCollectedCommand(
                TestInstanceId: request.TestInstanceId,
                CallerUserId: new UserId(actorUserId),
                CallerRole: role),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleTestInstanceReportedAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "testInstanceId", "results", "attachmentIds", "clientCommandId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "testInstance.reported payload contains unsupported fields.");
        }

        var request = DeserializePayload<TestInstanceReportedPayload>(payload);
        if (request is null ||
            request.TestInstanceId == Guid.Empty ||
            request.Results is null ||
            request.Results.Count == 0)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "Invalid payload for testInstance.reported.");
        }

        if (!TryParseAppRole(actorRole, out var role))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.TestRoleNotAllowed",
                $"Unknown actorRole '{actorRole}' for testInstance.reported.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleTestInstanceCollectedAsync.
        var instanceScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => testInstanceRepository.GetByIdAsync(request.TestInstanceId, c),
            instance => instance.FarmId.Value,
            Domain.Common.ShramSafalErrors.TestInstanceNotFound,
            ct);
        if (!instanceScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(instanceScope.Error.Code, instanceScope.Error.Description);
        }

        var instance = instanceScope.Value;

        List<TestResult> results;
        try
        {
            results = request.Results
                .Select(r => TestResult.Create(
                    r.ParameterCode,
                    r.ParameterValue,
                    r.Unit ?? string.Empty,
                    r.ReferenceRangeLow,
                    r.ReferenceRangeHigh))
                .ToList();
        }
        catch (ArgumentException)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "One or more test results are invalid.");
        }

        var attachmentIds = (IReadOnlyCollection<Guid>)(request.AttachmentIds ?? Array.Empty<Guid>());

        var result = await recordTestResultHandler.HandleAsync(
            new RecordTestResultCommand(
                TestInstanceId: request.TestInstanceId,
                Results: results,
                AttachmentIds: attachmentIds,
                CallerUserId: new UserId(actorUserId),
                CallerRole: role,
                ClientCommandId: request.ClientCommandId ?? clientRequestId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1 Task 2 — <c>adopt_schedule</c> on the REST door's own handler. The actor is the token's
    /// user, never the payload's <c>actorUserId</c> / <c>actorRole</c> (kept in the contract for the phones that send them,
    /// read by nobody). <c>referenceDate</c> is optional: 1.0.17's shape (none) adopts with the season's start as day 0 (P11).
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleAdoptScheduleAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "farmId", "plotId", "cropCycleId", "scheduleTemplateId", "actorUserId", "actorRole", "clientCommandId", "subscriptionId", "referenceDate", "decidedAtUtc", "carryOver"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "adopt_schedule payload contains unsupported fields.");
        }

        if (!TryDeserializeSchedulePayload<AdoptSchedulePayload>(payload, out var request) || request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for adopt_schedule.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await adoptScheduleHandler.HandleAsync(
            new ShramSafal.Application.UseCases.Schedules.AdoptSchedule.AdoptScheduleCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                ScheduleTemplateId: request.ScheduleTemplateId,
                ActorUserId: actorUserId,
                ActorRole: actorRole,
                ClientCommandId: request.ClientCommandId ?? clientRequestId,
                SubscriptionId: request.SubscriptionId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId,
                ReferenceDate: request.ReferenceDate,
                DecidedAtUtc: request.DecidedAtUtc,
                // spec: plr-d10 lane L8b-1F (R7) - the phone's one-time upload of a choice it already made; absent = a new choice (P11).
                CarryOver: request.CarryOver == true),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1 Task 2 — <c>migrate_schedule</c> (switch a plot to another library schedule) on the REST
    /// door's own handler. Same actor rule as adopt; the reason is one of the contract's five names exactly.
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleMigrateScheduleAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "farmId", "plotId", "cropCycleId", "newScheduleTemplateId", "reason", "actorUserId", "reasonText", "actorRole", "clientCommandId", "newSubscriptionId", "migrationEventId", "referenceDate", "decidedAtUtc", "fromSubscriptionId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "migrate_schedule payload contains unsupported fields.");
        }

        if (!TryDeserializeSchedulePayload<MigrateSchedulePayload>(payload, out var request) || request is null
            || !Enum.GetNames<Domain.Schedules.ScheduleMigrationReason>().Contains(request.Reason, StringComparer.Ordinal))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for migrate_schedule.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await migrateScheduleHandler.HandleAsync(
            new ShramSafal.Application.UseCases.Schedules.MigrateSchedule.MigrateScheduleCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                NewScheduleTemplateId: request.NewScheduleTemplateId,
                Reason: Enum.Parse<Domain.Schedules.ScheduleMigrationReason>(request.Reason),
                ActorUserId: actorUserId,
                ReasonText: request.ReasonText,
                ActorRole: actorRole,
                ClientCommandId: request.ClientCommandId ?? clientRequestId,
                NewSubscriptionId: request.NewSubscriptionId,
                MigrationEventId: request.MigrationEventId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId,
                ReferenceDate: request.ReferenceDate,
                DecidedAtUtc: request.DecidedAtUtc,
                FromSubscriptionId: request.FromSubscriptionId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>spec: plr-d10 lane L8b-1 Task 2 — <c>abandon_schedule</c> on the REST door's own handler (same actor rule).</summary>
    private async Task<MutationExecutionOutcome> HandleAbandonScheduleAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "farmId", "plotId", "cropCycleId", "actorUserId", "reasonText", "actorRole", "clientCommandId", "decidedAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "abandon_schedule payload contains unsupported fields.");
        }

        if (!TryDeserializeSchedulePayload<AbandonSchedulePayload>(payload, out var request) || request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for abandon_schedule.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await abandonScheduleHandler.HandleAsync(
            new ShramSafal.Application.UseCases.Schedules.AbandonSchedule.AbandonScheduleCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                ActorUserId: actorUserId,
                ReasonText: request.ReasonText,
                ActorRole: actorRole,
                ClientCommandId: request.ClientCommandId ?? clientRequestId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId,
                DecidedAtUtc: request.DecidedAtUtc),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// lane L8b-1 — a schedule payload whose values do not read (a malformed id or day) is a refused payload the phone
    /// parks for the farmer (SyncInvalidPayload, permanent), never an unexplained fault it would retry for ever. Not a
    /// silent catch: the caller answers the refusal, and the rejection chokepoint logs it. The catch also names its
    /// landing place (the same pattern as "sync.rejection_emit_failed"): only the exception TYPE and the payload type
    /// are recorded, because exception messages can carry payload text.
    /// </summary>
    private static bool TryDeserializeSchedulePayload<TPayload>(JsonElement payload, out TPayload? request)
        where TPayload : class
    {
        try
        {
            request = DeserializePayload<TPayload>(payload);
            return request is not null;
        }
        catch (JsonException ex)
        {
            Activity.Current?.AddEvent(new ActivityEvent(
                "sync.schedule_payload_unreadable",
                tags: new ActivityTagsCollection
                {
                    { "exception.type", ex.GetType().Name },
                    { "payload_type", typeof(TPayload).Name }
                }));
            request = null;
            return false;
        }
    }

    /// <summary>
    /// Parses the <c>actorRole</c> header string into the strongly-typed
    /// <see cref="AppRole"/> expected by the test-stack handlers. The string
    /// may be bare (e.g. <c>"LabOperator"</c>) or prefixed with the context
    /// (<c>"shramsafal:LabOperator"</c>) — strip the prefix and try to parse.
    /// </summary>
    private static bool TryParseAppRole(string actorRole, out AppRole role)
    {
        role = default;
        if (string.IsNullOrWhiteSpace(actorRole))
        {
            return false;
        }

        var raw = actorRole.Trim();
        var colonIdx = raw.IndexOf(':');
        if (colonIdx >= 0 && colonIdx < raw.Length - 1)
        {
            raw = raw[(colonIdx + 1)..];
        }

        return Enum.TryParse(raw, ignoreCase: true, out role);
    }

    private static bool PayloadHasOnly(JsonElement payload, params string[] allowedProperties)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var allowed = new HashSet<string>(allowedProperties, StringComparer.OrdinalIgnoreCase);
        foreach (var property in payload.EnumerateObject())
        {
            if (!allowed.Contains(property.Name))
            {
                return false;
            }
        }

        return true;
    }

    private static TPayload? DeserializePayload<TPayload>(JsonElement payload)
        where TPayload : class
    {
        if (payload.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return payload.Deserialize<TPayload>(SerializerOptions);
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — maps the canonical <c>verify_log_v2</c>
    /// <c>decision</c> vocabulary onto the FSM's statuses. Deliberately NOT routed through
    /// <see cref="TryMapVerificationStatus"/>: that method also accepts raw enum names and
    /// the legacy v1 aliases ("approved", "rejected", "pending"), and the v2 contract is a
    /// closed four-value enum. Accepting more than the contract says here would let a client
    /// reach a status the schema never promised it could.
    /// </summary>
    private static bool TryMapVerifyDecision(string? decision, out VerificationStatus status)
    {
        switch (decision?.Trim().ToLowerInvariant())
        {
            case "confirm":
                status = VerificationStatus.Confirmed;
                return true;
            case "verify":
                status = VerificationStatus.Verified;
                return true;
            case "dispute":
                status = VerificationStatus.Disputed;
                return true;
            case "request_correction":
                status = VerificationStatus.CorrectionPending;
                return true;
            default:
                status = VerificationStatus.Draft;
                return false;
        }
    }

    private static bool TryMapVerificationStatus(string? rawStatus, out VerificationStatus status)
    {
        if (Enum.TryParse<VerificationStatus>(rawStatus, ignoreCase: true, out status))
        {
            return true;
        }

        var normalized = rawStatus?.Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "approved":
                status = VerificationStatus.Confirmed;
                return true;
            case "rejected":
                status = VerificationStatus.Disputed;
                return true;
            case "pending":
                status = VerificationStatus.CorrectionPending;
                return true;
            default:
                status = VerificationStatus.Draft;
                return false;
        }
    }

    private static object? DeserializeStoredPayload(string payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return null;
        }

        using var document = JsonDocument.Parse(payloadJson);
        return document.RootElement.Clone();
    }

    private static SyncMutationResultDto CreateAppliedResult(string clientRequestId, string mutationType, object? data)
    {
        return new SyncMutationResultDto(clientRequestId, mutationType, "applied", data, null, null);
    }

    private static SyncMutationResultDto CreateDuplicateResult(
        string clientRequestId,
        string mutationType,
        StoredSyncMutation storedMutation)
    {
        return new SyncMutationResultDto(
            clientRequestId,
            mutationType,
            "duplicate",
            DeserializeStoredPayload(storedMutation.ResponsePayloadJson),
            null,
            null);
    }

    private static SyncMutationResultDto CreateFailedResult(
        string clientRequestId,
        string mutationType,
        string? errorCode,
        string? errorMessage)
    {
        return new SyncMutationResultDto(
            clientRequestId,
            mutationType,
            RejectedStatus,
            null,
            errorCode,
            errorMessage);
    }

    private async Task<SyncMutationResultDto> ResolveDuplicateOrStoreFailureAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        CancellationToken ct)
    {
        var deduplicated = await syncMutationStore.GetAsync(deviceId, clientRequestId, ct);
        if (deduplicated is not null)
        {
            return CreateDuplicateResult(clientRequestId, mutationType, deduplicated);
        }

        return CreateFailedResult(
            clientRequestId,
            mutationType,
            "ShramSafal.SyncMutationStoreError",
            "Mutation was rolled back because the sync mutation store could not persist the deduplication record.");
    }

    // --- CEI Phase 3 §4.6 — compliance mutations -------------------------------------------

    private async Task<MutationExecutionOutcome> HandleComplianceAcknowledgeAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        var request = DeserializePayload<ComplianceAcknowledgePayload>(payload);
        if (request is null || request.SignalId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "Invalid payload for compliance.acknowledge — signalId is required.");
        }

        if (!Enum.TryParse<AppRole>(actorRole, ignoreCase: true, out var role))
            role = AppRole.Worker;

        // Phase 1 tenant-scope fix (2026-07-19) — this dispatch case had NO
        // farm-membership check at all (AcknowledgeSignalHandler only role-
        // gates + reads ssf.compliance_signals, which is farm_id-keyed FORCE-RLS
        // with no user-scoped read policy until this session's new migration).
        // Establishing scope here is a two-fold fix: it makes the read visible
        // AND — as a side effect of the RLS membership-EXISTS clause — closes a
        // pre-existing gap where any caller who knew a SignalId could acknowledge
        // a signal on a farm they do not belong to.
        var signalScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => complianceSignalRepository.GetByIdAsync(request.SignalId, c),
            signal => (Guid)signal.FarmId,
            Domain.Common.ShramSafalErrors.ComplianceSignalNotFound,
            ct);
        if (!signalScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(signalScope.Error.Code, signalScope.Error.Description);
        }

        var command = new AcknowledgeSignalCommand(
            SignalId: request.SignalId,
            CallerUserId: new UserId(actorUserId),
            CallerRole: role);

        var result = await acknowledgeSignalHandler.HandleAsync(command, ct);
        return result.IsSuccess
            ? MutationExecutionOutcome.Success(new { signalId = request.SignalId })
            : MutationExecutionOutcome.Failure(result.Error.Code, result.Error.Description);
    }

    private async Task<MutationExecutionOutcome> HandleComplianceResolveAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        var request = DeserializePayload<ComplianceResolvePayload>(payload);
        if (request is null || request.SignalId == Guid.Empty || string.IsNullOrWhiteSpace(request.Note))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "Invalid payload for compliance.resolve — signalId and note are required.");
        }

        if (!Enum.TryParse<AppRole>(actorRole, ignoreCase: true, out var role))
            role = AppRole.Worker;

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleComplianceAcknowledgeAsync.
        var signalScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => complianceSignalRepository.GetByIdAsync(request.SignalId, c),
            signal => (Guid)signal.FarmId,
            Domain.Common.ShramSafalErrors.ComplianceSignalNotFound,
            ct);
        if (!signalScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(signalScope.Error.Code, signalScope.Error.Description);
        }

        var command = new ResolveSignalCommand(
            SignalId: request.SignalId,
            CallerUserId: new UserId(actorUserId),
            CallerRole: role,
            Note: request.Note);

        var result = await resolveSignalHandler.HandleAsync(command, ct);
        return result.IsSuccess
            ? MutationExecutionOutcome.Success(new { signalId = request.SignalId })
            : MutationExecutionOutcome.Failure(result.Error.Code, result.Error.Description);
    }

    // --- CEI Phase 4 §4.8 — job card mutations -------------------------------------------

    private async Task<MutationExecutionOutcome> HandleJobCardCreateAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardCreatePayload>(payload);
        if (request is null || request.FarmId == Guid.Empty || request.PlotId == Guid.Empty ||
            request.LineItems is null || request.LineItems.Count == 0)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.create.");
        }

        if (!Enum.TryParse<AppRole>(actorRole, ignoreCase: true, out var role)) role = AppRole.Worker;

        // Phase 1 tenant-scope fix (2026-07-19) — farmId is known up-front on
        // this payload, so use the known-farmId helper (same as
        // HandleCreatePlotAsync) before calling createJobCardHandler, whose
        // internal GetUserRoleForFarmAsync read is farm_id-keyed FORCE-RLS.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        // The generated JobCardCreatePayload exposes line items as the
        // generator's nested LineItemsItem record; CreateJobCardCommand expects
        // the application's JobCardLineItemDto. The two shapes are identical
        // (ActivityType, ExpectedHours, RatePerHourAmount, RatePerHourCurrencyCode,
        // Notes?), so map field-for-field. Wire-format is unchanged.
        var lineItems = request.LineItems
            .Select(li => new JobCardLineItemDto(
                li.ActivityType,
                li.ExpectedHours,
                li.RatePerHourAmount,
                li.RatePerHourCurrencyCode,
                li.Notes))
            .ToList();

        var result = await createJobCardHandler.HandleAsync(
            new CreateJobCardCommand(
                FarmId: new FarmId(request.FarmId),
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                PlannedDate: request.PlannedDate,
                LineItems: lineItems,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardAssignAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardAssignPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || request.WorkerUserId == Guid.Empty)
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.assign.");

        // Phase 1 tenant-scope fix (2026-07-19) — only a jobCardId is on the
        // wire; same unknown-farmId two-phase trap as verify_log, via
        // ssf.job_cards (needs this session's new user-scoped read policy).
        var jobCardScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetJobCardByIdAsync(request.JobCardId, c),
            jobCard => jobCard.FarmId.Value,
            Domain.Common.ShramSafalErrors.JobCardNotFound,
            ct);
        if (!jobCardScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(jobCardScope.Error.Code, jobCardScope.Error.Description);
        }

        var result = await assignJobCardHandler.HandleAsync(
            new AssignJobCardCommand(
                JobCardId: request.JobCardId,
                WorkerUserId: new UserId(request.WorkerUserId),
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardStartAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardStartPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty)
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.start.");

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleJobCardAssignAsync.
        var jobCardScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetJobCardByIdAsync(request.JobCardId, c),
            jobCard => jobCard.FarmId.Value,
            Domain.Common.ShramSafalErrors.JobCardNotFound,
            ct);
        if (!jobCardScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(jobCardScope.Error.Code, jobCardScope.Error.Description);
        }

        var result = await startJobCardHandler.HandleAsync(
            new StartJobCardCommand(
                JobCardId: request.JobCardId,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardCompleteAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardCompletePayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || request.DailyLogId == Guid.Empty)
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.complete.");

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleJobCardAssignAsync.
        // Once farm_id is set to the job card's farm, CompleteJobCardHandler's
        // internal GetDailyLogByIdAsync(command.DailyLogId) is also farm_id-
        // gated: a DailyLogId belonging to a DIFFERENT farm is now invisible
        // under RLS and surfaces as DailyLogNotFound rather than the
        // (dev-only, non-RLS) JobCardDailyLogMismatch — strictly more secure,
        // not a regression.
        var jobCardScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetJobCardByIdAsync(request.JobCardId, c),
            jobCard => jobCard.FarmId.Value,
            Domain.Common.ShramSafalErrors.JobCardNotFound,
            ct);
        if (!jobCardScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(jobCardScope.Error.Code, jobCardScope.Error.Description);
        }

        var result = await completeJobCardHandler.HandleAsync(
            new CompleteJobCardCommand(
                JobCardId: request.JobCardId,
                DailyLogId: request.DailyLogId,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardSettleAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, string? appVersion, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardSettlePayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || request.ActualPayoutAmount <= 0 ||
            string.IsNullOrWhiteSpace(request.ActualPayoutCurrencyCode))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.settle.");
        }

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleJobCardAssignAsync.
        var jobCardScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetJobCardByIdAsync(request.JobCardId, c),
            jobCard => jobCard.FarmId.Value,
            Domain.Common.ShramSafalErrors.JobCardNotFound,
            ct);
        if (!jobCardScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(jobCardScope.Error.Code, jobCardScope.Error.Description);
        }

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — propagate batch-level AppVersion
        // onto the replayed SettleJobCardPayoutCommand so the labour-payout
        // CostEntry's Provenance.AppVersion records the actual client version
        // even when the settlement was queued offline and replayed via sync.
        var result = await settleJobCardPayoutHandler.HandleAsync(
            new SettleJobCardPayoutCommand(
                JobCardId: request.JobCardId,
                ActualPayoutAmount: request.ActualPayoutAmount,
                ActualPayoutCurrencyCode: request.ActualPayoutCurrencyCode,
                SettlementNote: request.SettlementNote,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardCancelAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardCancelPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || string.IsNullOrWhiteSpace(request.Reason))
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.cancel.");

        // Phase 1 tenant-scope fix (2026-07-19) — see HandleJobCardAssignAsync.
        var jobCardScope = await EstablishFarmScopeForOwnedEntityAsync(
            actorUserId,
            c => repository.GetJobCardByIdAsync(request.JobCardId, c),
            jobCard => jobCard.FarmId.Value,
            Domain.Common.ShramSafalErrors.JobCardNotFound,
            ct);
        if (!jobCardScope.IsSuccess)
        {
            return MutationExecutionOutcome.Failure(jobCardScope.Error.Code, jobCardScope.Error.Description);
        }

        var result = await cancelJobCardHandler.HandleAsync(
            new CancelJobCardCommand(
                JobCardId: request.JobCardId,
                Reason: request.Reason,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 lane PRV (founder D-26) — the farm's primary account holder chooses who sees one record. Carries
    /// only the record's id, so the farm is DISCOVERED by a user-scoped read (a record of another farm resolves to
    /// nothing) before the tenant scope is set; who may, the chosen people's seats (E4) and the record's state are
    /// <see cref="ShramSafal.Application.UseCases.RecordPrivacy.SetRecordAudience.SetRecordAudienceHandler"/>'s.
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleSetRecordAudienceAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "recordKind", "recordId", "audience", "selectedUserIds", "changedAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "set_record_audience payload contains unsupported fields.");
        }

        var request = DeserializePayload<SetRecordAudiencePayload>(payload);
        if (request is null || request.RecordId == Guid.Empty || request.SelectedUserIds is null
            || !Domain.RecordPrivacy.RecordKinds.IsKnown(request.RecordKind)
            || !AudienceOf(request.Audience, out var audience))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for set_record_audience.");
        }

        Error? farmScope;
        if (request.RecordKind == Domain.RecordPrivacy.RecordKinds.DailyLog)
        {
            var logScope = await EstablishFarmScopeForOwnedEntityAsync(
                actorUserId,
                c => repository.GetDailyLogByIdAsync(request.RecordId, c),
                log => (Guid)log.FarmId,
                Domain.Common.ShramSafalErrors.DailyLogNotFound,
                ct);
            farmScope = logScope.IsSuccess ? null : logScope.Error;
        }
        else
        {
            var entryScope = await EstablishFarmScopeForOwnedEntityAsync(
                actorUserId,
                c => repository.GetCostEntryByIdAsync(request.RecordId, c),
                entry => (Guid)entry.FarmId,
                Domain.Common.ShramSafalErrors.CostEntryNotFound,
                ct);
            farmScope = entryScope.IsSuccess ? null : entryScope.Error;
        }

        if (farmScope is not null)
        {
            return MutationExecutionOutcome.Failure(farmScope.Code, farmScope.Description);
        }

        var result = await setRecordAudienceHandler.HandleAsync(
            new ShramSafal.Application.UseCases.RecordPrivacy.SetRecordAudience.SetRecordAudienceCommand(
                request.RecordKind,
                request.RecordId,
                audience,
                request.SelectedUserIds,
                actorUserId,
                actorRole,
                clientRequestId,
                request.ChangedAtUtc == default ? null : request.ChangedAtUtc,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId),
            ct);

        return ToOutcome(result);

        // Only the three member NAMES (never a number, never another spelling).
        static bool AudienceOf(string? text, out Domain.RecordPrivacy.RecordAudience audience)
        {
            audience = Domain.RecordPrivacy.RecordAudience.Team;
            switch (text)
            {
                case "Team":
                    return true;
                case "Selected":
                    audience = Domain.RecordPrivacy.RecordAudience.Selected;
                    return true;
                case "OnlyMe":
                    audience = Domain.RecordPrivacy.RecordAudience.OnlyMe;
                    return true;
                default:
                    return false;
            }
        }
    }

    /// <summary>
    /// spec: plr-d10 lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43) — one change to one rate of a farm's own
    /// list. The payload names its farm, so the farm's scope is opened from it (a farm the sender is not an Active member of
    /// is refused with no farm GUC ever set); who may (the primary account holder in part A), the line's farm (E4) and the
    /// values are <see cref="ShramSafal.Application.UseCases.Finance.SetFarmRate.SetFarmRateHandler"/>'s — the REST door's
    /// handler. A refusal ends ".Forbidden": every phone parks it visibly (P10), never retried, never dropped.
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleSetFarmRateAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with set_farm_rate.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line — so it must stay on one line.
        if (!PayloadHasOnly(payload, "farmRateId", "rateLineId", "farmId", "change", "kind", "itemName", "unit", "basis", "workerCategory", "amount", "currencyCode", "effectiveFrom", "season", "endsOn", "suggestionId", "changedAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "set_farm_rate payload contains unsupported fields.");
        }

        var request = DeserializePayload<SetFarmRatePayload>(payload);
        if (request is null || request.FarmRateId == Guid.Empty || request.RateLineId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for set_farm_rate.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await setFarmRateHandler.HandleAsync(
            new ShramSafal.Application.UseCases.Finance.SetFarmRate.SetFarmRateCommand(
                request.FarmRateId,
                request.RateLineId,
                request.FarmId,
                request.Change,
                request.Kind,
                request.ItemName,
                request.Unit,
                request.Basis,
                request.WorkerCategory,
                request.Amount,
                request.CurrencyCode,
                request.EffectiveFrom,
                request.Season,
                request.EndsOn,
                request.SuggestionId,
                actorUserId,
                actorRole,
                clientRequestId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and when") — a reviewer's मंजूर on one
    /// bill. The payload names the bill's farm, so the farm's scope is opened from it (a farm the sender is not an Active member
    /// of is refused with no farm GUC ever set). Who may (review money or the primary account holder), which bills (audience,
    /// plots, the bill's own farm: E4) and which version (the L4b exact-version code) are
    /// <see cref="ShramSafal.Application.UseCases.Finance.ApproveCostEntry.ApproveCostEntryHandler"/>'s — the REST door's
    /// handler. Who approved is the authenticated sender, never a payload field. Every refusal parks visibly (P10).
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleApproveCostEntryAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with approve_cost_entry.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line — so it must stay on one line.
        if (!PayloadHasOnly(payload, "approvalId", "costEntryId", "farmId", "billVersion"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "approve_cost_entry payload contains unsupported fields.");
        }

        var request = DeserializePayload<ApproveCostEntryPayload>(payload);
        if (request is null || request.ApprovalId == Guid.Empty || request.CostEntryId == Guid.Empty || request.FarmId == Guid.Empty
            || request.BillVersion < 1)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for approve_cost_entry.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await approveCostEntryHandler.HandleAsync(
            new ShramSafal.Application.UseCases.Finance.ApproveCostEntry.ApproveCostEntryCommand(
                request.CostEntryId,
                request.FarmId,
                request.BillVersion,
                actorUserId,
                request.ApprovalId,
                actorRole,
                clientRequestId,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId),
            ct);

        return ToOutcome(result);
    }

    /// <summary>
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2; founders D-92 / D-95) - his हो / नाही / फोटो answer about ONE
    /// product of ONE saved record. The payload names the record's farm, so the farm's scope is opened from it (a farm the
    /// sender is not an Active member of is refused with no farm GUC ever set). Which record (its own farm: E4; its audience
    /// and plots), which product (an item of its LATEST stored content: his words are the server's copy, never a payload
    /// field), who may answer (the speaker as himself, a holder of the confirm-records authority as the check) and the
    /// idempotent repeat are <see cref="ShramSafal.Application.UseCases.Inputs.AssertInputIdentity.AssertInputIdentityHandler"/>'s.
    /// Who answered is the authenticated sender, and whether it is the check is his standing - never payload fields. The
    /// record is not touched: no version, no task, no quantity (D-92, P7). Every refusal parks visibly (P10).
    /// </summary>
    private async Task<MutationExecutionOutcome> HandleAssertInputIdentityAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with assert_input_identity.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "assertionId", "farmId", "dailyLogId", "inputEventId", "mixIndex", "verdict", "catalogProductId", "catalogVersion", "attachmentId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "assert_input_identity payload contains unsupported fields.");
        }

        var request = DeserializePayload<AssertInputIdentityPayload>(payload);
        if (request is null || request.AssertionId == Guid.Empty || request.FarmId == Guid.Empty || request.DailyLogId == Guid.Empty
            || string.IsNullOrWhiteSpace(request.InputEventId) || request.MixIndex < 0
            || string.IsNullOrWhiteSpace(request.Verdict) || string.IsNullOrWhiteSpace(request.CatalogVersion))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for assert_input_identity.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(
                Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await assertInputIdentityHandler.HandleAsync(
            new ShramSafal.Application.UseCases.Inputs.AssertInputIdentity.AssertInputIdentityCommand(
                request.AssertionId,
                request.FarmId,
                request.DailyLogId,
                request.InputEventId,
                request.MixIndex,
                request.Verdict,
                request.CatalogProductId,
                request.CatalogVersion,
                request.AttachmentId,
                actorUserId,
                clientRequestId,
                actorRole,
                ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
                AuditDeviceId: deviceId),
            ct);

        return ToOutcome(result);
    }

    // ── spec: plr-d10 lane L8c-1 (founder D-24c) — planned work and reminders ────────────────────────────────────────────────
    // The five doors run the handlers of UseCases/Planning/PlannedWork. Who made / answered / cancelled is the authenticated
    // sender, never a payload field; the payload names the task's farm, so that farm's scope is opened from it (a farm the
    // sender is not an Active member of is refused with no farm GUC ever set). Which task (its own farm: E4), who may, and
    // every plot and person rule are the handlers'. Every refusal parks visibly on the phone (P10).

    private static PlannedWorkCaller PlannedWorkCallerOf(
        string deviceId, string clientRequestId, Guid actorUserId, string actorRole, string? appVersion) =>
        new(
            actorUserId,
            actorRole,
            clientRequestId,
            ClientAppVersion: string.IsNullOrWhiteSpace(appVersion) ? "unknown" : appVersion,
            AuditDeviceId: deviceId);

    /// <summary>
    /// The words of a task from a create / edit payload; <c>null</c> when a word is not in its list (the payload is refused as
    /// invalid). Nothing here is a number the server derives from another number (D-24a, P4).
    /// </summary>
    private static ShramSafal.Domain.Planning.PlannedWorkDetails? PlannedWorkDetailsOf(
        string title,
        string scope,
        IReadOnlyList<Guid>? plotIds,
        DateOnly? plannedDate,
        string? looseWhen,
        string? plannedTime,
        Guid? assigneeUserId,
        string? crewText,
        int? expectedHeadcount,
        string? quantityText,
        string? payMode,
        string? note)
    {
        if (!ShramSafal.Domain.Planning.PlannedWorkWords.TryParse<ShramSafal.Domain.Planning.PlannedWorkScope>(scope, out var parsedScope))
        {
            return null;
        }

        ShramSafal.Domain.Planning.PlannedWorkLooseWhen? loose = null;
        if (looseWhen is not null)
        {
            if (!ShramSafal.Domain.Planning.PlannedWorkWords.TryParse<ShramSafal.Domain.Planning.PlannedWorkLooseWhen>(looseWhen, out var l))
            {
                return null;
            }

            loose = l;
        }

        ShramSafal.Domain.Planning.PlannedWorkPayMode? pay = null;
        if (payMode is not null)
        {
            if (!ShramSafal.Domain.Planning.PlannedWorkWords.TryParse<ShramSafal.Domain.Planning.PlannedWorkPayMode>(payMode, out var p))
            {
                return null;
            }

            pay = p;
        }

        TimeOnly? time = null;
        if (plannedTime is not null)
        {
            if (!TimeOnly.TryParseExact(plannedTime, "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var t))
            {
                return null;
            }

            time = t;
        }

        return new ShramSafal.Domain.Planning.PlannedWorkDetails(
            title, parsedScope, plotIds ?? [], plannedDate, loose, time, assigneeUserId, crewText, expectedHeadcount, quantityText, pay, note);
    }

    private async Task<MutationExecutionOutcome> HandlePlannedWorkCreateAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_create.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId", "title", "scope", "plotIds", "plannedDate", "looseWhen", "plannedTime", "assigneeUserId", "crewText", "expectedHeadcount", "quantityText", "payMode", "note", "sourceKind", "recordedOn"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.create payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkCreatePayload>(payload);
        var details = request is null
            ? null
            : PlannedWorkDetailsOf(
                request.Title, request.Scope, request.PlotIds, request.PlannedDate, request.LooseWhen, request.PlannedTime,
                request.AssigneeUserId, request.CrewText, request.ExpectedHeadcount, request.QuantityText, request.PayMode, request.Note);
        ShramSafal.Domain.Planning.PlannedWorkSourceKind? sourceKind = null;
        if (request?.SourceKind is not null)
        {
            if (!ShramSafal.Domain.Planning.PlannedWorkWords.TryParse<ShramSafal.Domain.Planning.PlannedWorkSourceKind>(request.SourceKind, out var parsedKind))
            {
                details = null;
            }
            else
            {
                sourceKind = parsedKind;
            }
        }

        if (request is null || details is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.create.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await createPlannedWorkHandler.HandleAsync(
            new CreatePlannedWorkCommand(
                request.PlannedWorkId, request.FarmId, details, sourceKind, request.RecordedOn,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandlePlannedWorkEditAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_edit.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId", "title", "scope", "plotIds", "plannedDate", "looseWhen", "plannedTime", "assigneeUserId", "crewText", "expectedHeadcount", "quantityText", "payMode", "note"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.edit payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkEditPayload>(payload);
        var details = request is null
            ? null
            : PlannedWorkDetailsOf(
                request.Title, request.Scope, request.PlotIds, request.PlannedDate, request.LooseWhen, request.PlannedTime,
                request.AssigneeUserId, request.CrewText, request.ExpectedHeadcount, request.QuantityText, request.PayMode, request.Note);
        if (request is null || details is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.edit.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await editPlannedWorkHandler.HandleAsync(
            new EditPlannedWorkCommand(
                request.PlannedWorkId, request.FarmId, details,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandlePlannedWorkSeenAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_seen.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.seen payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkSeenPayload>(payload);
        if (request is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.seen.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await answerPlannedWorkHandler.SeenAsync(
            new AnswerPlannedWorkCommand(
                request.PlannedWorkId, request.FarmId,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandlePlannedWorkAcceptAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_accept.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.accept payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkAcceptPayload>(payload);
        if (request is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.accept.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await answerPlannedWorkHandler.AcceptAsync(
            new AnswerPlannedWorkCommand(
                request.PlannedWorkId, request.FarmId,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandlePlannedWorkCancelAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_cancel.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId", "reason"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.cancel payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkCancelPayload>(payload);
        if (request is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.cancel.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await cancelPlannedWorkHandler.HandleAsync(
            new CancelPlannedWorkCommand(
                request.PlannedWorkId, request.FarmId, request.Reason,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    // ── spec: plr-d10 lane L8c-3 (founder D-24d, D-30, D-1) — plannedwork.complete / plannedwork.reopen ──────────────────────
    // "काम झालं" through the real log, plot by plot, and the owner's reopen. Who did it is the authenticated sender. The
    // payload names the farm, whose scope is opened from it (a farm the sender is not an Active member of is refused with no
    // farm GUC ever set). Which task (its own farm: E4), who may, the plots and the logs are the handlers'. A log named is
    // created by an earlier mutation of the same phone (its own queue order); while it is still on its way the answer
    // 'ShramSafal.DailyLogNotFound' makes the phone wait (MutationDependency); every other refusal parks visibly (P10).

    private async Task<MutationExecutionOutcome> HandlePlannedWorkCompleteAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_complete.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId", "plotIds", "dailyLogIds", "somethingLeft"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.complete payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkCompletePayload>(payload);
        if (request is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty
            || request.PlotIds is null || request.DailyLogIds is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.complete.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await completePlannedWorkHandler.HandleAsync(
            new CompletePlannedWorkCommand(
                request.PlannedWorkId, request.FarmId, request.PlotIds, request.DailyLogIds, request.SomethingLeft,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandlePlannedWorkReopenAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
        CancellationToken ct)
    {
        // Set equality with plannedwork_reopen.zod.ts is enforced by sync-contract/tests/allowlist-parity.test.ts, which parses
        // THIS line - so it must stay on one line.
        if (!PayloadHasOnly(payload, "plannedWorkId", "farmId", "reason"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "plannedwork.reopen payload contains unsupported fields.");
        }

        var request = DeserializePayload<PlannedWorkReopenPayload>(payload);
        if (request is null || request.PlannedWorkId == Guid.Empty || request.FarmId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for plannedwork.reopen.");
        }

        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(Domain.Common.ShramSafalErrors.Forbidden.Code, "User is not a member of the target farm.");
        }

        var result = await reopenPlannedWorkHandler.HandleAsync(
            new ReopenPlannedWorkCommand(
                request.PlannedWorkId, request.FarmId, request.Reason,
                PlannedWorkCallerOf(deviceId, clientRequestId, actorUserId, actorRole, appVersion)),
            ct);
        return ToOutcome(result);
    }

    /// <summary>
    /// spec: plr-d10 lane PRV (founder D-26; orchestrator call 7, "push") — the record a change names, for every kind
    /// of change that touches an EXISTING work or money record: its tasks, words, place or day, workers, confirmation,
    /// correction, allocation, or a photo linked to it. Internal (fix pass 2, L4) so a test proves which changes the PUSH
    /// gate itself refuses, apart from any later refusal by a handler.
    /// </summary>
    internal static (string Kind, Guid Id)? ChangeTarget(string mutationType, JsonElement payload)
    {
        static Guid IdOf(JsonElement payload, string property) =>
            payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(property, out var value)
            && value.ValueKind == JsonValueKind.String
            && Guid.TryParse(value.GetString(), out var id)
                ? id
                : Guid.Empty;

        static string? TextOf(JsonElement payload, string property) =>
            payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(property, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

        var (kind, id) = mutationType switch
        {
            "add_log_task" or "revise_log_content" or "move_daily_log" or "correct_labour_assignment" or "verify_log"
                or "jobcard.complete" or "assert_input_identity"
                => (Domain.RecordPrivacy.RecordKinds.DailyLog, IdOf(payload, "dailyLogId")),
            "verify_log_v2" => (Domain.RecordPrivacy.RecordKinds.DailyLog, IdOf(payload, "logId")),
            "correct_cost_entry" or "allocate_global_expense" or "approve_cost_entry"
                => (Domain.RecordPrivacy.RecordKinds.CostEntry, IdOf(payload, "costEntryId")),
            // The handler reads the kind case-insensitively (CreateAttachmentHandler), so the gate does too (fix pass 1, L4).
            "create_attachment" => TextOf(payload, "linkedEntityType")?.Trim().ToLowerInvariant() switch
            {
                "dailylog" => (Domain.RecordPrivacy.RecordKinds.DailyLog, IdOf(payload, "linkedEntityId")),
                "costentry" => (Domain.RecordPrivacy.RecordKinds.CostEntry, IdOf(payload, "linkedEntityId")),
                _ => (string.Empty, Guid.Empty),
            },
            _ => (string.Empty, Guid.Empty),
        };
        return id == Guid.Empty ? null : (kind, id);
    }

    /// <summary>
    /// spec: plr-d10 lane PRV — refuse a change to a record whose audience no longer includes the sender. The record is
    /// read under the sender's OWN user-scoped policies (a record of another farm, or one not yet here, resolves to
    /// nothing and the handler answers as it always did). A record of the normal team is never asked further.
    /// </summary>
    private async Task<MutationExecutionOutcome?> RefuseChangeToClosedRecordAsync(
        string mutationType, JsonElement payload, Guid actorUserId, CancellationToken ct)
    {
        if (ChangeTarget(mutationType, payload) is not { } target)
        {
            return null;
        }

        if (dbContext.Database.IsRelational())
        {
            await SetUserScopedReadGucsAsync(actorUserId, ct);
        }

        var head = await repository.GetRecordAudienceHeadAsync(target.Kind, target.Id, ct);
        if (head is null)
        {
            return null;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, head.FarmId, actorUserId, clock.UtcNow, ct);

        // spec: plr-d10 lane MU-4 — and a change to a record outside the sender's CHOSEN plots: the same one rule the reads
        // ask. Refused with the plot rule's own code, parked visibly (P10). An own-work seat's changes stay as they were.
        if (RecordPlaceRule.NarrowsByPlot(scope)
            && await repository.GetRecordPlaceAsync(target.Kind, target.Id, ct) is { } place
            && place.FarmId == head.FarmId
            && !RecordPlaceRule.MaySee(scope, actorUserId, place))
        {
            logger.LogWarning(
                "{MutationType} refused: {Kind} {RecordId} lies outside the sender's plots; the phone keeps the change.",
                mutationType, head.Kind, head.Id);
            var outside = Domain.Common.ShramSafalErrors.PlotScopeForbidden;
            return MutationExecutionOutcome.Failure(outside.Code, outside.Description);
        }

        if (head.Audience == Domain.RecordPrivacy.RecordAudience.Team)
        {
            return null;
        }

        var chosen = await repository.GetRecordAudienceUserIdsAsync(head.Kind, head.Id, ct);
        if (RecordAudienceRule.MaySee(scope, actorUserId, head.Audience, head.MakerUserId, chosen))
        {
            return null;
        }

        logger.LogWarning(
            "{MutationType} refused: {Kind} {RecordId} is no longer in the sender's audience ({Audience}); the phone keeps the change.",
            mutationType, head.Kind, head.Id, head.Audience);
        var closed = Domain.Common.ShramSafalErrors.RecordAudienceClosed;
        return MutationExecutionOutcome.Failure(closed.Code, closed.Description);
    }

    /// <summary>
    /// spec: plr-d10 lane MU-4 (MU design §3 G2, §11.6) — refuse a write that names a plot outside the sender's CHOSEN
    /// plots. Every plot the payload names — any property called <c>plotId</c> / <c>plotIds</c> (or ending so, at any
    /// depth), the plot of any crop season it names (<c>cropCycleId</c>), of the task (<c>jobCardId</c>) or the test
    /// (<c>testInstanceId</c>) it acts on — is read under the sender's OWN user-scoped policies; a plot of a farm where his
    /// seat covers chosen plots must be one of them. A plot that resolves to nothing (another farm, not yet here) is left to
    /// the handler, which answers as it always did. An own-work seat may log on any plot (§11.7); every other seat covers
    /// every plot. Nothing of a refused write is applied; the phone keeps it, parked and visible (P10).
    /// </summary>
    private async Task<MutationExecutionOutcome?> RefuseOutsidePlotScopeAsync(
        string mutationType, JsonElement payload, Guid actorUserId, CancellationToken ct)
    {
        var plots = new HashSet<Guid>();
        var cycles = new HashSet<Guid>();
        CollectPlaces(payload, plots, cycles, depth: 0);
        var jobCardId = TopLevelId(payload, "jobCardId");
        var testInstanceId = TopLevelId(payload, "testInstanceId");
        if (plots.Count == 0 && cycles.Count == 0 && jobCardId == Guid.Empty && testInstanceId == Guid.Empty)
        {
            return null;
        }

        if (dbContext.Database.IsRelational())
        {
            await SetUserScopedReadGucsAsync(actorUserId, ct);
        }

        var named = new List<(Guid FarmId, Guid PlotId)>();
        foreach (var plotId in plots)
        {
            if (await repository.GetPlotByIdAsync(plotId, ct) is { } plot && plot.Id == plotId)
            {
                named.Add(((Guid)plot.FarmId, plot.Id));
            }
        }

        foreach (var cycleId in cycles)
        {
            if (await repository.GetCropCycleByIdAsync(cycleId, ct) is { } cycle && cycle.Id == cycleId)
            {
                named.Add(((Guid)cycle.FarmId, cycle.PlotId));
            }
        }

        if (jobCardId != Guid.Empty && await repository.GetJobCardByIdAsync(jobCardId, ct) is { } card && card.Id == jobCardId)
        {
            named.Add((card.FarmId.Value, card.PlotId));
        }

        if (testInstanceId != Guid.Empty
            && await testInstanceRepository.GetByIdAsync(testInstanceId, ct) is { } test && test.Id == testInstanceId)
        {
            named.Add((test.FarmId.Value, test.PlotId));
        }

        var now = clock.UtcNow;
        foreach (var farm in named.GroupBy(n => n.FarmId))
        {
            var scope = await FarmReadGate.ScopeAsync(repository, farm.Key, actorUserId, now, ct);
            if (scope?.PlotIds is not { } his || farm.All(n => his.Contains(n.PlotId)))
            {
                continue;
            }

            logger.LogWarning(
                "{MutationType} refused: it names a plot of farm {FarmId} outside the sender's plots; the phone keeps it.",
                mutationType, farm.Key);
            var outside = Domain.Common.ShramSafalErrors.PlotScopeForbidden;
            return MutationExecutionOutcome.Failure(outside.Code, outside.Description);
        }

        return null;

        static Guid TopLevelId(JsonElement element, string property) =>
            element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(property, out var value)
            && value.ValueKind == JsonValueKind.String
            && Guid.TryParse(value.GetString(), out var id)
                ? id
                : Guid.Empty;
    }

    /// <summary>lane MU-4 — every plot id and crop-season id a payload names, at any depth (bounded).</summary>
    private static void CollectPlaces(JsonElement element, HashSet<Guid> plots, HashSet<Guid> cycles, int depth)
    {
        if (depth > 12)
        {
            return;
        }

        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                CollectPlaces(item, plots, cycles, depth + 1);
            }

            return;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        foreach (var property in element.EnumerateObject())
        {
            var name = property.Name;
            if (name.EndsWith("plotId", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("plotIds", StringComparison.OrdinalIgnoreCase))
            {
                AddIds(property.Value, plots);
            }
            else if (name.EndsWith("cropCycleId", StringComparison.OrdinalIgnoreCase))
            {
                AddIds(property.Value, cycles);
            }

            CollectPlaces(property.Value, plots, cycles, depth + 1);
        }

        static void AddIds(JsonElement value, HashSet<Guid> into)
        {
            if (value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var one) && one != Guid.Empty)
            {
                into.Add(one);
            }
            else if (value.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in value.EnumerateArray())
                {
                    AddIds(item, into);
                }
            }
        }
    }

    private static MutationExecutionOutcome ToOutcome<T>(Result<T> result)
    {
        if (result.IsSuccess)
        {
            return MutationExecutionOutcome.Success(result.Value);
        }

        return MutationExecutionOutcome.Failure(result.Error.Code, result.Error.Description);
    }

    private sealed record MutationExecutionOutcome(
        bool IsSuccess,
        object? Data,
        string? ErrorCode,
        string? ErrorMessage)
    {
        public static MutationExecutionOutcome Success(object? data) => new(true, data, null, null);

        public static MutationExecutionOutcome Failure(string errorCode, string errorMessage) =>
            new(false, null, errorCode, errorMessage);
    }
}
