using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

/// <summary>
/// Adds a <see cref="LogTask"/> to an existing <see cref="DailyLog"/>
/// (idempotent on <see cref="AddLogTaskCommand.LogTaskId"/>),
/// stamps schedule compliance, emits an audit row, and saves.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLogTask): caller-shape validation
/// lives in <see cref="AddLogTaskValidator"/>; membership authorization
/// lives in <see cref="AddLogTaskAuthorizer"/>. When this handler is
/// resolved via the pipeline, both run before the body. The body
/// retains its own log-lookup + membership re-check as defense-in-depth
/// for direct (non-pipeline) consumers — those checks are the only
/// auth path when callers bypass the pipeline. The sync-batch caller
/// (<c>PushSyncBatchHandler</c>) was migrated to
/// <see cref="IHandler{TCommand,TResult}"/> alongside this rollout
/// to keep validation + auth coverage on the sync entry path.
/// </para>
///
/// <para>
/// Error ordering is preserved verbatim:
/// <c>InvalidCommand → DailyLogNotFound → Forbidden</c>. The pipeline
/// runs validator first, authorizer second (which surfaces
/// DailyLogNotFound before Forbidden internally), then the body
/// (which re-checks the same gates plus deeper domain invariants).
/// </para>
/// </summary>
public sealed class AddLogTaskHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IScheduleComplianceService complianceService)
    : IHandler<AddLogTaskCommand, DailyLogDto>
{
    public async Task<Result<DailyLogDto>> HandleAsync(AddLogTaskCommand command, CancellationToken ct = default)
    {
        // Caller-shape validation (DailyLogId / ActorUserId / ActivityType
        // / explicit-but-empty LogTaskId) lives in AddLogTaskValidator;
        // log-lookup-plus-membership authorization lives in
        // AddLogTaskAuthorizer. Both run as pipeline behaviors before
        // this body when the handler is resolved through the pipeline.
        // The body still performs its own log-lookup + membership check
        // below — that path is defense-in-depth and the only auth gate
        // for direct (non-pipeline) consumers.

        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(log.FarmId, command.ActorUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }

        // Phase 5 entitlement gate (PaidFeature.WriteDailyLog — log tasks
        // are a write on an existing daily log).
        var gate = await EntitlementGate.CheckAsync<DailyLogDto>(
            entitlementPolicy, new UserId(command.ActorUserId), new FarmId(log.FarmId),
            PaidFeature.WriteDailyLog, ct);
        if (gate is not null) return gate;

        // LABOUR_PHASE2 P2.3 (reader audit) — a cycle-less log NO LONGER refuses
        // the task; it records the task with NO compliance verdict.
        //
        // P2.1 made this path fail closed with CropCycleNotFound, deliberately,
        // as the only fabrication-free option inside its surface. That is now
        // wrong for two reasons, both of which only bite once a client can
        // create a MultiPlot/Farm log (Phase 2b):
        //
        //   1. `AddLogTaskHandler` is the ONLY production path that adds a
        //      LogTask to a DailyLog (verified: the sole other `.AddTask(`
        //      call sites are the two seeders). Failing closed therefore means
        //      a farm-wide log can never carry a single task — the farmer says
        //      "आज संपूर्ण शेतात फवारणी केली" and the record of the फवारणी is
        //      REJECTED. `P9`: no optional field may ever reject a record, and
        //      a schedule-compliance stamp is the definition of optional.
        //   2. `CropCycleNotFound` is not true. Nothing was looked up and not
        //      found; the log HAS no cycle, by design, because the farmer named
        //      no plot. Returning a not-found error for a thing that was never
        //      supposed to exist sends the next reader hunting for a missing row.
        //
        // So: the cycle lookup and its error stay EXACTLY as they were for a
        // log that names a cycle, and a cycle-less log skips both. The task is
        // still created; `LogTask.Compliance` simply stays null, which is the
        // meaning that property already documents ("the evaluator was never
        // run"). We do NOT stamp ComplianceResult.Unscheduled() instead —
        // "Unscheduled" asserts that a plot-crop-cycle was checked and had no
        // active subscription, and no such check happened (`P8`).
        CropCycle? cropCycle = null;
        if (log.CropCycleId is { } logCropCycleId)
        {
            cropCycle = await repository.GetCropCycleByIdAsync(logCropCycleId, ct);
            if (cropCycle is null)
            {
                return Result.Failure<DailyLogDto>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        // Validate deviation reason if non-Completed
        if (command.ExecutionStatus != ExecutionStatus.Completed)
        {
            if (string.IsNullOrWhiteSpace(command.DeviationReasonCode))
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);

            if (!GetDeviationReasonCodesHandler.IsValidCode(command.DeviationReasonCode))
                return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }
        else if (!string.IsNullOrWhiteSpace(command.DeviationReasonCode))
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

        var task = log.AddTask(
            command.LogTaskId ?? idGenerator.New(),
            command.ActivityType,
            command.Notes,
            command.OccurredAtUtc ?? clock.UtcNow,
            command.ExecutionStatus,
            command.DeviationReasonCode,
            command.DeviationNote);

        // Phase 3 MIS: stamp compliance on the task inside the same tx (I-17).
        // LABOUR_PHASE2 P2.3 — only when the parent log names a crop cycle.
        // There is no schedule for "the whole farm", so for a plot-less log
        // there is no verdict to give and `Compliance` stays null. Absence
        // recorded as absence, never a manufactured outcome.
        ComplianceResult? compliance = null;
        if (cropCycle is not null && log.CropCycleId is { } complianceCycleId)
        {
            compliance = await complianceService.EvaluateAsync(
                new ScheduleComplianceQuery(
                    complianceCycleId,
                    command.ActivityType,
                    cropCycle.Stage,
                    log.LogDate),
                ct);
            task.StampCompliance(compliance);
        }

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "DailyLog",
                entityId: log.Id,
                action: "TaskAdded",
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    logId = log.Id,
                    taskId = task.Id,
                    task.ActivityType,
                    task.Notes,
                    task.OccurredAtUtc,
                    complianceOutcome = compliance?.Outcome.ToString(),
                    complianceDeltaDays = compliance?.DeltaDays,
                    // Explicit, not inferred from two nulls: an auditor five
                    // years from now must be able to tell "no schedule matched"
                    // from "there was no schedule to match against".
                    complianceNotEvaluatedReason = compliance is null
                        ? $"parent daily log scope '{log.Scope}' has no crop cycle"
                        : null
                },
                farmId: log.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(log.ToDto());
    }
}
