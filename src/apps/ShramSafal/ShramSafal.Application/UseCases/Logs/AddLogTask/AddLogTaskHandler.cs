using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

public sealed class AddLogTaskHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
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

        var task = log.AddTask(
            command.LogTaskId ?? idGenerator.New(),
            command.ActivityType,
            command.Notes,
            command.OccurredAtUtc ?? clock.UtcNow);

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
                    task.OccurredAtUtc
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(log.ToDto());
    }
}
