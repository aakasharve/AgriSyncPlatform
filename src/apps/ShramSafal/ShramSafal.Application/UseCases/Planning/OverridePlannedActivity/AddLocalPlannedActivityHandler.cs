using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
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
    : IHandler<AddLocalPlannedActivityCommand>
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

        // auth — the schedule gate's authority (PlanWork)
        // spec: plr-d10 lane L8b-1 (founder D-73) — planning work is the primary owner's, or a seat he gave
        // "कामाचं नियोजन करणे" (PlanWork); the label (मुकादम or above, the rule that stood here) grants nothing (D-26).
        if (!await Services.ScheduleChangeGate.MayChangeAsync(repository, command.FarmId, command.CallerUserId, clock.UtcNow, ct))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 lane MU-4 fix pass 1 (H1) — a seat on chosen plots writes only on his plots (REST and sync alike).
        if (await Services.PlotScopeGate.RefuseCycleAsync(
                repository, command.FarmId, command.CropCycleId, command.CallerUserId, clock.UtcNow, ct) is { } outsidePlots)
        {
            return Result.Failure(outsidePlots);
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
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        var audit = AuditEventFactory.Create(
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
            farmId: command.FarmId,
            clientCommandId: command.ClientCommandId,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

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
