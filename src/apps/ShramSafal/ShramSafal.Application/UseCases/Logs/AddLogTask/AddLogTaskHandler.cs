using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

public sealed class AddLogTaskHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IScheduleComplianceService complianceService)
{
    public async Task<Result<DailyLogDto>> HandleAsync(AddLogTaskCommand command, CancellationToken ct = default)
    {
        if (command.DailyLogId == Guid.Empty ||
            command.ActorUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.ActivityType))
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.LogTaskId.HasValue && command.LogTaskId.Value == Guid.Empty)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

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

        var task = log.AddTask(
            command.LogTaskId ?? idGenerator.New(),
            command.ActivityType,
            command.Notes,
            command.OccurredAtUtc ?? clock.UtcNow);

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
