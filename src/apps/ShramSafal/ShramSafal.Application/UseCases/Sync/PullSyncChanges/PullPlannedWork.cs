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
        var tasks = changed.DistinctBy(w => w.Id).ToList();
        // Lane REM-1: the owner's settings of the farms these tasks belong to (a farm with no row has the defaults, D-79).
        var audiences = await repository.GetReminderAudiencesAsync(tasks.Select(w => (Guid)w.FarmId).Distinct().ToList(), ct);
        foreach (var work in tasks)
        {
            var farmId = (Guid)work.FarmId;
            var seat = PlannedWorkSeats.From(accesses.GetValueOrDefault(farmId), readerUserId, serverNowUtc);
            var set = audiences.GetValueOrDefault(farmId) ?? ReminderAudiences.Defaults(farmId);
            // Lane L8c-4: a task made from a log is no more visible than the log (a log hidden "फक्त मी" hides its tasks).
            var logHidden = PlannedWorkSourceLog.HiddenFrom(audience.Visibility, work);
            if (ReminderVisibility.VisiblePlots(seat, work, set.Settings, set.AlwaysShow, logHidden) is { } rows)
            {
                seen.Add((work, rows));
            }
            else if (PlannedWorkVisibility.MustForget(seat, work)
                || (logHidden && PlannedWorkVisibility.VisiblePlots(seat, work) is not null))
            {
                // Taken from him by a reassign, or by the log's audience (the tasks of a log the owner hid; the base's readers, as before
                // REM-1): his phone is told, content-free, to forget it - the same delivered-once rule as a withdrawn record.
                audience.Withdraw(RecordKinds.PlannedWork, work.Id, farmId, work.ModifiedAtUtc);
            }
            else if (logHidden
                && work.SourceDailyLogId is { } hiddenLog
                && audience.Visibility.Restricted(RecordKinds.DailyLog, hiddenLog)?.AudienceChangedAtUtc is { } logChangedAt
                && ReminderVisibility.Widened(seat, work, set.Settings, set.AlwaysShow, sourceLogHidden: false) is not null)
            {
                // Lane REM-1 fix round (review M2 b): a reader the owner's settings put on the reminder (plot team, or its maker marked)
                // is told to forget it when its log is kept from him - ONCE, by the time the log's audience changed, never again by a later
                // edit of the reminder; and only a reader the CURRENT settings would have let hold it.
                audience.Withdraw(RecordKinds.PlannedWork, work.Id, farmId, logChangedAt);
            }
            else if (ReminderVisibility.MustForget(seat, work, logHidden))
            {
                // Lane REM-1 fix round (review M1, M2): a reminder that left the widening (a settings change, given to someone else, moved to
                // other plots) is named to a reader who could have held it, by the time of THAT change - so once per reader: a pull whose
                // cursor is past it names nothing, and a later edit of the reminder names nobody again. Never a reader its log is kept from.
                audience.Withdraw(RecordKinds.PlannedWork, work.Id, farmId, work.ReminderAudienceChangedAtUtc!.Value);
            }
        }

        // Lane L8c-3: each task carries the owner's word on the logs it was done with (read from the logs themselves, for every
        // linked log whether or not this reader may see it: one of three words about a task he already sees).
        var standing = await PlannedWorkConfirmations.LoadAsync(repository, seen.Select(x => x.Work), ct);
        // Lane REM-1: who made each one, which source, whether he may hear its voice, whether its words are withheld by the money rule.
        var looks = await ReminderLooks.LoadAsync(
            repository, seen.Select(x => x.Work).ToList(), readerUserId, serverNowUtc, accesses, audience.Visibility, audiences, ct);
        return seen.Select(x => PlannedWorkDto.From(x.Work, x.Rows, standing, looks(x.Work))).ToList();
    }

    /// <summary>The cursor after these rows: at least where it was, and the newest change sent when that is later.</summary>
    internal static DateTime AdvanceCursor(DateTime cursor, IReadOnlyCollection<PlannedWorkDto> sent) =>
        sent.Count > 0 && sent.Max(w => w.ModifiedAtUtc) is var newest && newest > cursor ? newest : cursor;
}
