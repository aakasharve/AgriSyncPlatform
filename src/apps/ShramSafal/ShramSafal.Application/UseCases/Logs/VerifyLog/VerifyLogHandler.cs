using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
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
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics)
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

        // Phase 5 entitlement gate (PaidFeature.RunVerification).
        var gate = await EntitlementGate.CheckAsync<DailyLogDto>(
            entitlementPolicy, new UserId(command.VerifiedByUserId), log.FarmId,
            PaidFeature.RunVerification, ct);
        if (gate is not null) return gate;

        var priorState = log.CurrentVerificationStatus;
        VerificationEvent verification;
        try
        {
            verification = log.Verify(
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

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.LogVerified,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.VerifiedByUserId),
            FarmId: log.FarmId,
            OwnerAccountId: null, // Phase 2: null. Phase 4 will backfill via a BG job.
            ActorRole: command.ActorRole ?? resolvedCallerRole.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                logId = log.Id,
                verifierUserId = command.VerifiedByUserId,
                verifiedAtUtc = verification.OccurredAtUtc,
                priorState = priorState.ToString(),
                newState = verification.Status.ToString()
            })
        ), ct);

        return Result.Success(log.ToDto());
    }
}
