// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c, D-26, D-79).
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
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
    internal static async Task<List<PlannedWorkDto>> VisibleAsync(
        IShramSafalRepository repository,
        IEnumerable<PlannedWork> changed,
        Guid readerUserId,
        IReadOnlyDictionary<Guid, FarmAccess?> accesses,
        DateTime serverNowUtc,
        PullAudience audience,
        CancellationToken ct)
    {
        var seen = new List<(PlannedWork Work, IReadOnlyList<Guid> Rows)>();
        foreach (var work in changed.DistinctBy(w => w.Id))
        {
            var farmId = (Guid)work.FarmId;
            var seat = PlannedWorkSeats.From(accesses.GetValueOrDefault(farmId), readerUserId, serverNowUtc);
            // Lane L8c-4: a task made from a log is no more visible than the log (a log hidden "फक्त मी" hides its tasks).
            var logHidden = PlannedWorkSourceLog.HiddenFrom(audience.Visibility, work);
            if (PlannedWorkVisibility.VisiblePlots(seat, work, logHidden) is { } rows)
            {
                seen.Add((work, rows));
            }
            else if (PlannedWorkVisibility.MustForget(seat, work)
                || (logHidden && PlannedWorkVisibility.VisiblePlots(seat, work) is not null))
            {
                // Taken from him by a reassign, or by the log's audience (the tasks of a log the owner hid): his phone is told,
                // content-free, to forget it - the same delivered-once rule as a withdrawn record.
                audience.Withdraw(RecordKinds.PlannedWork, work.Id, farmId, work.ModifiedAtUtc);
            }
        }

        // Lane L8c-3: each task carries the owner's word on the logs it was done with (read from the logs themselves, for every
        // linked log whether or not this reader may see it: one of three words about a task he already sees).
        var standing = await PlannedWorkConfirmations.LoadAsync(repository, seen.Select(x => x.Work), ct);
        return seen.Select(x => PlannedWorkDto.From(x.Work, x.Rows, standing)).ToList();
    }

    /// <summary>The cursor after these rows: at least where it was, and the newest change sent when that is later.</summary>
    internal static DateTime AdvanceCursor(DateTime cursor, IReadOnlyCollection<PlannedWorkDto> sent) =>
        sent.Count > 0 && sent.Max(w => w.ModifiedAtUtc) is var newest && newest > cursor ? newest : cursor;
}
