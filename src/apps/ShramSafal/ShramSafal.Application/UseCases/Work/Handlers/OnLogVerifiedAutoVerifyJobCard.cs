using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Microsoft.Extensions.Logging;

namespace ShramSafal.Application.UseCases.Work.Handlers;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.3.1 + 2.3.2.
///
/// Called from VerifyLogHandler after a log verification event is persisted.
/// Implements CEI-I9 side effects:
///
///   - When a DailyLog transitions TO Verified: find any Completed JobCard linked to it
///     and auto-transition it to VerifiedForPayout.
///
///   - When a DailyLog transitions OUT of Verified (edit → Draft, or Verified → Disputed):
///     find any JobCard in VerifiedForPayout linked to it and revert it to Completed.
///     If the card is already PaidOut, log a warning — manual reconciliation is required.
///
/// DESIGN NOTE: There is no MediatR / domain-event-dispatch infrastructure in this codebase.
/// Domain events are raised on entities but not automatically dispatched. This handler is
/// instead invoked explicitly by VerifyLogHandler after SaveChangesAsync, following the same
/// "inline coordinator" pattern used for compliance evaluation in Phase 3.
/// </summary>
public sealed class OnLogVerifiedAutoVerifyJobCard(
    IShramSafalRepository repository,
    VerifyJobCardForPayoutHandler verifyForPayoutHandler,
    IClock clock,
    ILogger<OnLogVerifiedAutoVerifyJobCard> logger)
{
    /// <summary>
    /// Handle a log verification status change. Idempotent — safe to call on every verify.
    /// </summary>
    public async Task HandleAsync(
        Guid dailyLogId,
        VerificationStatus newStatus,
        UserId actorUserId,
        CancellationToken ct = default)
    {
        if (newStatus == VerificationStatus.Verified)
        {
            await HandleLogVerifiedAsync(dailyLogId, actorUserId, ct);
        }
        else
        {
            await HandleLogDeVerifiedAsync(dailyLogId, newStatus, ct);
        }
    }

    // ── Auto-verify job card when log becomes Verified ──────────────────────

    private async Task HandleLogVerifiedAsync(
        Guid dailyLogId,
        UserId actorUserId,
        CancellationToken ct)
    {
        var linkedJobCard = await repository.GetJobCardByLinkedDailyLogIdAsync(dailyLogId, ct);
        if (linkedJobCard is null)
            return; // Most logs aren't linked to a job card — no-op.

        if (linkedJobCard.Status != JobCardStatus.Completed)
            return; // Already transitioned or in a terminal state — no-op.

        // Auto-verify using the VerifyJobCardForPayoutHandler.
        // The actor is the log verifier who triggered this transition.
        var result = await verifyForPayoutHandler.HandleAsync(
            new VerifyJobCardForPayoutCommand(
                JobCardId: linkedJobCard.Id,
                CallerUserId: actorUserId,
                ClientCommandId: null),
            ct);

        if (result.IsFailure)
        {
            // Log the failure but don't surface it — the log verification already succeeded.
            logger.LogWarning(
                "Auto-verify for JobCard {JobCardId} linked to DailyLog {DailyLogId} failed: {Error}",
                linkedJobCard.Id, dailyLogId, result.Error.Code);
        }
    }

    // ── Revert job card when log leaves Verified ─────────────────────────────

    private async Task HandleLogDeVerifiedAsync(
        Guid dailyLogId,
        VerificationStatus newStatus,
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
