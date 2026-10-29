using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Compare;

/// <summary>
/// One piece of work the farmer RECORDED, on the farm-local day he said it was done
/// (<c>DailyLog.LogDate</c> — never the moment the phone sent it).
/// </summary>
public sealed record RecordedWork(
    string ActivityType,
    DateOnly WorkDate,
    ExecutionStatus Status = ExecutionStatus.Completed,
    bool Disputed = false);

/// <summary>Where one scheduled step stands today.</summary>
public enum ScheduledWorkState
{
    /// <summary>Recorded work was matched to it.</summary>
    Done = 0,
    /// <summary>Its day has passed and no recorded work matched it.</summary>
    Overdue = 1,
    /// <summary>Its day is today and no recorded work matched it yet.</summary>
    DueToday = 2,
}

/// <param name="DaysLate">0 for today's step; the days since its planned day otherwise.</param>
public sealed record ScheduledWorkStatus(PlannedActivity Planned, ScheduledWorkState State, int DaysLate);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I22) — founder D-1: "Before trusting its overdue
/// counts, fix how scheduled work is matched to completed records."
///
/// <para><b>What was wrong (GetAttentionBoardHandler before this).</b> One set of activity NAMES over every
/// recorded task of the cycle, any date: a single "Spray" recorded once cleared every planned "Spray" of the
/// season, and a planned "Foliar Spray" was never cleared by a recorded "Spray Mancozeb" because the names
/// differ. The first hid real late work; the second called done work late.</para>
///
/// <para><b>The rule now — one-to-one, by kind of work, by date.</b></para>
/// <list type="number">
/// <item>Only steps whose planned day has come (<c>PlannedDate &lt;= today</c>, farm-local India date) are
/// looked at; a future step can neither be late nor claim a record.</item>
/// <item>A record counts as work done when its status is not Skipped or Delayed (the same rule as
/// <see cref="CompareEngine"/>), its log is not disputed, it is not a mirrored note ("Reminder" /
/// "Observation"), and its day is not after today.</item>
/// <item>A record can meet a step only when it is the same kind of work
/// (<see cref="CompareEngine.Categorize"/>: spray / fertigation / irrigation); for the catch-all kind the names
/// must also match (<see cref="CompareEngine.FuzzyMatchActivity"/>), so weeding never clears pruning.</item>
/// <item><b>On time</b> (pass 1): a record within <see cref="OnTimeToleranceDays"/> days either side of the
/// planned day. Closest pairs are joined first, so a step recorded on its own day keeps its own record.</item>
/// <item><b>Late</b> (pass 2): a step still open takes the earliest unused record made AFTER its on-time
/// window — work recorded late is still work recorded.</item>
/// <item>Each record meets at most one step, and each step at most one record. Never by name alone across
/// the season.</item>
/// </list>
/// <para>A step not met is <see cref="ScheduledWorkState.Overdue"/> when its day has passed, or
/// <see cref="ScheduledWorkState.DueToday"/> when its day is today. Nothing is estimated: every state comes
/// from a planned row and the recorded rows (P4).</para>
/// </summary>
public static class ScheduledWorkMatcher
{
    /// <summary>A record up to this many days before or after the planned day is "on time".</summary>
    public const int OnTimeToleranceDays = 3;

    private static readonly string[] NoteTypes = ["reminder", "observation"];

    public static IReadOnlyList<ScheduledWorkStatus> Match(
        IEnumerable<PlannedActivity> planned,
        IEnumerable<RecordedWork> recorded,
        DateOnly today)
    {
        var due = planned
            .Where(p => !p.IsRemoved && !string.IsNullOrWhiteSpace(p.ActivityName) && p.PlannedDate <= today)
            .OrderBy(p => p.PlannedDate)
            .ThenBy(p => p.Id)
            .ToList();

        var work = recorded
            .Where(r => CountsAsDone(r) && r.WorkDate <= today)
            .OrderBy(r => r.WorkDate)
            .ToList();

        var stepTaken = new bool[due.Count];
        var recordTaken = new bool[work.Count];

        // Pass 1 — on time, closest pairs first (ties: the earlier step, then the earlier record).
        var pairs = new List<(int Step, int Record, int Distance)>();
        for (var s = 0; s < due.Count; s++)
        {
            for (var r = 0; r < work.Count; r++)
            {
                var distance = Math.Abs(work[r].WorkDate.DayNumber - due[s].PlannedDate.DayNumber);
                if (distance <= OnTimeToleranceDays && SameWork(due[s].ActivityName, work[r].ActivityType))
                {
                    pairs.Add((s, r, distance));
                }
            }
        }

        foreach (var (step, record, _) in pairs.OrderBy(p => p.Distance).ThenBy(p => p.Step).ThenBy(p => p.Record))
        {
            if (stepTaken[step] || recordTaken[record]) continue;
            stepTaken[step] = true;
            recordTaken[record] = true;
        }

        // Pass 2 — late: the earliest unused record made after the step's on-time window.
        for (var s = 0; s < due.Count; s++)
        {
            if (stepTaken[s]) continue;
            var lateFrom = due[s].PlannedDate.DayNumber + OnTimeToleranceDays;
            for (var r = 0; r < work.Count; r++)
            {
                if (recordTaken[r] || work[r].WorkDate.DayNumber <= lateFrom) continue;
                if (!SameWork(due[s].ActivityName, work[r].ActivityType)) continue;
                stepTaken[s] = true;
                recordTaken[r] = true;
                break;
            }
        }

        var result = new List<ScheduledWorkStatus>(due.Count);
        for (var s = 0; s < due.Count; s++)
        {
            var daysLate = today.DayNumber - due[s].PlannedDate.DayNumber;
            var state = stepTaken[s]
                ? ScheduledWorkState.Done
                : daysLate > 0 ? ScheduledWorkState.Overdue : ScheduledWorkState.DueToday;
            result.Add(new ScheduledWorkStatus(due[s], state, daysLate));
        }

        return result;
    }

    /// <summary>Is this recorded row work that was done (and not a note, a skip or a disputed record)?</summary>
    public static bool CountsAsDone(RecordedWork record)
    {
        if (record.Disputed) return false;
        if (record.Status is ExecutionStatus.Skipped or ExecutionStatus.Delayed) return false;
        if (string.IsNullOrWhiteSpace(record.ActivityType)) return false;
        var type = record.ActivityType.Trim().ToLowerInvariant();
        return !NoteTypes.Contains(type);
    }

    /// <summary>Same kind of work; for the catch-all kind, the names must match as well.</summary>
    public static bool SameWork(string plannedName, string recordedType)
    {
        var kind = CompareEngine.Categorize(plannedName);
        if (!string.Equals(kind, CompareEngine.Categorize(recordedType), StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return kind != "activity" || CompareEngine.FuzzyMatchActivity(plannedName, recordedType);
    }
}
