// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-26, D-79): audit rows follow the task's readers.
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// The audit trail of a task (entity type <c>PlannedWork</c>, payload exactly <c>{ PlannedWorkId, FarmId, Status, Step }</c>)
/// is shown to the people who may see the TASK, by the one rule of <see cref="PlannedWorkVisibility"/> - never to anyone else,
/// even a reader who may read the farm's whole trail. Everywhere data travels follows the reader's rights (D-26).
/// </summary>
public static class PlannedWorkAuditAccess
{
    /// <summary>The ids of the tasks of <paramref name="farmId"/> this person may see.</summary>
    public static async Task<HashSet<Guid>> VisibleTaskIdsAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        var seat = await PlannedWorkSeats.OfAsync(repository, farmId, userId, atUtc, ct);
        if (!seat.Active)
        {
            return [];
        }

        return (await repository.GetPlannedWorkChangedSinceAsync([farmId], DateTime.UnixEpoch, ct))
            .Where(w => (Guid)w.FarmId == farmId && PlannedWorkVisibility.VisiblePlots(seat, w) is not null)
            .Select(w => w.Id)
            .ToHashSet();
    }
}
