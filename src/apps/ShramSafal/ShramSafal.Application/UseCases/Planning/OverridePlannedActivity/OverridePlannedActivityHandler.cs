using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// Overrides a planned activity (date shift / rename / restage) with an
/// audit trail.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (OverridePlannedActivity): wired through the
/// explicit <see cref="HandlerPipeline"/>. Caller-shape validation lives
/// in <see cref="OverridePlannedActivityValidator"/>; planned-activity
/// existence + Mukadam-tier authorization lives in
/// <see cref="OverridePlannedActivityAuthorizer"/>. When this handler is
/// resolved via the pipeline (see DI registration), both layers run
/// before the body executes; when resolved directly (legacy tests + the
/// PushSyncBatch dispatch — currently unimplemented for plan.override),
/// the body's defense-in-depth gates continue to enforce the same
/// invariants verbatim.
/// </para>
///
/// <para>
/// PushSync decision: <c>plan.override</c> is registered in the sync
/// mutation catalog but its dispatch case in
/// <c>PushSyncBatchHandler.ExecuteMutationAsync</c> returns
/// <c>MutationTypeUnimplementedCode</c> (Sub-plan 03 follow-up). No
/// sync integration test exercises an end-to-end plan.override; the
/// "only-with-tests" guardrail therefore keeps this rollout endpoint-
/// only — there is no <c>PushSyncBatchHandler</c> ctor change.
/// </para>
/// </summary>
public sealed class OverridePlannedActivityHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
    : IHandler<OverridePlannedActivityCommand>
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
