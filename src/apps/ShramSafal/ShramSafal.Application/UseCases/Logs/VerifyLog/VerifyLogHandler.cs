using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

public sealed class VerifyLogHandler(
    IShramSafalRepository repository,
    IAuthorizationEnforcer authorizationEnforcer,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<DailyLogDto>> HandleAsync(VerifyLogCommand command, CancellationToken ct = default)
    {
        if (command.DailyLogId == Guid.Empty || command.VerifiedByUserId == Guid.Empty)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.VerificationEventId.HasValue && command.VerificationEventId.Value == Guid.Empty)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidCommand);
        }

        await authorizationEnforcer.EnsureCanVerify(
            new UserId(command.VerifiedByUserId),
            command.DailyLogId,
            command.CallerRole);

        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var currentStatus = log.CurrentVerificationStatus;
        if (!VerificationStateMachine.CanTransitionWithRole(currentStatus, command.TargetStatus, command.CallerRole))
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.VerificationTransitionNotAllowedForRole);
        }

        try
        {
            log.Verify(
                command.VerificationEventId ?? idGenerator.New(),
                command.TargetStatus,
                command.Reason,
                command.CallerRole,
                command.VerifiedByUserId,
                clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.InvalidVerificationReason);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.VerificationTransitionNotAllowedForRole);
        }

        await repository.SaveChangesAsync(ct);
        return Result.Success(log.ToDto());
    }
}
