using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed class AddLocalPlannedActivityHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
{
    private const string MutationType = "plan.add";

    public async Task<Result> HandleAsync(
        AddLocalPlannedActivityCommand command,
        CancellationToken ct = default)
    {
        // Step 1: validate
        if (command.NewActivityId == Guid.Empty ||
            command.CropCycleId == Guid.Empty ||
            command.FarmId == Guid.Empty ||
            command.CallerUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.ActivityName) ||
            string.IsNullOrWhiteSpace(command.Stage) ||
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

        // Step 3: auth — Mukadam+ required
        var role = await repository.GetUserRoleForFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (role is null || role < AppRole.Mukadam)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // Step 4: create locally-added activity
        var activity = PlannedActivity.CreateLocallyAdded(
            command.NewActivityId,
            command.CropCycleId,
            command.ActivityName,
            command.Stage,
            command.PlannedDate,
            new UserId(command.CallerUserId),
            command.Reason,
            clock.UtcNow);

        // Step 5: persist
        await repository.AddPlannedActivitiesAsync([activity], ct);

        // Step 6: audit event
        var audit = AuditEvent.Create(
            farmId: command.FarmId,
            entityType: "PlannedActivity",
            entityId: command.NewActivityId,
            action: "plan.added",
            actorUserId: command.CallerUserId,
            actorRole: "user",
            payload: new
            {
                activityName = command.ActivityName,
                stage = command.Stage,
                plannedDate = command.PlannedDate.ToString("yyyy-MM-dd"),
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
