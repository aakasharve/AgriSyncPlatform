using AgriSync.BuildingBlocks.Abstractions;
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
/// </summary>
public sealed class AssignJobCardHandler(
    IShramSafalRepository repository,
    IClock clock)
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
