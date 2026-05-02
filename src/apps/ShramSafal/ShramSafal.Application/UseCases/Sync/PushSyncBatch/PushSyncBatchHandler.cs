using System.Text.Json;
using System.Text.RegularExpressions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using ShramSafal.Application.Abstractions.Sync;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync;
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
    SettleJobCardPayoutHandler settleJobCardPayoutHandler,
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
    IE2eFailPushesProbe failPushesProbe)
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
            results.Add(await ProcessMutationAsync(
                normalizedDeviceId,
                mutation,
                command.AuthenticatedUserId,
                actorRole,
                command.AppVersion,
                ct));
        }

        return Result.Success(new SyncPushResponseDto(clock.UtcNow, results));
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
                return await HandleCreateDailyLogAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, ct);
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
                return await HandleAddCostEntryAsync(clientRequestId, payload, actorUserId, actorRole, ct);
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
                return await HandleJobCardSettleAsync(clientRequestId, payload, actorUserId, actorRole, ct);
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

        var request = DeserializePayload<CreateFarmMutationPayload>(payload);
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

        var request = DeserializePayload<CreatePlotMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_plot.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
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

        var request = DeserializePayload<CreateCropCycleMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_crop_cycle.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
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
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "dailyLogId", "farmId", "plotId", "cropCycleId", "operatorUserId", "logDate", "location"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_daily_log payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateDailyLogMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_daily_log.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

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
                DailyLogId: request.DailyLogId,
                ActorRole: actorRole),
            ct);

        return ToOutcome(result);
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

        var request = DeserializePayload<AddLogTaskMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_log_task.");
        }

        var dailyLog = await repository.GetDailyLogByIdAsync(request.DailyLogId, ct);
        if (dailyLog is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.DailyLogNotFound", "Daily log was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(dailyLog.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
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

        var request = DeserializePayload<VerifyLogMutationPayload>(payload);
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

        var dailyLog = await repository.GetDailyLogByIdAsync(request.DailyLogId, ct);
        if (dailyLog is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.DailyLogNotFound", "Daily log was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(dailyLog.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
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
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "costEntryId", "farmId", "plotId", "cropCycleId", "category", "description", "amount", "currencyCode", "entryDate", "createdByUserId", "location"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "add_cost_entry payload contains unsupported fields.");
        }

        var request = DeserializePayload<AddCostEntryMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_cost_entry.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await addCostEntryHandler.HandleAsync(
            new AddCostEntryCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                Category: request.Category,
                Description: request.Description,
                Amount: request.Amount,
                CurrencyCode: request.CurrencyCode,
                EntryDate: request.EntryDate,
                CreatedByUserId: actorUserId,
                Location: ToLocationSnapshot(request.Location),
                CostEntryId: request.CostEntryId,
                ActorRole: actorRole,
                ClientCommandId: clientRequestId),
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

        var request = DeserializePayload<AllocateGlobalExpenseMutationPayload>(payload);
        if (request is null || request.CostEntryId == Guid.Empty || string.IsNullOrWhiteSpace(request.AllocationBasis))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for allocate_global_expense.");
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

    private static LocationSnapshot? ToLocationSnapshot(LocationMutationPayload? payload)
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

        var request = DeserializePayload<CorrectCostEntryMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for correct_cost_entry.");
        }

        var costEntry = await repository.GetCostEntryByIdAsync(request.CostEntryId, ct);
        if (costEntry is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.CostEntryNotFound", "Cost entry was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(costEntry.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
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

        var request = DeserializePayload<SetPriceConfigMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for set_price_config.");
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

        var request = DeserializePayload<CreateAttachmentMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_attachment.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
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
                request.AttachmentId,
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

        var request = DeserializePayload<RecordTestCollectedMutationPayload>(payload);
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

        // Farm-membership check — resolve the instance's farm first.
        var instance = await testInstanceRepository.GetByIdAsync(request.TestInstanceId, ct);
        if (instance is null)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.TestInstanceNotFound",
                "Test instance was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(instance.FarmId.Value, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.Forbidden",
                "User is not a member of the target farm.");
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

        var request = DeserializePayload<RecordTestResultMutationPayload>(payload);
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

        var instance = await testInstanceRepository.GetByIdAsync(request.TestInstanceId, ct);
        if (instance is null)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.TestInstanceNotFound",
                "Test instance was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(instance.FarmId.Value, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.Forbidden",
                "User is not a member of the target farm.");
        }

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
            "failed",
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
        var request = DeserializePayload<ComplianceAcknowledgeMutationPayload>(payload);
        if (request is null || request.SignalId == Guid.Empty)
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "Invalid payload for compliance.acknowledge — signalId is required.");
        }

        if (!Enum.TryParse<AppRole>(actorRole, ignoreCase: true, out var role))
            role = AppRole.Worker;

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
        var request = DeserializePayload<ComplianceResolveMutationPayload>(payload);
        if (request is null || request.SignalId == Guid.Empty || string.IsNullOrWhiteSpace(request.Note))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "Invalid payload for compliance.resolve — signalId and note are required.");
        }

        if (!Enum.TryParse<AppRole>(actorRole, ignoreCase: true, out var role))
            role = AppRole.Worker;

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
        var request = DeserializePayload<JobCardCreateMutationPayload>(payload);
        if (request is null || request.FarmId == Guid.Empty || request.PlotId == Guid.Empty ||
            request.LineItems is null || request.LineItems.Count == 0)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.create.");
        }

        if (!Enum.TryParse<AppRole>(actorRole, ignoreCase: true, out var role)) role = AppRole.Worker;

        var result = await createJobCardHandler.HandleAsync(
            new CreateJobCardCommand(
                FarmId: new FarmId(request.FarmId),
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                PlannedDate: request.PlannedDate,
                LineItems: request.LineItems,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardAssignAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardAssignMutationPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || request.WorkerUserId == Guid.Empty)
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.assign.");

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
        var request = DeserializePayload<JobCardIdMutationPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty)
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.start.");

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
        var request = DeserializePayload<JobCardCompleteMutationPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || request.DailyLogId == Guid.Empty)
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.complete.");

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
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardSettleMutationPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || request.ActualPayoutAmount <= 0 ||
            string.IsNullOrWhiteSpace(request.ActualPayoutCurrencyCode))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.settle.");
        }

        var result = await settleJobCardPayoutHandler.HandleAsync(
            new SettleJobCardPayoutCommand(
                JobCardId: request.JobCardId,
                ActualPayoutAmount: request.ActualPayoutAmount,
                ActualPayoutCurrencyCode: request.ActualPayoutCurrencyCode,
                SettlementNote: request.SettlementNote,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleJobCardCancelAsync(
        string clientRequestId, JsonElement payload, Guid actorUserId, string actorRole, CancellationToken ct)
    {
        var request = DeserializePayload<JobCardCancelMutationPayload>(payload);
        if (request is null || request.JobCardId == Guid.Empty || string.IsNullOrWhiteSpace(request.Reason))
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for jobcard.cancel.");

        var result = await cancelJobCardHandler.HandleAsync(
            new CancelJobCardCommand(
                JobCardId: request.JobCardId,
                Reason: request.Reason,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: clientRequestId),
            ct);
        return ToOutcome(result);
    }

    private sealed record ComplianceAcknowledgeMutationPayload(Guid SignalId);
    private sealed record ComplianceResolveMutationPayload(Guid SignalId, string? Note);

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

    private sealed record CreateFarmMutationPayload(Guid? FarmId, string Name, Guid? OwnerUserId);

    private sealed record CreatePlotMutationPayload(Guid? PlotId, Guid FarmId, string Name, decimal AreaInAcres);

    private sealed record CreateCropCycleMutationPayload(
        Guid? CropCycleId,
        Guid FarmId,
        Guid PlotId,
        string CropName,
        string Stage,
        DateOnly StartDate,
        DateOnly? EndDate);

    private sealed record CreateDailyLogMutationPayload(
        Guid? DailyLogId,
        Guid FarmId,
        Guid PlotId,
        Guid CropCycleId,
        Guid? OperatorUserId,
        DateOnly LogDate,
        LocationMutationPayload? Location);

    private sealed record AddLogTaskMutationPayload(
        Guid? LogTaskId,
        Guid DailyLogId,
        string ActivityType,
        string? Notes,
        DateTime? OccurredAtUtc);

    private sealed record VerifyLogMutationPayload(
        Guid? VerificationEventId,
        Guid DailyLogId,
        string? Status,
        string? TargetStatus,
        string? Reason,
        Guid? VerifiedByUserId);

    private sealed record AddCostEntryMutationPayload(
        Guid? CostEntryId,
        Guid FarmId,
        Guid? PlotId,
        Guid? CropCycleId,
        string Category,
        string Description,
        decimal Amount,
        string CurrencyCode,
        DateOnly EntryDate,
        Guid? CreatedByUserId,
        LocationMutationPayload? Location);

    private sealed record CorrectCostEntryMutationPayload(
        Guid? FinanceCorrectionId,
        Guid CostEntryId,
        decimal CorrectedAmount,
        string CurrencyCode,
        string Reason,
        Guid? CorrectedByUserId);

    private sealed record AllocateGlobalExpenseMutationPayload(
        Guid? DayLedgerId,
        Guid CostEntryId,
        string AllocationBasis,
        IReadOnlyList<AllocateGlobalExpenseMutationAllocationPayload> Allocations,
        Guid? CreatedByUserId);

    private sealed record AllocateGlobalExpenseMutationAllocationPayload(
        Guid PlotId,
        decimal Amount);

    private sealed record SetPriceConfigMutationPayload(
        Guid? PriceConfigId,
        string ItemName,
        decimal UnitPrice,
        string CurrencyCode,
        DateOnly EffectiveFrom,
        int Version,
        Guid? CreatedByUserId);

    private sealed record CreateAttachmentMutationPayload(
        Guid? AttachmentId,
        Guid FarmId,
        Guid LinkedEntityId,
        string LinkedEntityType,
        string FileName,
        string MimeType,
        Guid? CreatedByUserId);

    private sealed record LocationMutationPayload(
        decimal Latitude,
        decimal Longitude,
        decimal AccuracyMeters,
        decimal? Altitude,
        DateTime CapturedAtUtc,
        string Provider,
        string PermissionState);

    private sealed record RecordTestCollectedMutationPayload(Guid TestInstanceId);

    private sealed record RecordTestResultMutationPayload(
        Guid TestInstanceId,
        IReadOnlyList<TestResultMutationPayload> Results,
        IReadOnlyList<Guid>? AttachmentIds,
        string? ClientCommandId);

    private sealed record TestResultMutationPayload(
        string ParameterCode,
        string ParameterValue,
        string? Unit,
        decimal? ReferenceRangeLow,
        decimal? ReferenceRangeHigh);

    // --- CEI Phase 4 §4.8 — job card mutation payload records -------------------

    private sealed record JobCardCreateMutationPayload(
        Guid FarmId,
        Guid PlotId,
        Guid? CropCycleId,
        DateOnly PlannedDate,
        IReadOnlyList<Contracts.Dtos.JobCardLineItemDto> LineItems);

    private sealed record JobCardAssignMutationPayload(
        Guid JobCardId,
        Guid WorkerUserId);

    private sealed record JobCardIdMutationPayload(Guid JobCardId);

    private sealed record JobCardCompleteMutationPayload(
        Guid JobCardId,
        Guid DailyLogId);

    private sealed record JobCardSettleMutationPayload(
        Guid JobCardId,
        decimal ActualPayoutAmount,
        string ActualPayoutCurrencyCode,
        string? SettlementNote);

    private sealed record JobCardCancelMutationPayload(
        Guid JobCardId,
        string Reason);
}
