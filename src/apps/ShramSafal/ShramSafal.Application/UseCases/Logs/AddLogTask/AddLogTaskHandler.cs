using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

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

        var cropCycle = await repository.GetCropCycleByIdAsync(log.CropCycleId, ct);
        if (cropCycle is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.CropCycleNotFound);
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
        var compliance = await complianceService.EvaluateAsync(
            new ScheduleComplianceQuery(
                log.CropCycleId,
                command.ActivityType,
                cropCycle.Stage,
                log.LogDate),
            ct);
        task.StampCompliance(compliance);

        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                log.FarmId,
                "DailyLog",
                log.Id,
                "TaskAdded",
                command.ActorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    logId = log.Id,
                    taskId = task.Id,
                    task.ActivityType,
                    task.Notes,
                    task.OccurredAtUtc,
                    complianceOutcome = compliance.Outcome.ToString(),
                    complianceDeltaDays = compliance.DeltaDays
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(log.ToDto());
    }
}
