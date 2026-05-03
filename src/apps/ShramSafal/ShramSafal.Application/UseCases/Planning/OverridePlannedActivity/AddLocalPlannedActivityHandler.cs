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

/// <summary>
/// Adds a locally-created planned activity (not derived from a template)
/// to a crop cycle, with an audit trail.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLocalPlannedActivity): wired through
/// the explicit <see cref="HandlerPipeline"/>. Caller-shape validation
/// lives in <see cref="AddLocalPlannedActivityValidator"/>; Mukadam-tier
/// authorization lives in <see cref="AddLocalPlannedActivityAuthorizer"/>.
/// When this handler is resolved via the pipeline (see DI registration),
/// both layers run before the body executes; when resolved directly
/// (legacy tests + the PushSyncBatch dispatch — currently unimplemented
/// for plan.add), the body's defense-in-depth gates continue to enforce
/// the same invariants verbatim.
/// </para>
///
/// <para>
/// PushSync decision: <c>plan.add</c> is registered in the sync
/// mutation catalog but its dispatch case in
/// <c>PushSyncBatchHandler.ExecuteMutationAsync</c> returns
/// <c>MutationTypeUnimplementedCode</c> (Sub-plan 03 follow-up). No
/// sync integration test exercises an end-to-end plan.add; the
/// "only-with-tests" guardrail therefore keeps this rollout endpoint-
/// only — there is no <c>PushSyncBatchHandler</c> ctor change.
/// </para>
/// </summary>
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
