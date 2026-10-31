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
using ShramSafal.Domain.Farms;
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
        // spec: plr-d10 (I27) — the grant is now also what decides who may give the OWNER'S
        // confirmation (OwnerConfirmationAuthority), and a co-owner's role no longer carries
        // that, so the read is skipped only for the primary owner (whose role is the whole
        // answer); it used to be skipped for every owner-tier role. Still the stored,
        // clock-evaluated flag — never a role tier, never anything from the wire.
        //
        // lane 2b (founder D-26 "recording attendance does not mean approving it"; D-44) — the
        // input is now the CONFIRM-RECORDS authority of THIS farm's seat, separate from take
        // हजेरी. MU design §11.2: a confirmation made OFFLINE while the authority was alive, which
        // reaches the server after it ended, still counts — and is flagged for the owner. The
        // moment it was made is the phone's own statement (verify_log_v2 "decidedAt"), trusted
        // only inside [the record's creation, now]; anything else is "now". fix 1 (HIGH-2): only
        // inside LateArrivalWindow (received within 7 days after the end, made within the 7 days
        // before it) and only as a NEW decision on an undecided record; any other decision from an
        // ENDED confirm authority is refused below and kept whole for the owner by the sync layer.
        var nowUtc = clock.UtcNow;
        var decidedAtUtc = BoundedDecisionTime(command.DecidedAtUtc, log.CreatedAtUtc, nowUtc);
        var (confirmStanding, confirmEndedAtUtc) = resolvedCallerRole == AppRole.PrimaryOwner
            ? (AuthorityStanding.HeldNow, (DateTime?)null)
            : await FarmAuthorityGate.StandingAsync(
                repository, (Guid)log.FarmId, command.VerifiedByUserId, FarmAuthority.ConfirmRecords,
                nowUtc, decidedAtUtc, ct);
        var hasConfirmAuthority =
            resolvedCallerRole != AppRole.PrimaryOwner
            && confirmStanding is AuthorityStanding.HeldNow or AuthorityStanding.HeldWhenItHappened;
        var acceptedAfterAuthorityEnded = confirmStanding == AuthorityStanding.HeldWhenItHappened;

        // Phase 5 entitlement gate (PaidFeature.RunVerification).
        var gate = await EntitlementGate.CheckAsync<DailyLogDto>(
            entitlementPolicy, new UserId(command.VerifiedByUserId), log.FarmId,
            PaidFeature.RunVerification, ct);
        if (gate is not null) return gate;

        var priorState = log.CurrentVerificationStatus;

        // ── spec: plr-d10-redesign-real-integration-2026-10-25 (I27) ─────────────────
        // FOUNDER D-44 / D-46: only an authorised person's deliberate confirmation gives a
        // record "मालकाकडून खात्री" (Verified) — the primary owner (his own records included:
        // "save and confirm"), or a member holding the owner's grant (founder 2026-08-27: his
        // own record too). A co-owner's or मुकादम's role alone no longer carries it.
        //
        // Two kinds of request are NOT refused but not counted either — refusing would park the
        // queue of a phone that has not updated (P11) — and are kept as what they are, a mark
        // (a Draft event naming itself; the status does not move; never on the wire):
        //   * a member the approve gate admits who holds no confirm authority (a co-owner);
        //   * the record's own speaker tapping the I13 result screen's "पक्कं आहे", which
        //     reached the server as verify_log_v2 with no review basis. I27 amends I13: that tap
        //     is no longer his verify act (D-44: "the person reporting work must not be forced
        //     to approve their own recording"). A deliberate confirmation from a build that
        //     states heard / read still counts for the owner or a granted member.
        //
        // A DISPUTE (शंका, -> Disputed) is the same owner's decision, the other way: it takes a
        // record off its standing, so the same authority gives it (review S2). A member the gate
        // admits without that authority (a co-owner without the grant, old phones included) is
        // kept as a mark the same way; the status does not move. Roles the gate refuses (a
        // worker, an ungranted मुकादम) are refused before this line, exactly as before.
        var isSpeaker = command.VerifiedByUserId == log.OperatorUserId.Value;
        var wantsOwnerConfirmation = command.TargetStatus == VerificationStatus.Verified;
        var wantsOwnerDecision = wantsOwnerConfirmation || command.TargetStatus == VerificationStatus.Disputed;
        var isOldResultScreenSelfTap = isSpeaker && command.ReviewBasisOmittedOnV2;

        // lane 2b fix 1 (HIGH-2) — a decision resting on an ENDED confirm authority is never applied:
        // outside the late window it is refused outright; inside it, only a record nobody has decided
        // yet takes it (it never overwrites a मंजूर / शंका already given). The refusal (Forbidden) is
        // kept whole for the owner by the sync layer (WorkKeptForOwner); nothing is dropped.
        if (wantsOwnerDecision
            && !(wantsOwnerConfirmation && isOldResultScreenSelfTap)
            && (confirmStanding == AuthorityStanding.Ended
                || (acceptedAfterAuthorityEnded
                    && priorState is not (VerificationStatus.Draft or VerificationStatus.Confirmed))))
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.Forbidden);
        }

        if ((wantsOwnerConfirmation && isOldResultScreenSelfTap)
            || (wantsOwnerDecision
                && !OwnerConfirmationAuthority.MayConfirm(resolvedCallerRole, hasConfirmAuthority)))
        {
            return await RecordMarkWithoutConfirmAuthorityAsync(log, command, resolvedCallerRole, isSpeaker, priorState, ct);
        }

        // D-46 §3: a confirmation applies to the exact version reviewed. A phone that says which
        // version it showed is refused when the record has moved on, so the changed record is
        // seen before it is confirmed. Absent (every older phone) = the version current now.
        if (wantsOwnerConfirmation
            && command.ExpectedLogVersion is { } seenVersion
            && seenVersion != log.ContentVersion)
        {
            return Result.Failure<DailyLogDto>(ShramSafalErrors.LogChangedSinceReview);
        }

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
                hasConfirmAuthority: hasConfirmAuthority);

            verification = emitted[^1];

            // I27 (D-44 §3): preserve WHICH version was confirmed and whether the confirmer
            // heard the original voice or read the text. Stamped before the audit rows below
            // so they carry it too.
            if (wantsOwnerConfirmation && verification.Status == VerificationStatus.Verified)
            {
                log.StampOwnerConfirmation(verification, command.ReviewBasis);
            }

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
                            emittedEvent.OccurredAtUtc,
                            emittedEvent.ConfirmedLogVersion,
                            emittedEvent.ReviewBasis
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

            // lane 2b (MU design §11.2) — the owner's decision was made while the confirm-records
            // authority was alive and reached the server after it ended: it counts, and the owner
            // is told so ("जबाबदारी संपल्यानंतर पोहोचलं", PROPOSED on the phone).
            if (acceptedAfterAuthorityEnded && wantsOwnerDecision)
            {
                await repository.AddAuditEventAsync(
                    AuditEventFactory.Create(
                        entityType: "DailyLog",
                        entityId: log.Id,
                        action: LateAuthorityAudit.AcceptedAfterEnd,
                        actorUserId: command.VerifiedByUserId,
                        actorRole: resolvedCallerRole.ToString(),
                        payload: new
                        {
                            logId = log.Id,
                            authority = FarmAuthorities.NameOf(FarmAuthority.ConfirmRecords),
                            requested = command.TargetStatus.ToString(),
                            verificationId = verification.Id,
                            happenedAtUtc = decidedAtUtc,
                            authorityEndedAtUtc = confirmEndedAtUtc,
                            receivedAtUtc = nowUtc,
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

    /// <summary>
    /// spec: plr-d10 (I27) — the confirm request of someone who may not give the owner's
    /// confirmation. Written as his mark (see <see cref="DailyLog.RecordMarkWithoutConfirmAuthority"/>):
    /// the record's status does not move. Audited, and answered with success (the record as it
    /// stands) so an older phone's queue keeps moving (P11).
    /// </summary>
    private async Task<Result<DailyLogDto>> RecordMarkWithoutConfirmAuthorityAsync(
        DailyLog log,
        VerifyLogCommand command,
        AppRole callerRole,
        bool isSpeaker,
        VerificationStatus priorState,
        CancellationToken ct)
    {
        var mark = log.RecordMarkWithoutConfirmAuthority(
            command.VerificationEventId ?? idGenerator.New(),
            new UserId(command.VerifiedByUserId),
            clock.UtcNow);

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "DailyLog",
                entityId: log.Id,
                action: "ConfirmRequestNotCounted",
                actorUserId: command.VerifiedByUserId,
                actorRole: callerRole.ToString(),
                payload: new
                {
                    logId = log.Id,
                    markId = mark?.Id,
                    statusUnchanged = priorState.ToString(),
                    reason = mark?.Reason ?? (isSpeaker
                        ? DailyLog.SpeakerOwnMarkReason
                        : DailyLog.NoConfirmAuthorityMarkReason),
                    occurredAtUtc = mark?.OccurredAtUtc,
                    requested = command.TargetStatus.ToString(),
                    // The words he gave with it (a dispute's reason), kept rather than dropped (P10).
                    requestedReason = command.Reason,
                    countedAsOwnerConfirmation = false
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

    /// <summary>
    /// lane 2b (MU design §11.2) — when the phone says the decision was made. It is the phone's
    /// own statement, so it is believed only inside [the record's creation, now]: a decision
    /// cannot precede the record it decides, nor lie in the future. Outside that, or absent (every
    /// path but verify_log_v2), the decision is taken as made now — the fail-closed reading.
    /// </summary>
    internal static DateTime? BoundedDecisionTime(DateTime? stated, DateTime recordCreatedAtUtc, DateTime nowUtc)
    {
        if (stated is not { } value)
        {
            return null;
        }

        var utc = value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };

        return utc >= recordCreatedAtUtc && utc <= nowUtc ? utc : null;
    }
}
