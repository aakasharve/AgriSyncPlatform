using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed class OverridePlannedActivityHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
{
    private const string MutationType = "plan.override";

    public async Task<Result> HandleAsync(
        OverridePlannedActivityCommand command,
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
        if (activity is null || activity.IsRemoved)
        {
            return Result.Failure(ShramSafalErrors.PlannedActivityNotFound);
        }

        // Step 4: auth — Mukadam+ required
        var role = await repository.GetUserRoleForFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (role is null || role < AppRole.Mukadam)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // Step 5: apply override
        activity.Override(
            command.NewPlannedDate,
            command.NewActivityName,
            command.NewStage,
            new UserId(command.CallerUserId),
            command.Reason,
            clock.UtcNow);

        // Step 6: audit event
        var fieldsChanged = new List<string>();
        if (command.NewPlannedDate.HasValue) fieldsChanged.Add("plannedDate");
        if (!string.IsNullOrWhiteSpace(command.NewActivityName)) fieldsChanged.Add("activityName");
        if (!string.IsNullOrWhiteSpace(command.NewStage)) fieldsChanged.Add("stage");

        var audit = AuditEvent.Create(
            farmId: command.FarmId,
            entityType: "PlannedActivity",
            entityId: command.PlannedActivityId,
            action: "plan.overridden",
            actorUserId: command.CallerUserId,
            actorRole: "user",
            payload: new
            {
                fieldsChanged = fieldsChanged.ToArray(),
                reason = command.Reason
            },
            clientCommandId: command.ClientCommandId,
            occurredAtUtc: clock.UtcNow);

        await repository.AddAuditEventAsync(audit, ct);

        // Step 7: save
        await repository.SaveChangesAsync(ct);

        // Step 8: store idempotency result
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
