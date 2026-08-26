using AgriSync.BuildingBlocks.Analytics;
using System.Diagnostics;
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
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
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
    ILogger<PushSyncBatchHandler> logger)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };
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
            var result = await ProcessMutationAsync(
                normalizedDeviceId,
                mutation,
                command.AuthenticatedUserId,
                actorRole,
                command.AppVersion,
                ct);
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
        return await strategy.ExecuteAsync(
            innerCt => ExecuteMutationInTransactionAsync(
                deviceId,
                clientRequestId,
                mutationType,
                mutation,
                actorUserId,
                actorRole,
                appVersion,
                innerCt),
            ct);
    }

    private async Task<SyncMutationResultDto> ExecuteMutationInTransactionAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        PushSyncMutationCommand mutation,
        Guid actorUserId,
        string actorRole,
        string? appVersion,
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

            var responsePayloadJson = JsonSerializer.Serialize(execution.Data, SerializerOptions);
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
        catch (DbUpdateException)
        {
            await RollbackAsync(transaction, ct);
            dbContext.ChangeTracker.Clear();

            var deduplicated = await syncMutationStore.GetAsync(deviceId, clientRequestId, ct);
            if (deduplicated is not null)
            {
                return CreateDuplicateResult(clientRequestId, mutationType, deduplicated);
            }

            return CreateFailedResult(
                clientRequestId,
                mutationType,
                "ShramSafal.SyncMutationStoreError",
                "Mutation failed during persistence and could not be safely deduplicated.");
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
            case "verify_log":
                return await HandleVerifyLogAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "verify_log_v2":
                // Sub-plan 03 wires the v2 verify handler. Until then, return a
                // typed UNIMPLEMENTED so the surface area is honest.
                return MutationExecutionOutcome.Failure(
                    MutationTypeUnimplementedCode,
                    "verify_log_v2 handler is not yet wired. Falls back to verify_log on the client. Tracked in Sub-plan 03.");
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
            // Schedule + Plan mutations (Sub-plan 03 wires real handlers).
            case "schedule.publish":
            case "schedule.edit":
            case "schedule.clone":
            case "plan.add":
            case "plan.override":
            case "plan.remove":
            case "adopt_schedule":
            case "migrate_schedule":
            case "abandon_schedule":
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
            new CreateCropCycleCommand(
                request.FarmId,
                request.PlotId,
                request.CropName,
                request.Stage,
                request.StartDate,
                request.EndDate,
                actorUserId,
                request.CropCycleId,
                actorRole,
                clientRequestId),
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
        if (!PayloadHasOnly(payload, "dailyLogId", "farmId", "scope", "plotIds", "plotId", "cropCycleId", "operatorUserId", "logDate", "location", "weatherStamp", "sourceAiJobId", "labour"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_daily_log payload contains unsupported fields.");
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
                PlotIds: request.PlotIds),
            ct);

        return ToOutcome(result);
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
            new CreateAttachmentCommand(
                request.FarmId,
                request.LinkedEntityId,
                request.LinkedEntityType,
                request.FileName,
                request.MimeType,
                actorUserId,
                attachmentId,
                actorRole,
                clientRequestId),
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
