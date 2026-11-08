// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-3 (founder D-24d): the owner's word on the logs a task was done with.
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// Reads the standing of the logs a task (or one of its plot rows) was done with, for <c>ConfirmationState</c>. Computed from
/// ALL linked logs whether or not the reader may see those logs: it exposes one of three words (Confirmed, Disputed,
/// Waiting) about a task he already sees, never the log (CTO ruling, lane L8c-3). Read-only, one bounded query per farm.
/// </summary>
public static class PlannedWorkConfirmations
{
    /// <summary>A function from a log id to its current standing (<c>null</c> = not found), for the tasks given.</summary>
    public static async Task<Func<Guid, VerificationStatus?>> LoadAsync(
        IShramSafalRepository repository, IEnumerable<PlannedWork> works, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(works);
        var standing = new Dictionary<Guid, VerificationStatus>();
        foreach (var farm in works.GroupBy(w => (Guid)w.FarmId))
        {
            var ids = farm
                .SelectMany(w => w.LinkedDailyLogIds.Concat(w.Plots.SelectMany(p => p.LinkedDailyLogIds)))
                .Distinct()
                .ToList();
            if (ids.Count == 0)
            {
                continue;
            }

            foreach (var log in await repository.GetDailyLogsForFarmByIdsAsync(new AgriSync.SharedKernel.Contracts.Ids.FarmId(farm.Key), ids, ct))
            {
                standing[log.Id] = log.CurrentVerificationStatus;
            }
        }

        return id => standing.TryGetValue(id, out var status) ? status : null;
    }

    /// <summary>
    /// Fix round 1 (L003): a log's standing changed (the owner confirmed or doubted it, a correction or a new line took it back to
    /// Draft). Every task that links the log is moved past every phone's cursor - the clock and nothing else, never the status or
    /// the plots of the task - so the next pull resends it with the word the log now deserves. Stages the change on the tracked
    /// tasks; the caller's own save stores it with the change that caused it. ONE place, called by every door that can change a
    /// log's standing.
    /// </summary>
    public static async Task NoteLogStandingChangedAsync(
        IShramSafalRepository repository, DailyLog log, DateTime nowUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        foreach (var linked in await repository.GetPlannedWorkLinkingLogAsync((Guid)log.FarmId, log.Id, ct))
        {
            linked.NoteLinkedLogChanged(nowUtc);
        }
    }
}
