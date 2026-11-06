using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Microsoft.Extensions.Logging;

namespace ShramSafal.Application.UseCases.Work.Handlers;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.3.2, as narrowed by founder D-33 (lane L4b).
///
/// Called after a log's verification status changes (VerifyLogHandler, and the content-change doors).
///
///   - When a DailyLog transitions TO Verified: NOTHING happens to its job card. Founder D-33 (verbatim): "मंजूर no
///     longer moves a काम कार्ड to 'ready to pay'". The record's मंजूर confirms the WORK; the card's payment state is
///     its own decision (verify-for-payout). Until lane L4b this auto-transitioned a Completed card to
///     VerifiedForPayout (CEI-I9); that cascade is removed for every phone (verify_log, verify_log_v2, REST), and a
///     card already VerifiedForPayout is left exactly as it is (P10: no rewrite of existing data).
///
///   - When a DailyLog transitions OUT of Verified (edit → Draft, or Verified → Disputed): a card in
///     VerifiedForPayout linked to it is reverted to Completed (unchanged safety rule: payment is not authorised on a
///     record that is no longer confirmed). Lane L4b fix round 1 (M-2): that take-back is a decision the ledger
///     records — an audit row <see cref="PayoutReadinessWithdrawnAction"/> names the record, its new state and who
///     moved it, and the farm's job-card read says "payout check withdrawn" on the card. If the card is already
///     PaidOut, a warning is logged.
///
/// DESIGN NOTE: There is no MediatR / domain-event-dispatch infrastructure in this codebase.
/// Domain events are raised on entities but not automatically dispatched. This handler is
/// instead invoked explicitly by VerifyLogHandler after SaveChangesAsync, following the same
/// "inline coordinator" pattern used for compliance evaluation in Phase 3.
/// </summary>
public sealed class OnLogVerifiedAutoVerifyJobCard(
    IShramSafalRepository repository,
    IClock clock,
    ILogger<OnLogVerifiedAutoVerifyJobCard> logger)
{
    /// <summary>Lane L4b fix round 1 (M-2) — the audit action written when a ready-to-pay card is taken back.</summary>
    public const string PayoutReadinessWithdrawnAction = "jobcard.payout-readiness-withdrawn";

    /// <summary>
    /// Handle a log verification status change. Idempotent — safe to call on every verify. The audit row of a
    /// take-back carries no request provenance (a caller that has it uses the overload below).
    /// </summary>
    public Task HandleAsync(
        Guid dailyLogId,
        VerificationStatus newStatus,
        UserId actorUserId,
        CancellationToken ct = default) =>
        HandleAsync(dailyLogId, newStatus, actorUserId, ChangeProvenance.Unknown, ct);

    /// <summary>
    /// Handle a log verification status change, stamping a take-back's audit row with the request that caused it.
    /// </summary>
    public async Task HandleAsync(
        Guid dailyLogId,
        VerificationStatus newStatus,
        UserId actorUserId,
        ChangeProvenance provenance,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(provenance);

        // Founder D-33 — a मंजूर (Verified) never moves the linked job card.
        if (newStatus == VerificationStatus.Verified)
        {
            return;
        }

        await HandleLogDeVerifiedAsync(dailyLogId, newStatus, actorUserId, provenance, ct);
    }

    // ── Revert job card when log leaves Verified ─────────────────────────────

    private async Task HandleLogDeVerifiedAsync(
        Guid dailyLogId,
        VerificationStatus newStatus,
        UserId actorUserId,
        ChangeProvenance provenance,
        CancellationToken ct)
    {
        // Only react to transitions that leave the Verified state.
        // VerificationStateMachine maps Verified → Disputed as valid exit.
        // Edit from Verified also resets to Draft, raising another LogVerifiedEvent with Draft.
        if (newStatus != VerificationStatus.Disputed && newStatus != VerificationStatus.Draft)
            return;

        var linkedJobCard = await repository.GetJobCardByLinkedDailyLogIdAsync(dailyLogId, ct);
        if (linkedJobCard is null)
            return;

        if (linkedJobCard.Status == JobCardStatus.VerifiedForPayout)
        {
            // Revert to Completed — the payout authorization is no longer valid.
            linkedJobCard.RevertToCompletedFromVerifiedForPayout(clock.UtcNow);

            // Lane L4b fix round 1 (M-2) — never a silent take-back: who, which record, and the state it is now in.
            // The role is the seat's, read from the farm (never the phone's claim).
            var actorRole = await repository.GetUserRoleForFarmAsync(linkedJobCard.FarmId.Value, actorUserId.Value, ct);
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "JobCard",
                    entityId: linkedJobCard.Id,
                    action: PayoutReadinessWithdrawnAction,
                    actorUserId: actorUserId.Value,
                    actorRole: actorRole?.ToString() ?? "unknown",
                    payload: new { jobCardId = linkedJobCard.Id, dailyLogId, recordState = newStatus.ToString() },
                    farmId: linkedJobCard.FarmId.Value,
                    clientCommandId: provenance.ClientCommandId,
                    appVersion: string.IsNullOrWhiteSpace(provenance.AppVersion)
                        ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                        : provenance.AppVersion,
                    deviceId: provenance.DeviceId,
                    ipHash: provenance.IpHash,
                    sourceAiJobId: null),
                ct);
            await repository.SaveChangesAsync(ct);

            logger.LogInformation(
                "JobCard {JobCardId} reverted from VerifiedForPayout to Completed because DailyLog {DailyLogId} transitioned to {NewStatus}.",
                linkedJobCard.Id, dailyLogId, newStatus);
        }
        else if (linkedJobCard.Status == JobCardStatus.PaidOut)
        {
            // DESIGN CHOICE: If the card is already PaidOut, a log dispute creates a
            // compliance risk but we cannot auto-reverse a financial transaction.
            // We emit a warning so the compliance team can investigate.
            // A dedicated ComplianceSignal (Phase 3) would be the right long-term fix,
            // but that module is not wired here to avoid cross-module coupling.
            // Future: emit a JobCardPayoutDeAuthorizedEvent to trigger a signal.
            logger.LogWarning(
                "JobCard {JobCardId} is in PaidOut status but its linked DailyLog {DailyLogId} " +
                "has transitioned to {NewStatus}. Manual reconciliation may be required. " +
                "A compliance signal should be raised for farm {FarmId}.",
                linkedJobCard.Id, dailyLogId, newStatus, linkedJobCard.FarmId.Value);

            // NOTE: Not creating a ComplianceSignal here to avoid coupling the Work module
            // to the Compliance module at the Application layer. The compliance sweeper
            // (CEI Phase 3) will detect the anomaly on its next evaluation pass via
            // the existing LabourPayoutVerificationGap rule.
        }
    }
}

/// <summary>
/// Lane L4b fix round 1 (M-2) — the request that changed a record, for the audit row of what that change did to its
/// job card. <see cref="Unknown"/> carries the same stand-ins the log commands default to.
/// </summary>
public sealed record ChangeProvenance(string? ClientCommandId, string AppVersion, string DeviceId, string IpHash)
{
    /// <summary>No request provenance (a direct caller): the log commands' own defaults.</summary>
    public static ChangeProvenance Unknown { get; } = new(null, "unknown", "unknown", "sha256:unknown");
}
