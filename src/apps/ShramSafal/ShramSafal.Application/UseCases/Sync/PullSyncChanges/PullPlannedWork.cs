// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c, D-26, D-79).
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// The pull's <c>plannedWork</c> key: the tasks and reminders of the farms he reads, changed since his cursor, AS HE MAY SEE
/// THEM - the one rule of <see cref="PlannedWorkVisibility"/> (the maker, the assignee, the primary owner, a holder of
/// SeeAllTasks; a chosen-plots seat only his plots' rows). A task taken from him (a reassign) is named, kind + id and nothing
/// else, in the withdrawn list under <see cref="RecordKinds.PlannedWork"/> (the same delivered-once rule as PRV's: the cursor
/// passes the change's whole second). A task he never held is never named. A task moves no plot's or season's clock, so its
/// own <c>modified_at_utc</c> carries the cursor.
/// </summary>
internal static class PullPlannedWork
{
    /// <summary>The tasks this reader sees (with only his plot rows); the ones taken from him go to <paramref name="audience"/>.</summary>
    internal static List<PlannedWorkDto> Visible(
        IEnumerable<PlannedWork> changed,
        Guid readerUserId,
        IReadOnlyDictionary<Guid, FarmAccess?> accesses,
        DateTime serverNowUtc,
        PullAudience audience)
    {
        var sent = new List<PlannedWorkDto>();
        foreach (var work in changed.DistinctBy(w => w.Id))
        {
            var farmId = (Guid)work.FarmId;
            var seat = PlannedWorkSeats.From(accesses.GetValueOrDefault(farmId), readerUserId, serverNowUtc);
            if (PlannedWorkVisibility.VisiblePlots(seat, work) is { } rows)
            {
                sent.Add(PlannedWorkDto.From(work, rows));
            }
            else if (PlannedWorkVisibility.MustForget(seat, work))
            {
                audience.Withdraw(RecordKinds.PlannedWork, work.Id, farmId, work.ModifiedAtUtc);
            }
        }

        return sent;
    }

    /// <summary>The cursor after these rows: at least where it was, and the newest change sent when that is later.</summary>
    internal static DateTime AdvanceCursor(DateTime cursor, IReadOnlyCollection<PlannedWorkDto> sent) =>
        sent.Count > 0 && sent.Max(w => w.ModifiedAtUtc) is var newest && newest > cursor ? newest : cursor;
}
