using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CancelJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.7.
/// Cancels a JobCard. Allowed from Draft, Assigned, InProgress, or Completed.
/// Blocked from VerifiedForPayout and PaidOut (terminal states).
/// Role gate enforced by the domain.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): wired through the
/// explicit <see cref="HandlerPipeline"/>. Caller-shape + reason
/// validation lives in <see cref="CancelJobCardValidator"/>; job-card-
/// existence + farm-membership authorization lives in
/// <see cref="CancelJobCardAuthorizer"/>. When this handler is resolved
/// via the pipeline (see DI registration), both layers run before the
/// body executes; when resolved directly (legacy tests), the body's
/// inline guards (Reason check, JobCardNotFound, role-resolution
/// Forbidden) continue to enforce the same invariants as
/// defense-in-depth.
/// </para>
/// </summary>
public sealed class CancelJobCardHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<CancelJobCardCommand, CancelJobCardResult>
{
    public async Task<Result<CancelJobCardResult>> HandleAsync(
        CancelJobCardCommand command,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command.Reason))
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.InvalidCommand);

        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Resolve caller role on farm.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.Forbidden);

        // 3. Delegate to domain — enforces state and role gates.
        try
        {
            jobCard.Cancel(command.CallerUserId, callerRole.Value, command.Reason, clock.UtcNow);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("terminal"))
        {
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.JobCardInvalidState);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("already cancelled"))
        {
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.JobCardInvalidState);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("not permitted"))
        {
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.JobCardRoleNotAllowed);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<CancelJobCardResult>(ShramSafalErrors.JobCardInvalidState);
        }

        // 4. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: jobCard.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.cancelled",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, Reason = command.Reason },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new CancelJobCardResult(jobCard.Id));
    }
}
