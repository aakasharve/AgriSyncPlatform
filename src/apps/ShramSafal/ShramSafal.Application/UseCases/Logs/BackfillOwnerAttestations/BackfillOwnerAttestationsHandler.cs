// spec: dfes-companion-2026-07-11 (wave-1.5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.BackfillOwnerAttestations;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — THE DAYS ALREADY STUCK.
///
/// <para><b>Why this is server-side, against the plan that commissioned it.</b> Wave 1.5 was
/// specified as "a one-time local re-derivation in the Dexie upgrade path". Measured against
/// the code as it stands after wave 1.3, that is not merely suboptimal — it cannot work.
/// Verification has NO column: <c>DailyLogConfiguration</c> <c>Ignore</c>s both status
/// properties and <c>DailyLog.CurrentVerificationStatus</c> folds the events, defaulting to
/// <c>Draft</c>. A log created before wave 1.3 emitted zero events, so
/// <c>PullSyncChangesHandler</c> puts <c>"Draft"</c> and an EMPTY <c>verificationEvents[]</c>
/// on the wire for it — and <c>logsReconciler.ts</c> replaces the device's entire
/// <c>verification</c> object with the server's ("Verification is a server-side FSM; the
/// device never wins it"), <c>verifiedByOperatorId</c> included, which it reads from the
/// latest event and therefore leaves <c>undefined</c>. A Dexie-only backfill would be erased
/// by the next pull that carried the log, taking the verifier's name with it. So the repair
/// has to happen where the answer is decided. Doctrine P10 states the same thing from the
/// other end: acknowledged truth must be reconstructable WITHOUT the originating device, and
/// a repair that only ever existed in one phone's IndexedDB is not.</para>
///
/// <para><b>Why it reuses the live path instead of a SQL migration.</b> Everything that
/// decides WHO may be attested for is asked of the same code the live create path asks:
/// <c>GetUserRoleForFarmAsync</c> for authority (declared farm ownership, else a
/// non-terminal membership) and <c>TrySelfVerifyAsCreator</c> — which puts the question to
/// <c>VerificationStateMachine</c> itself — for whether that authority carries both FSM
/// edges. Hand-written SQL would have had to restate the owner-role set and the transition
/// table in a second place, where it could drift silently from the first; this repo has
/// already been bitten by a copy that could not detect drift (wave-1.3, I5). The consequence
/// that matters: THE MUKADAM NEGATIVE IS TRUE BY CONSTRUCTION. A foreman's old day is not
/// skipped by a rule written here — it is refused by the very lines that refuse it live.</para>
///
/// <para><b>Only the log's own creator, and only for himself.</b> Attestation is credited to
/// <c>OperatorUserId</c> by <c>TrySelfVerifyAsCreator</c>, and the role looked up is the
/// OPERATOR's. A farm owner's authority is therefore never borrowed to bulk-approve work
/// somebody else recorded: if a mukadam wrote the day, the day stays in the inbox waiting
/// for a human to press approve. Mass-confirming history is the one outcome that would look
/// like success and quietly destroy the trust model.</para>
///
/// <para><b>Reversible.</b> Both events carry
/// <see cref="DailyLog.BackfilledAttestationReason"/>, not the create-time marker, so every
/// row this ever wrote can be identified — and undone — with a one-line predicate, and no
/// row a human actually produced is caught by it.</para>
///
/// <para><b>The caller owns the tenancy posture.</b> This scans every farm, so it must run
/// with <c>TenantContext.ElevateToAdminCrossTenant()</c> already applied — the same posture
/// <c>/sync/push</c> runs under. It is asserted, not assumed: an un-elevated caller would
/// silently scan only what RLS let it see and report a smaller, wrong "nothing to do".</para>
/// </summary>
public sealed class BackfillOwnerAttestationsHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<BackfillOwnerAttestationsHandler> logger)
    : IHandler<BackfillOwnerAttestationsCommand, BackfillOwnerAttestationsResult>
{
    /// <summary>
    /// Provenance stamped on the audit rows this writes. <c>AuditEventFactory</c> requires
    /// non-empty app version / device id / IP hash, and there is no honest value for any of
    /// them here: no device made this call and no request carried it. These say exactly
    /// that, rather than borrowing a farmer's real device id and making a server repair look
    /// like something his phone did.
    /// </summary>
    private const string BackfillAppVersion = "wave-1.5-backfill";
    private const string BackfillDeviceId = "server-backfill";
    private const string BackfillIpHash = "server-backfill";

    public async Task<Result<BackfillOwnerAttestationsResult>> HandleAsync(
        BackfillOwnerAttestationsCommand command, CancellationToken ct = default)
    {
        var candidates = await repository.GetDailyLogsWithNoVerificationHistoryAsync(
            command.BatchSize, command.AfterCreatedAtUtc, command.AfterId, ct);

        if (candidates.Count == 0)
        {
            logger.LogInformation(
                "Owner-attestation backfill: no logs without verification history past the " +
                "current cursor; nothing left to repair.");

            // Echo the incoming cursor rather than null: a caller that stores what comes
            // back must not have its position silently reset to "start again from the
            // oldest" by an empty page.
            return Result.Success(new BackfillOwnerAttestationsResult(
                0, 0, 0, command.AfterCreatedAtUtc, command.AfterId));
        }

        logger.LogInformation(
            "Owner-attestation backfill: {Count} log(s) have never been assessed by anyone; " +
            "deciding each one on the creator's CURRENT authority over that farm.",
            candidates.Count);

        var attested = 0;
        var leftForReview = 0;

        foreach (var log in candidates)
        {
            ct.ThrowIfCancellationRequested();

            // Authority is the log's OWN creator's, read from the database — never a role
            // carried on a payload, and never the farm owner's authority applied to work
            // somebody else recorded.
            var creatorRole = await repository.GetUserRoleForFarmAsync(
                log.FarmId, log.OperatorUserId, ct);

            if (creatorRole is not { } role)
            {
                // No current membership: the creator left the farm, or was removed. Nobody
                // is in a position to self-attest on his behalf and the server must not
                // invent one.
                leftForReview++;
                continue;
            }

            // NOW, not the log's creation time. Two reasons, and both are load-bearing.
            // Honesty first: this attestation is being made today, and dating it back to
            // the day the farmer saved the log would be the server fabricating a record of
            // something that did not happen then (doctrine P4). Mechanics second: Verify()
            // sets ModifiedAtUtc = occurredAtUtc, and ModifiedAtUtc is what /sync/pull's
            // delta is keyed on. Back-dating would move the log BACKWARDS out of the delta,
            // so the repair would sit in the database and never reach the phone that needed
            // it — and logsReconciler's freshness guard would drop it even if it did.
            var attestedAtUtc = clock.UtcNow;

            if (!log.TrySelfVerifyAsCreator(
                    idGenerator.New(), idGenerator.New(), role, attestedAtUtc,
                    DailyLog.BackfilledAttestationReason))
            {
                // The role does not hold both FSM edges — a Mukadam, Worker or Consultant
                // recorded this day. It stays Draft and keeps waiting for an owner, which
                // is the entire point of the approval model.
                leftForReview++;
                continue;
            }

            attested++;

            // wave-1.3's I1 ruling, applied to a bulk write: an audit row that was never
            // written at the moment of the act can never be reconstructed afterwards. This
            // one is the only record that will ever exist of the server having claimed
            // authority over this day on the farmer's behalf, so it is written here rather
            // than left to be inferred from the verification events.
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "DailyLog",
                    entityId: log.Id,
                    action: "VerificationChanged",
                    actorUserId: log.OperatorUserId,
                    // No caller claimed anything here, so unlike every other audit row in
                    // the codebase there is no "what the caller said it was" to record.
                    // The server-derived role is the only role in play.
                    actorRole: role.ToString(),
                    payload: new
                    {
                        logId = log.Id,
                        from = VerificationStatus.Draft.ToString(),
                        to = VerificationStatus.Verified.ToString(),
                        selfAttested = true,
                        backfilled = true,
                        role = role.ToString(),
                        reason = DailyLog.BackfilledAttestationReason,
                        logDate = log.LogDate.ToString("yyyy-MM-dd"),
                        logCreatedAtUtc = log.CreatedAtUtc,
                        attestedAtUtc
                    },
                    farmId: log.FarmId,
                    clientCommandId: null,
                    appVersion: BackfillAppVersion,
                    deviceId: BackfillDeviceId,
                    ipHash: BackfillIpHash),
                ct);
        }

        await repository.SaveChangesAsync(ct);

        logger.LogInformation(
            "Owner-attestation backfill pass complete: scanned {Scanned}, attested {Attested}, " +
            "left for a human to approve {LeftForReview}.",
            candidates.Count, attested, leftForReview);

        // The last row of an oldest-first page IS the high-water mark of everything this
        // pass looked at, attested or refused. Handing it back is what lets the caller
        // step OVER the refusals instead of re-reading them: they keep no events, so
        // without this they would occupy the front of every subsequent page forever.
        var lastExamined = candidates[^1];

        return Result.Success(new BackfillOwnerAttestationsResult(
            candidates.Count, attested, leftForReview, lastExamined.CreatedAtUtc, lastExamined.Id));
    }
}
