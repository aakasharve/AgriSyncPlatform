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
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Owner/Mukadam-initiated; no AI job correlation.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.assigned",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, WorkerUserId = command.WorkerUserId.Value },
                farmId: jobCard.FarmId.Value,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new AssignJobCardResult(jobCard.Id));
    }

    private static bool IsEligibleToAssign(AppRole role) =>
        role is AppRole.Mukadam or AppRole.PrimaryOwner or AppRole.SecondaryOwner;
}
