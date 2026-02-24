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
        var callerRole = Enum.TryParse<AppRole>(command.ActorRole, ignoreCase: true, out var parsedRole)
            ? parsedRole
            : AppRole.Worker;

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
            callerRole);

        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(log.FarmId, command.VerifiedByUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }

        try
        {
            var verification = log.Verify(
                command.VerificationEventId ?? idGenerator.New(),
                command.TargetStatus,
                command.Reason,
                callerRole,
                command.VerifiedByUserId,
                clock.UtcNow);

            await repository.AddAuditEventAsync(
                AuditEvent.Create(
                    log.FarmId,
                    "DailyLog",
                    log.Id,
                    "VerificationChanged",
                    command.VerifiedByUserId,
                    command.ActorRole ?? "unknown",
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
