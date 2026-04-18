using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
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
            command.DailyLogId);

        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var callerRole = await repository.GetUserRoleForFarmAsync((Guid)log.FarmId, command.VerifiedByUserId, ct);
        if (callerRole is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }
        var resolvedCallerRole = callerRole.Value;

        try
        {
            var verification = log.Verify(
                command.VerificationEventId ?? idGenerator.New(),
                command.TargetStatus,
                command.Reason,
                resolvedCallerRole,
                command.VerifiedByUserId,
                clock.UtcNow);

            await repository.AddAuditEventAsync(
                AuditEvent.Create(
                    log.FarmId,
                    "DailyLog",
                    log.Id,
                    "VerificationChanged",
                    command.VerifiedByUserId,
                    resolvedCallerRole.ToString(),
                    new
                    {
                        logId = log.Id,
                        verificationId = verification.Id,
                        status = verification.Status.ToString(),
                        verification.Reason,
                        verification.OccurredAtUtc
                    },
                    command.ClientCommandId,
                    clock.UtcNow),
                ct);
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
