using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;

/// <summary>
/// Handler for <see cref="MarkOverdueInstancesCommand"/>. Loads all
/// <see cref="TestInstance"/> rows in <c>Due</c> with <c>PlannedDueDate &lt; today</c>,
/// calls <see cref="TestInstance.MarkOverdue"/> on each, and emits one
/// <see cref="AuditEvent"/> with action <c>test.overdue</c> per transition.
/// <para>
/// There is no human actor — the job runs as system. Audit events record
/// <see cref="SystemActorUserId"/> and <c>actorRole = "system"</c>.
/// </para>
/// </summary>
public sealed class MarkOverdueInstancesHandler(
    ITestInstanceRepository testInstanceRepository,
    IShramSafalRepository repository,
    IClock clock)
{
    /// <summary>
    /// Sentinel actor id used by background jobs for audit rows. The all-ones
    /// GUID is reserved (it will never collide with a real UserId because user
    /// ids are generated as v4 with bit-7 of byte-8 constrained).
    /// </summary>
    public static readonly Guid SystemActorUserId =
        new("ffffffff-ffff-ffff-ffff-ffffffffffff");

    public async Task<int> HandleAsync(
        MarkOverdueInstancesCommand command,
        CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var today = DateOnly.FromDateTime(now);

        var candidates = await testInstanceRepository.GetOverdueAsync(today, ct);
        if (candidates.Count == 0)
        {
            return 0;
        }

        var marked = 0;
        foreach (var instance in candidates)
        {
            var before = instance.Status;
            instance.MarkOverdue(now);

            // MarkOverdue is idempotent (no-op for non-Due states). Only emit
            // an audit row when we actually transitioned.
            if (before == TestInstanceStatus.Due && instance.Status == TestInstanceStatus.Overdue)
            {
                var audit = AuditEvent.Create(
                    farmId: instance.FarmId.Value,
                    entityType: "TestInstance",
                    entityId: instance.Id,
                    action: "test.overdue",
                    actorUserId: SystemActorUserId,
                    actorRole: "system",
                    payload: new
                    {
                        testInstanceId = instance.Id,
                        cropCycleId = instance.CropCycleId,
                        plotId = instance.PlotId,
                        stageName = instance.StageName,
                        plannedDueDate = instance.PlannedDueDate,
                        markedOverdueAtUtc = now
                    },
                    occurredAtUtc: now);

                await repository.AddAuditEventAsync(audit, ct);
                marked++;
            }
        }

        if (marked == 0)
        {
            return 0;
        }

        await testInstanceRepository.SaveChangesAsync(ct);
        await repository.SaveChangesAsync(ct);

        return marked;
    }
}
