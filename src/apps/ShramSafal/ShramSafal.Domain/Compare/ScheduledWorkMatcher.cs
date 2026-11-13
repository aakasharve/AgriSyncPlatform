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
/// spec: plr-d10 lane ATT-W (R29, R35) - one dated step a followed schedule STORES, as the attention board matches it. <see cref="PlannedDate"/>
/// is the day लक्ष द्या reminds (the schedule's own day, or the day a person moved it to). <see cref="Part"/>, <see cref="OperationKey"/>,
/// <see cref="Role"/>, <see cref="NutrientKey"/> and <see cref="OnceOnly"/> come from the engine's <c>ExpectedStep</c> (<c>OnceOnly</c> only for a
/// STORED one-time work); <see cref="StageFrom"/> / <see cref="StageTo"/> are the dates of the मुख्य schedule's stage that holds the step's own day
/// (null when it stores none).
/// </summary>
public sealed record ScheduledStep(
    Guid StepId,
    string ActivityName,
    DateOnly PlannedDate,
    string Part,
    string? OperationKey,
    string? Role,
    string? NutrientKey,
    bool OnceOnly,
    DateOnly? StageFrom,
    DateOnly? StageTo);

/// <summary>Where one <see cref="ScheduledStep"/> stands today (the planned-activity rule's own states).</summary>
public sealed record ScheduledStepStatus(ScheduledStep Step, ScheduledWorkState State, int DaysLate);

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
/// <item>A record can meet a step only when it is the same work (<see cref="WorkRecogniser"/>: the same part, the same
/// operation for farm work, and the same ROLE for a spray or fertiliser — a fungicide spray never clears an
/// insecticide line), whichever language either was said in. Words nobody can recognise meet only by their own
/// names (<see cref="CompareEngine.FuzzyMatchActivity"/>), so weeding never clears pruning.</item>
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

        var work = DoneWork(recorded, today);
        var taken = Core(
            due.Select(p => p.PlannedDate).ToList(),
            work,
            (s, r) => SameWork(due[s].ActivityName, work[r].ActivityType),
            onceOnly: null);

        var result = new List<ScheduledWorkStatus>(due.Count);
        for (var s = 0; s < due.Count; s++)
        {
            var daysLate = today.DayNumber - due[s].PlannedDate.DayNumber;
            result.Add(new ScheduledWorkStatus(due[s], StateOf(taken[s], daysLate), daysLate));
        }

        return result;
    }

    /// <summary>
    /// spec: plr-d10 lane ATT-W (R29, R35) - the SAME rule over the steps a followed schedule STORES (<see cref="ScheduleFollowEngine.Expand"/>
    /// dates, a moved step on its moved day), so लक्ष द्या, the stage panel and तुलना have one "expected". Passes 1 and 2 are the rule above,
    /// asked of the step's work identity (what the schedule stores overrules its title, <see cref="IdentityOf"/>). Then, with one change for
    /// followed schedules (R35): a ONCE-ONLY step still open takes an unused same-work record inside its own stage window, before or after
    /// its day, so लक्ष द्या never reminds work तुलना already counts. That third pass runs AFTER the two, so it can never take a record an
    /// on-time or late step needed. Same work there means the part, the operation key and the role - never the name alone. Repeated steps
    /// keep the three-day rule. A step whose day has not come is neither late nor able to claim a record. The caller matches each
    /// followed schedule's steps on their own.
    /// </summary>
    public static IReadOnlyList<ScheduledStepStatus> Match(
        IEnumerable<ScheduledStep> steps,
        IEnumerable<RecordedWork> recorded,
        DateOnly today)
    {
        var due = steps
            .Where(s => !string.IsNullOrWhiteSpace(s.ActivityName) && s.PlannedDate <= today)
            .OrderBy(s => s.PlannedDate)
            .ThenBy(s => s.StepId)
            .ToList();

        var work = DoneWork(recorded, today);
        var stepIdentity = due.Select(IdentityOf).ToList();
        var recordIdentity = work.Select(r => WorkRecogniser.Recognise(r.ActivityType)).ToList();

        var taken = Core(
            due.Select(s => s.PlannedDate).ToList(),
            work,
            (s, r) => SameStepWork(due[s], stepIdentity[s], work[r], recordIdentity[r]),
            new OnceOnlyPass(
                due.Select(s => s.OnceOnly).ToList(),
                due.Select(s => (From: s.StageFrom, To: s.StageTo)).ToList(),
                (s, r) => SameKeyedWork(stepIdentity[s], recordIdentity[r])));

        var result = new List<ScheduledStepStatus>(due.Count);
        for (var s = 0; s < due.Count; s++)
        {
            var daysLate = today.DayNumber - due[s].PlannedDate.DayNumber;
            result.Add(new ScheduledStepStatus(due[s], StateOf(taken[s], daysLate), daysLate));
        }

        return result;
    }

    /// <summary>The identity of a scheduled step: its title read by <see cref="WorkRecogniser"/>, overruled by what the schedule stores (the engine's own rule).</summary>
    public static WorkIdentity? IdentityOf(ScheduledStep step) =>
        ScheduleFollowEngine.IdentityOf(step.ActivityName, step.Part, step.OperationKey, step.Role, step.NutrientKey);

    /// <summary>
    /// The day of the latest recorded work that is the same work as <paramref name="step"/> (WORK-ID <c>Same</c>) on or before
    /// <paramref name="today"/>; <c>null</c> when there is none. Only rows that count as done (<see cref="CountsAsDone"/>) are read, and the
    /// caller hands in only the records the READER may see, so the answer never names a day a hidden record was made on (PRV). Nothing is
    /// estimated (P4).
    /// </summary>
    public static DateOnly? LastSameWorkDate(ScheduledStep step, IEnumerable<RecordedWork> visibleRecorded, DateOnly today)
    {
        var identity = IdentityOf(step);
        DateOnly? last = null;
        foreach (var record in DoneWork(visibleRecorded, today))
        {
            if (last is { } known && record.WorkDate <= known)
            {
                continue;
            }

            if (SameStepWork(step, identity, record, WorkRecogniser.Recognise(record.ActivityType)))
            {
                last = record.WorkDate;
            }
        }

        return last;
    }

    /// <summary>Are two steps the same work (WORK-ID <c>Same</c> on their identities; a step nothing can read is the same only as its own name)?</summary>
    public static bool SameStepWork(ScheduledStep a, ScheduledStep b)
    {
        var ia = IdentityOf(a);
        var ib = IdentityOf(b);
        return ia is not null && ib is not null
            ? WorkRecogniser.Same(ia, ib).Matched
            : string.Equals(a.ActivityName.Trim(), b.ActivityName.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static List<RecordedWork> DoneWork(IEnumerable<RecordedWork> recorded, DateOnly today) =>
        recorded
            .Where(r => CountsAsDone(r) && r.WorkDate <= today)
            .OrderBy(r => r.WorkDate)
            .ToList();

    private static ScheduledWorkState StateOf(bool taken, int daysLate) =>
        taken ? ScheduledWorkState.Done : daysLate > 0 ? ScheduledWorkState.Overdue : ScheduledWorkState.DueToday;

    /// <summary>Passes 1 and 2 as the planned-activity rule's own: same work by the step's identity, else (nothing to read) by the old name rule.</summary>
    private static bool SameStepWork(ScheduledStep step, WorkIdentity? stepIdentity, RecordedWork record, WorkIdentity? recordIdentity) =>
        stepIdentity is not null && recordIdentity is not null
            ? WorkRecogniser.Same(stepIdentity, recordIdentity).Matched
            : SameWork(step.ActivityName, record.ActivityType);

    /// <summary>
    /// The once-only pass's "same work": both read, the same part, the same role (a nutrient also the same nutrient) or the same operation key.
    /// A match that rests on the names alone (<c>same-name</c>) is never enough (R35).
    /// </summary>
    private static bool SameKeyedWork(WorkIdentity? step, WorkIdentity? record)
    {
        if (step is null || record is null)
        {
            return false;
        }

        var same = WorkRecogniser.Same(step, record);
        return same.Matched && !string.Equals(same.ReasonKey, "same-name", StringComparison.Ordinal);
    }

    private sealed record OnceOnlyPass(
        IReadOnlyList<bool> OnceOnly,
        IReadOnlyList<(DateOnly? From, DateOnly? To)> Windows,
        Func<int, int, bool> SameKeyed);

    /// <summary>
    /// The ONE matching body both overloads share: pass 1 (on time, closest pairs first), pass 2 (late), and - for steps only - the
    /// once-only pass (R35). <paramref name="stepDays"/> and <paramref name="work"/> are already in their matching order.
    /// </summary>
    private static bool[] Core(
        IReadOnlyList<DateOnly> stepDays,
        IReadOnlyList<RecordedWork> work,
        Func<int, int, bool> same,
        OnceOnlyPass? onceOnly)
    {
        var stepTaken = new bool[stepDays.Count];
        var recordTaken = new bool[work.Count];

        // Pass 1 - on time, closest pairs first (ties: the earlier step, then the earlier record).
        var pairs = new List<(int Step, int Record, int Distance)>();
        for (var s = 0; s < stepDays.Count; s++)
        {
            for (var r = 0; r < work.Count; r++)
            {
                var distance = Math.Abs(work[r].WorkDate.DayNumber - stepDays[s].DayNumber);
                if (distance <= OnTimeToleranceDays && same(s, r))
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

        // Pass 2 - late: the earliest unused record made after the step's on-time window.
        for (var s = 0; s < stepDays.Count; s++)
        {
            if (stepTaken[s]) continue;
            var lateFrom = stepDays[s].DayNumber + OnTimeToleranceDays;
            for (var r = 0; r < work.Count; r++)
            {
                if (recordTaken[r] || work[r].WorkDate.DayNumber <= lateFrom) continue;
                if (!same(s, r)) continue;
                stepTaken[s] = true;
                recordTaken[r] = true;
                break;
            }
        }

        // Pass 3 (steps only, R35) - a ONCE-ONLY step still open takes the earliest unused same-work record inside its own stage window,
        // before or after its day. After passes 1 and 2, so it never takes a record an on-time or late step needed.
        if (onceOnly is not null)
        {
            for (var s = 0; s < stepDays.Count; s++)
            {
                if (stepTaken[s] || !onceOnly.OnceOnly[s]) continue;
                var (windowFrom, windowTo) = onceOnly.Windows[s];
                if (windowFrom is not { } first || windowTo is not { } last) continue;
                for (var r = 0; r < work.Count; r++)
                {
                    if (recordTaken[r] || work[r].WorkDate < first || work[r].WorkDate > last) continue;
                    if (!onceOnly.SameKeyed(s, r)) continue;
                    stepTaken[s] = true;
                    recordTaken[r] = true;
                    break;
                }
            }
        }

        return stepTaken;
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

    /// <summary>
    /// Same work, said in either language (D-77, D-104a). Asks <see cref="WorkRecogniser"/>, the one place the server decides
    /// sameness, so लक्ष द्या and तुलना agree. Words nobody can recognise are never guessed at (R12): they meet only by the
    /// old rule, their own names.
    /// </summary>
    public static bool SameWork(string plannedName, string recordedType) =>
        WorkRecogniser.SameWork(plannedName, recordedType).Matched;
}
