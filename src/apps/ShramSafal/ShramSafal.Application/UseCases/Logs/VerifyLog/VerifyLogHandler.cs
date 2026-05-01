using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

/// <summary>
/// Verifies (or rejects / disputes) a <see cref="DailyLog"/> by emitting
/// a new <see cref="VerificationEvent"/> through the role-aware state
/// machine, then runs the auto-verify-job-card hook and emits an
/// <c>InvitationClaimed</c>-class analytics event.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): caller-shape validation lives
/// in <see cref="VerifyLogValidator"/>; the strict
/// owner-tier <see cref="IAuthorizationEnforcer.EnsureCanVerify"/> check
/// lives in <see cref="VerifyLogAuthorizer"/>. When this handler is
/// resolved via the pipeline, both run before the body. Direct
/// construction (legacy unit tests) bypasses those decorators and
/// exercises only the body's own defense-in-depth checks
/// (<c>callerRole is null ⇒ Forbidden</c>, entitlement gate, state-
/// machine error handling). The sync-batch caller
/// (<c>PushSyncBatchHandler</c>) was migrated to
/// <see cref="IHandler{TCommand,TResult}"/> alongside this rollout so
/// its strict auth coverage stays intact.
/// </para>
/// </summary>
public sealed class VerifyLogHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy,
    IAnalyticsWriter analytics,
    OnLogVerifiedAutoVerifyJobCard autoVerifyJobCard)
    : IHandler<VerifyLogCommand, DailyLogDto>
{
    public async Task<Result<DailyLogDto>> HandleAsync(VerifyLogCommand command, CancellationToken ct = default)
    {
        // Caller-shape validation (DailyLogId / VerifiedByUserId /
        // explicit-but-empty VerificationEventId) lives in
        // VerifyLogValidator; the strict owner-tier authorization check
        // lives in VerifyLogAuthorizer. Both run as pipeline behaviors
        // before this body when the handler is resolved through the
        // pipeline. Direct callers must enforce the same invariants
        // themselves.

        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.DailyLogNotFound);
        }

        // Defense-in-depth: even after the pipeline's EnsureCanVerify, the
        // body re-confirms that the caller has SOME membership on the
        // log's farm and uses that role for the state-machine call. This
        // is the only auth gate that runs for direct (non-pipeline)
        // consumers, so it must remain.
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

        await autoVerifyJobCard.HandleAsync(log.Id, verification.Status, new UserId(command.VerifiedByUserId), ct);

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
