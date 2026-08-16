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
    IScheduleComplianceService complianceService,
    // spec: dfes-companion-2026-07-11 (wave-1.3) — I3. Optional so the existing
    // direct-construction unit tests keep compiling; resolved from DI in production
    // (registered in ShramSafal.Api DependencyInjection). Used for ONE thing: when a
    // task addition drops a log OUT of Verified, a payout authorisation that was
    // granted on the strength of that Verified log has to be withdrawn. See the
    // re-open block below.
    Work.Handlers.OnLogVerifiedAutoVerifyJobCard? logVerificationChanged = null)
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

        // ── spec: dfes-companion-2026-07-11 (wave-1.3) — I3 ──────────────────────
        // AN ATTESTATION MUST COVER THE CONTENT IT ATTESTS TO.
        //
        // This handler called log.AddTask and never log.Edit, so a task added after
        // creation rode under an attestation stamped when the log had ZERO tasks.
        // Before wave-1.3 that was invisible (logs started Draft and nothing was
        // attested); now an owner's log starts Verified, so "Verified" could mean
        // "verified, plus three things nobody looked at" — and Verified is what
        // releases a worker's pay (JobCard.cs:206).
        //
        // The naive fix — always call Edit — is WRONG and was explicitly rejected.
        // VerificationStateMachine.GetNextStatusForEdit maps Verified -> Draft, so the
        // owner's SECOND task of the day would re-open his own log and strand it in
        // Draft forever: the exact bug wave-1.3 fixed, through a different door.
        //
        // So: re-open, then re-attest ONLY when the person adding the task is the
        // person whose attestation it was, and his SERVER-DERIVED role still holds both
        // FSM edges. Net effect:
        //   • the owner adding to his own day  -> stays Verified, freshly stamped,
        //     now covering the new task;
        //   • ANYONE ELSE adding to his day    -> the log re-opens into the owner's
        //     inbox, which closes a real pre-existing hole: a mukadam could previously
        //     append work to an already-approved day and it stayed approved.
        //
        // A log NOT currently attested (Draft — e.g. a mukadam's) is untouched: there
        // is nothing to re-open and nothing to invalidate.
        var priorStatus = log.CurrentVerificationStatus;
        VerificationEvent? reOpen = null;
        var reAttested = false;
        string? reAttestedRole = null;

        if (priorStatus != VerificationStatus.Draft)
        {
            // The status fold is OrderBy(OccurredAtUtc).Last(), so every event written
            // here must be strictly LATER than everything already on the log. A clock
            // that has not advanced since creation (or a coarse one) would otherwise
            // leave the fold at the mercy of row order after an EF reload — the same
            // reasoning as the 1 ms offset inside TrySelfVerifyAsCreator.
            var lastEventAtUtc = log.VerificationEvents.Count == 0
                ? DateTime.MinValue
                : log.VerificationEvents.Max(e => e.OccurredAtUtc);
            var now = clock.UtcNow;
            var reOpenAtUtc = now > lastEventAtUtc ? now : lastEventAtUtc.AddMilliseconds(1);

            // Null when the current status has no edit transition (Disputed,
            // CorrectionPending) — those are already "not approved", nothing to re-open.
            reOpen = log.Edit(idGenerator.New(), new UserId(command.ActorUserId), reOpenAtUtc);

            if (reOpen is not null && command.ActorUserId == log.OperatorUserId.Value)
            {
                // Authority from the DATABASE, never from command.ActorRole — the same
                // rule the create path follows, for the same reason.
                var actorRole = await repository.GetUserRoleForFarmAsync(
                    log.FarmId, command.ActorUserId, ct);

                if (actorRole is { } role
                    && log.TrySelfVerifyAsCreator(
                        idGenerator.New(), idGenerator.New(), role, reOpenAtUtc.AddMilliseconds(1)))
                {
                    reAttested = true;
                    reAttestedRole = role.ToString();
                }
            }
        }

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "DailyLog",
                entityId: log.Id,
                action: "TaskAdded",
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    logId = log.Id,
                    taskId = task.Id,
                    task.ActivityType,
                    task.Notes,
                    task.OccurredAtUtc,
                    complianceOutcome = compliance.Outcome.ToString(),
                    complianceDeltaDays = compliance.DeltaDays
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

        // spec: dfes-companion-2026-07-11 (wave-1.3) — I3. Same rule as the create
        // path: a verification status that moved without a human pressing a button
        // still has to be reconstructable from the ledger afterwards. One row per
        // task addition that moved the status, saying which way it went and whether
        // anyone's attestation now covers the log.
        if (reOpen is not null)
        {
            var landedOn = log.CurrentVerificationStatus;
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "DailyLog",
                    entityId: log.Id,
                    action: "VerificationChanged",
                    actorUserId: command.ActorUserId,
                    actorRole: command.ActorRole ?? "unknown",
                    payload: new
                    {
                        logId = log.Id,
                        from = priorStatus.ToString(),
                        to = landedOn.ToString(),
                        trigger = "TaskAdded",
                        taskId = task.Id,
                        reAttestedByCreator = reAttested,
                        role = reAttestedRole
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

        await repository.SaveChangesAsync(ct);

        // spec: dfes-companion-2026-07-11 (wave-1.3) — I3, the money consequence.
        // Domain events are raised but never dispatched in this codebase (see
        // OnLogVerifiedAutoVerifyJobCard's design note), so a log leaving Verified
        // here would otherwise leave a job card sitting in VerifiedForPayout on the
        // strength of an approval that no longer covers the day's work. Withdraw it,
        // exactly as VerifyLogHandler does when an owner disputes.
        //
        // Deliberately ONE direction. The hook can also PROMOTE a Completed card to
        // VerifiedForPayout when a log becomes Verified; it is not called on the
        // re-attest path, because "the owner typed another task" must never be the
        // act that authorises a payout. Only a person asking for it may do that.
        if (priorStatus == VerificationStatus.Verified
            && log.CurrentVerificationStatus != VerificationStatus.Verified
            && logVerificationChanged is not null)
        {
            await logVerificationChanged.HandleAsync(
                log.Id, log.CurrentVerificationStatus, new UserId(command.ActorUserId), ct);
        }

        return Result.Success(log.ToDto());
    }
}
