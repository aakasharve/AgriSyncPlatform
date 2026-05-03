using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.StartJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.3.
/// Starts a JobCard. The domain enforces that only the assigned worker may call this.
/// Idempotent when the same ClientCommandId is resubmitted.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (StartJobCard): wired through the
/// explicit <see cref="HandlerPipeline"/>. Caller-shape validation
/// (empty IDs) lives in <see cref="StartJobCardValidator"/>;
/// job-card-existence + farm-membership authorization lives in
/// <see cref="StartJobCardAuthorizer"/>. When this handler is resolved
/// via the pipeline (see DI registration), both layers run before the
/// body executes; when resolved directly (legacy tests), the body's
/// inline guards continue to enforce the same invariants. The strict
/// "only the assigned worker may start" rule remains inside
/// <c>JobCard.Start</c> because it depends on the aggregate's current
/// state — surfaces as JobCardRoleNotAllowed via the body's
/// InvalidOperationException catch. Same-timestamp idempotency stays
/// in the body because it hinges on the aggregate's
/// <c>StartedAtUtc</c> snapshot.
/// </para>
/// </summary>
public sealed class StartJobCardHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<StartJobCardCommand, StartJobCardResult>
{
    public async Task<Result<StartJobCardResult>> HandleAsync(
        StartJobCardCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<StartJobCardResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Idempotency: if already InProgress and the caller is the assigned worker,
        //    return the existing StartedAtUtc (same-timestamp idempotency).
        if (jobCard.StartedAtUtc.HasValue && jobCard.AssignedWorkerUserId == command.CallerUserId)
            return Result.Success(new StartJobCardResult(jobCard.Id, jobCard.StartedAtUtc.Value));

        // 3. Delegate to domain — domain enforces the assigned-worker invariant.
        try
        {
            jobCard.Start(command.CallerUserId, clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            // Domain says "only the assigned worker may start" or wrong status.
            return Result.Failure<StartJobCardResult>(ShramSafalErrors.JobCardRoleNotAllowed);
        }

        // 4. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: jobCard.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.started",
                actorUserId: command.CallerUserId.Value,
                actorRole: "Worker",
                payload: new { jobCard.Id, StartedAtUtc = jobCard.StartedAtUtc },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new StartJobCardResult(jobCard.Id, jobCard.StartedAtUtc!.Value));
    }
}
