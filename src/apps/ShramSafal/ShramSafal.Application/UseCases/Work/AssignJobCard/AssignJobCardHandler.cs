using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.AssignJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.2.
/// Assigns a JobCard to a farm worker.
/// Caller must be >= Mukadam. Worker must be an active member of the farm.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (AssignJobCard): wired through the
/// explicit <see cref="HandlerPipeline"/>. Caller-shape validation
/// (empty IDs) lives in <see cref="AssignJobCardValidator"/>;
/// job-card-existence + caller-role-tier (Mukadam-or-Owner)
/// authorization lives in <see cref="AssignJobCardAuthorizer"/>. When
/// this handler is resolved via the pipeline (see DI registration),
/// both layers run before the body executes; when resolved directly
/// (legacy tests), the body's inline guards continue to enforce the
/// same invariants. The worker-membership check
/// (<see cref="ShramSafalErrors.JobCardWorkerNotMember"/>) and the
/// domain state-machine check
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>) stay in the
/// body — they're either I/O against a different actor (the worker)
/// or aggregate-state invariants.
/// </para>
/// </summary>
public sealed class AssignJobCardHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<AssignJobCardCommand, AssignJobCardResult>
{
    public async Task<Result<AssignJobCardResult>> HandleAsync(
        AssignJobCardCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<AssignJobCardResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Resolve caller role — must be >= Mukadam.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<AssignJobCardResult>(ShramSafalErrors.Forbidden);

        if (!IsEligibleToAssign(callerRole.Value))
            return Result.Failure<AssignJobCardResult>(ShramSafalErrors.JobCardRoleNotAllowed);

        // 3. Verify the worker is an active member of the farm.
        var workerMembership = await repository.GetFarmMembershipAsync(
            jobCard.FarmId.Value, command.WorkerUserId.Value, ct);

        if (workerMembership is null)
            return Result.Failure<AssignJobCardResult>(ShramSafalErrors.JobCardWorkerNotMember);

        // 4. Assign via domain method.
        try
        {
            jobCard.Assign(command.WorkerUserId, command.CallerUserId, callerRole.Value, clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<AssignJobCardResult>(ShramSafalErrors.JobCardInvalidState);
        }

        // 5. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: jobCard.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.assigned",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, WorkerUserId = command.WorkerUserId.Value },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new AssignJobCardResult(jobCard.Id));
    }

    private static bool IsEligibleToAssign(AppRole role) =>
        role is AppRole.Mukadam or AppRole.PrimaryOwner or AppRole.SecondaryOwner;
}
