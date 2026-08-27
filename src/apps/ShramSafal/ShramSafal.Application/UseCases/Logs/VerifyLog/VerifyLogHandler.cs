using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

/// <summary>
/// Verifies (or rejects / disputes) a <see cref="DailyLog"/> by emitting
/// a new <see cref="VerificationEvent"/> through the role-aware state
/// machine, then runs the auto-verify-job-card hook and emits a
/// <c>LogVerified</c> analytics event.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): caller-shape validation lives
/// in <see cref="VerifyLogValidator"/>; the
/// <see cref="IAuthorizationEnforcer.EnsureCanVerify"/> check
/// lives in <see cref="VerifyLogAuthorizer"/>. (That check stopped being
/// "strict owner-tier" at founder decision O-4, which pointed it at
/// <c>LabourManagementGate</c>; the word is removed rather than left to
/// describe a list that no longer exists.) When this handler is
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

        // ── spec: 2026-08-25-prod-cutover-waves — FOUNDER RULING 2026-08-27 ──────
        // "if the owner has given that access to him then yes."
        //
        // The Mukadam question is PERMISSION-gated, not ROLE-gated. Until now the
        // enforcer admitted him (LabourManagementGate carries the Mukadam by role,
        // founder decision O-4) and the state machine refused him one layer deeper on
        // an owner-tier check — so the doc claiming O-4 "restores the Mukadam's ability
        // to approve and verify" described something that had never once happened.
        //
        // The grant is read HERE and passed DOWN: VerificationStateMachine is a Domain
        // type and doctrine E2 forbids it reaching for a repository.
        //
        // The read is skipped for callers whose ROLE already holds Confirmed->Verified,
        // which is the traffic that dominates — the same ordering LabourManagementGate
        // documents, and for the same reason. It is a short-circuit, never a widening:
        // a caller who fails BOTH the role check and the grant read is refused exactly
        // as before.
        var hasLabourManagementGrant =
            !VerificationStateMachine.CanTransitionWithRole(
                VerificationStatus.Confirmed, VerificationStatus.Verified, resolvedCallerRole)
            && await LabourManagementGate.HasExplicitGrantAsync(
                repository, (Guid)log.FarmId, command.VerifiedByUserId, ct);

        // Phase 5 entitlement gate (PaidFeature.RunVerification).
        var gate = await EntitlementGate.CheckAsync<DailyLogDto>(
            entitlementPolicy, new UserId(command.VerifiedByUserId), log.FarmId,
            PaidFeature.RunVerification, ct);
        if (gate is not null) return gate;

        var priorState = log.CurrentVerificationStatus;
        VerificationEvent verification;
        try
        {
            // ── spec: dfes-companion-2026-07-11 (wave-1.4) ───────────────────────
            // WALK the state machine instead of taking exactly one edge. The approval
            // the pilot actually needs — an owner approving a foreman's day — starts on
            // a Draft log, and the FSM has no Draft->Verified edge for ANY role. A
            // single Verify() call therefore refused every real approval with
            // VerificationTransitionNotAllowedForRole; the reachable path is
            // Draft->Confirmed then Confirmed->Verified, and only owner-tier roles hold
            // the second edge. VerifyReachingTarget walks exactly those edges and
            // refuses when the role does not hold them, so nothing was widened: adding
            // a Draft->Verified edge instead would have let every role self-approve,
            // because Draft-> edges are open to all roles.
            //
            // One button press can therefore produce TWO verification events. Each one
            // gets its own audit row below — a status that moved must be reconstructable
            // hop by hop, or the ledger cannot answer "how did this log reach Verified".
            var emitted = log.VerifyReachingTarget(
                command.TargetStatus,
                command.Reason,
                resolvedCallerRole,
                command.VerifiedByUserId,
                clock.UtcNow,
                targetEventId: command.VerificationEventId ?? idGenerator.New(),
                enRouteEventId: idGenerator.New(),
                hasLabourManagementGrant: hasLabourManagementGrant);

            verification = emitted[^1];

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from
            // AuditEvent.Create (sentinel provenance) to AuditEventFactory.Create
            // with X-Device-Id / IP hash / X-App-Version sourced from the
            // endpoint's AuditContextAccessor.
            foreach (var emittedEvent in emitted)
            {
                await repository.AddAuditEventAsync(
                    AuditEventFactory.Create(
                        entityType: "DailyLog",
                        entityId: log.Id,
                        action: "VerificationChanged",
                        actorUserId: command.VerifiedByUserId,
                        actorRole: resolvedCallerRole.ToString(),
                        payload: new
                        {
                            logId = log.Id,
                            verificationId = emittedEvent.Id,
                            status = emittedEvent.Status.ToString(),
                            emittedEvent.Reason,
                            emittedEvent.OccurredAtUtc
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
            }
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
