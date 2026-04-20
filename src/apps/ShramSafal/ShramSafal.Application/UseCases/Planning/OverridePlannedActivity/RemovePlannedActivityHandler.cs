using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed class RemovePlannedActivityHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
{
    private const string MutationType = "plan.remove";

    public async Task<Result> HandleAsync(
        RemovePlannedActivityCommand command,
        CancellationToken ct = default)
    {
        // Step 1: validate
        if (command.PlannedActivityId == Guid.Empty ||
            command.FarmId == Guid.Empty ||
            command.CallerUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Reason))
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        // Step 2: idempotency check
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            var existing = await syncMutationStore.GetAsync(
                command.ClientCommandId, command.ClientCommandId, ct);
            if (existing is not null)
            {
                return Result.Success();
            }
        }

        // Step 3: load planned activity
        var activity = await repository.GetPlannedActivityByIdAsync(command.PlannedActivityId, ct);
        if (activity is null)
        {
            return Result.Failure(ShramSafalErrors.PlannedActivityNotFound);
        }

        // Step 4: auth — Mukadam+ required
        var role = await repository.GetUserRoleForFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (role is null || role < AppRole.Mukadam)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // Step 5 & 6: soft-remove (consistent for both locally-added and template-derived)
        activity.SoftRemove(new UserId(command.CallerUserId), command.Reason, clock.UtcNow);

        // Step 7: audit event
        var audit = AuditEvent.Create(
            farmId: command.FarmId,
            entityType: "PlannedActivity",
            entityId: command.PlannedActivityId,
            action: "plan.removed",
            actorUserId: command.CallerUserId,
            actorRole: "user",
            payload: new
            {
                reason = command.Reason,
                wasLocallyAdded = activity.IsLocallyAdded
            },
            clientCommandId: command.ClientCommandId,
            occurredAtUtc: clock.UtcNow);

        await repository.AddAuditEventAsync(audit, ct);

        // Step 8: save
        await repository.SaveChangesAsync(ct);

        // Step 9: store idempotency result
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            await syncMutationStore.TryStoreSuccessAsync(
                command.ClientCommandId,
                command.ClientCommandId,
                MutationType,
                JsonSerializer.Serialize(new { success = true }),
                clock.UtcNow,
                ct);
        }

        return Result.Success();
    }
}
