using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.5.
/// Marks a Completed JobCard as VerifiedForPayout after checking:
///   - The linked DailyLog is in Verified status (CEI-I9)
///   - The caller holds an eligible role: PrimaryOwner, SecondaryOwner, Agronomist, or FpcTechnicalManager
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyJobCardForPayout): wired through
/// the explicit <see cref="HandlerPipeline"/>. Caller-shape validation
/// (empty IDs) lives in <see cref="VerifyJobCardForPayoutValidator"/>;
/// job-card-existence + role-tier (Owner / Agronomist /
/// FpcTechnicalManager) authorization lives in
/// <see cref="VerifyJobCardForPayoutAuthorizer"/>. When this handler
/// is resolved via the pipeline (see DI registration), both layers
/// run before the body executes; when resolved directly (legacy
/// tests), the body's inline guards continue to enforce the same
/// invariants. The aggregate-state checks (linked-daily-log present,
/// DailyLog existence, CEI-I9 linked-log-must-be-Verified) stay in
/// the body — they all surface as JobCardInvalidState /
/// DailyLogNotFound.
/// </para>
/// </summary>
public sealed class VerifyJobCardForPayoutHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<VerifyJobCardForPayoutCommand, VerifyJobCardForPayoutResult>
{
    public async Task<Result<VerifyJobCardForPayoutResult>> HandleAsync(
        VerifyJobCardForPayoutCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Load linked daily log.
        if (jobCard.LinkedDailyLogId is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardInvalidState);

        var dailyLog = await repository.GetDailyLogByIdAsync(jobCard.LinkedDailyLogId.Value, ct);
        if (dailyLog is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.DailyLogNotFound);

        // 3. Resolve caller role on farm.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.Forbidden);

        if (!IsEligibleToVerify(callerRole.Value))
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardRoleNotAllowed);

        // 4. Domain transition — enforces CEI-I9 (linked log must be Verified).
        try
        {
            jobCard.MarkVerifiedForPayout(
                dailyLog.CurrentVerificationStatus,
                command.CallerUserId,
                callerRole.Value,
                clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<VerifyJobCardForPayoutResult>(ShramSafalErrors.JobCardInvalidState);
        }

        // 5. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: jobCard.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.verified-for-payout",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, jobCard.LinkedDailyLogId },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new VerifyJobCardForPayoutResult(jobCard.Id));
    }

    private static bool IsEligibleToVerify(AppRole role) =>
        role is AppRole.PrimaryOwner
            or AppRole.SecondaryOwner
            or AppRole.Agronomist
            or AppRole.FpcTechnicalManager;
}
