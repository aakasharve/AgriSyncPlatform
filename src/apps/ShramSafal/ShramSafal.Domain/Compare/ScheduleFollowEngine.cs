using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-E; D-86 note, D-100, D-104 a-e; R28, R33, R34, R35)

/// <summary>
/// The one schedule engine: expected dates and per-stage counts from the days a schedule STORES. The stage panel,
/// the comparison and the attention board all read <see cref="Expand"/> / <see cref="StagePlan"/>, so they cannot
/// disagree (Review Focus 11). No quantity appears in any output and no number the rows cannot explain (P4).
/// Pure: no clock, no database.
///
/// <para><b>R33 placement order (per schedule, per window, no day compared).</b> Records that count as done
/// (<see cref="ScheduledWorkMatcher.CountsAsDone"/>) and were made inside the window and not after today are placed
/// one-to-one: first every KEYED record (it carries a role, or it is farm work with an operation key), then every GENERIC
/// record (a spray with no role). Both go to a same-work line (<see cref="WorkRecogniser.Same"/>) with the most dates still
/// unmatched; ties go to the line whose next unmatched stored day is earliest, then to the lower activity id. A line
/// with no stored days takes what the stored lines have no room for. Same-work records with no room are
/// "more than asked" on the first same-work line by activity id. <c>OnTimeToleranceDays</c> is never read.</para>
/// </summary>
public static class ScheduleFollowEngine
{
    public static IReadOnlyList<ExpectedStep> Expand(ScheduleDefinition schedule, DateOnly dayZero)
    {
        var steps = new List<ExpectedStep>();
        foreach (var activity in schedule.Activities)
        {
            foreach (var date in StoredDates(activity, dayZero))
            {
                steps.Add(new ExpectedStep(
                    activity.ActivityId,
                    activity.Part!,
                    activity.OperationKey,
                    activity.Title,
                    date,
                    activity.FrequencyMode == FrequencyMode.OneTime,
                    activity.Role,
                    activity.NutrientKey));
            }
        }

        return steps
            .OrderBy(s => s.Date)
            .ThenBy(s => s.ActivityId)
            .ToList();
    }

    public static IReadOnlyList<StageWindow> StageWindows(ScheduleDefinition main, DateOnly mainDayZero) =>
        main.Stages
            .OrderBy(s => s.StartDay)
            .ThenBy(s => s.EndDay)
            .Select(s => new StageWindow(s.Name, mainDayZero.AddDays(s.StartDay), mainDayZero.AddDays(s.EndDay)))
            .ToList();

    public static IReadOnlyList<StageActivityPlan> StagePlan(ScheduleDefinition schedule, DateOnly dayZero, StageWindow window)
    {
        var plan = new List<StageActivityPlan>();
        foreach (var activity in schedule.Activities)
        {
            if (activity.StageUnknown)
            {
                continue; // slice 6: a work with no day, no expectation and no stage sits in no window
            }

            if (HasStoredDays(activity))
            {
                var dates = StoredDates(activity, dayZero).Where(d => d >= window.From && d <= window.To).ToList();
                if (dates.Count == 0)
                {
                    continue;
                }

                plan.Add(new StageActivityPlan(
                    activity.ActivityId, activity.Part!, activity.Title, activity.OperationKey,
                    activity.FrequencyMode, activity.IntervalDays, dates, dates.Count, activity.AfterActivityId, activity.TaskKey));
            }
            else
            {
                var start = dayZero.AddDays(activity.StartDay);
                if (start >= window.From && start <= window.To)
                {
                    plan.Add(new StageActivityPlan(
                        activity.ActivityId, activity.Part ?? string.Empty, activity.Title, activity.OperationKey,
                        activity.FrequencyMode, activity.IntervalDays, null, null, activity.AfterActivityId, activity.TaskKey));
                }
            }
        }

        return plan;
    }

    public static PlotFollowResult Follow(
        IReadOnlyList<FollowedSchedule> followed,
        IReadOnlyList<StageWindow> windows,
        IReadOnlyList<RecordedWork> recorded,
        DateOnly today,
        StageWindow? only)
    {
        var records = recorded.Select((r, i) => new Rec(i, r, WorkRecogniser.Recognise(r.ActivityType))).ToList();
        var counted = windows.Where(w => only is null || (w.Name == only.Name && w.From == only.From && w.To == only.To)).ToList();

        var perSchedule = followed.Select(_ => new List<StageCount>()).ToList();
        var own = new List<OwnWorkItem>();
        var notRecognised = new List<NotRecognisedItem>();

        // slice 6: where each LINKED record counts, per schedule - the window that holds the line of its work (by key): the one holding the record's own day
        // when the line is there too, else the earliest window with that line. Once per schedule, never in two windows (a repeating line spans several).
        var linkedRecords = records
            .Where(r => r.Work.ForTaskKey is not null && r.Work.WorkDate <= today && ScheduledWorkMatcher.CountsAsDone(r.Work))
            .ToList();
        var linkTarget = followed.Select(f => LinkTargets(f, counted, linkedRecords)).ToList();

        for (var w = 0; w < counted.Count; w++)
        {
            var window = counted[w];
            var state = window.To < today ? StageState.Passed : window.From <= today ? StageState.Current : StageState.Ahead;
            int? daysLeft = state == StageState.Current ? window.To.DayNumber - today.DayNumber : null;

            var inWindow = records
                .Where(r => r.Work.WorkDate >= window.From && r.Work.WorkDate <= window.To && r.Work.WorkDate <= today)
                .ToList();
            var done = state == StageState.Ahead
                ? new List<Rec>()
                : inWindow.Where(r => ScheduledWorkMatcher.CountsAsDone(r.Work)).ToList();
            var said = state == StageState.Ahead
                ? new List<Rec>()
                : inWindow.Where(r => IsSaidNotDone(r.Work)).ToList();

            var anyLineAsks = new bool[records.Count];
            for (var s = 0; s < followed.Count; s++)
            {
                var f = followed[s];
                var lines = StagePlan(f.Schedule, f.DayZero, window)
                    .Select(p => new Line(p, IdentityOf(f.Schedule, p.ActivityId)))
                    .ToList();

                if (state != StageState.Ahead)
                {
                    var linkedHere = linkedRecords.Where(r => linkTarget[s].TryGetValue(r.Index, out var at) && at == w).ToList();
                    Place(lines, KeysOf(f.Schedule), done, linkedHere, said, anyLineAsks);
                }

                perSchedule[s].Add(Total(window.Name, state, daysLeft, lines));
            }

            foreach (var r in done)
            {
                if (anyLineAsks[r.Index])
                {
                    continue; // a schedule asks it (by its words, or by the link to its work)
                }

                if (r.Identity is null)
                {
                    notRecognised.Add(new NotRecognisedItem(r.Index, window.Name));
                }
                else
                {
                    own.Add(new OwnWorkItem(r.Index, window.Name, r.Identity.MatchedWords));
                }
            }
        }

        var results = new List<ScheduleFollowResult>();
        for (var s = 0; s < followed.Count; s++)
        {
            var f = followed[s];
            results.Add(new ScheduleFollowResult(
                f.Slot, f.Schedule.TemplateId, perSchedule[s], OrderNotes(f.Schedule, records, today), StageUnknownCount(f.Schedule, records, today)));
        }

        return new PlotFollowResult(results, own, notRecognised);
    }

    // ---- days -------------------------------------------------------------------------------------------

    private static bool HasStoredDays(ScheduleActivityDef a) =>
        a.EndDay.HasValue && !string.IsNullOrWhiteSpace(a.Part) && a.FrequencyMode.HasValue;

    private static IEnumerable<DateOnly> StoredDates(ScheduleActivityDef a, DateOnly dayZero)
    {
        if (!HasStoredDays(a))
        {
            yield break;
        }

        var end = a.EndDay!.Value;
        if (a.FrequencyMode == FrequencyMode.OneTime)
        {
            yield return dayZero.AddDays(a.StartDay);
            yield break;
        }

        // the same spacing PlanDerivationEngine uses: every N days, or per week = floor(7 / max(1, N)) days
        var interval = a.FrequencyMode == FrequencyMode.PerWeek
            ? Math.Max(1, (int)Math.Floor(7d / Math.Max(1, a.IntervalDays ?? 1)))
            : Math.Max(1, a.IntervalDays ?? 1);
        for (var day = a.StartDay; day <= end; day += interval)
        {
            yield return dayZero.AddDays(day);
        }
    }

    // ---- placement --------------------------------------------------------------------------------------

    private sealed record Rec(int Index, RecordedWork Work, WorkIdentity? Identity);

    private sealed class Line
    {
        public Line(StageActivityPlan plan, WorkIdentity? identity)
        {
            Plan = plan;
            Identity = identity;
        }

        public StageActivityPlan Plan { get; }
        public WorkIdentity? Identity { get; }
        public bool Stored => Plan.Dates is not null;
        public int Done { get; set; }
        public int More { get; set; }
        public int Said { get; set; }
        public int Left => Plan.TimesInStage!.Value - Done;
        public DateOnly NextDay => Plan.Dates![Done];
    }

    private static bool IsSaidNotDone(RecordedWork r) =>
        !r.Disputed
        && r.Status is ExecutionStatus.Skipped or ExecutionStatus.Delayed
        && !string.IsNullOrWhiteSpace(r.ActivityType)
        && !r.ActivityType.Trim().Equals("reminder", StringComparison.OrdinalIgnoreCase)
        && !r.ActivityType.Trim().Equals("observation", StringComparison.OrdinalIgnoreCase);

    private static bool IsKeyed(WorkIdentity id) =>
        id.Role is not null || (id.Part == WorkPart.Work && id.OperationKey is not null);

    private static List<Line> Candidates(List<Line> lines, WorkIdentity id) =>
        lines.Where(l => l.Identity is not null && WorkRecogniser.Same(l.Identity, id).Matched)
             .OrderBy(l => l.Plan.ActivityId)
             .ToList();

    /// <summary>slice 6: for one schedule, the window (index into <paramref name="windows"/>) each linked record counts in; a record whose work this schedule does not hold is absent.</summary>
    private static Dictionary<int, int> LinkTargets(FollowedSchedule f, IReadOnlyList<StageWindow> windows, IReadOnlyList<Rec> linkedRecords)
    {
        var target = new Dictionary<int, int>();
        if (linkedRecords.Count == 0)
        {
            return target;
        }

        var keysByWindow = windows
            .Select(window => StagePlan(f.Schedule, f.DayZero, window).Select(p => p.TaskKey).Where(k => k is not null).ToHashSet(StringComparer.Ordinal))
            .ToList();
        foreach (var r in linkedRecords)
        {
            var key = r.Work.ForTaskKey!;
            var own = -1;
            var first = -1;
            for (var i = 0; i < windows.Count; i++)
            {
                if (!keysByWindow[i].Contains(key))
                {
                    continue;
                }

                if (first < 0)
                {
                    first = i;
                }

                if (r.Work.WorkDate >= windows[i].From && r.Work.WorkDate <= windows[i].To)
                {
                    own = i;
                    break;
                }
            }

            if ((own >= 0 ? own : first) is var at && at >= 0)
            {
                target[r.Index] = at;
            }
        }

        return target;
    }

    private static IReadOnlySet<string> KeysOf(ScheduleDefinition schedule) =>
        schedule.Activities.Select(a => a.TaskKey).Where(k => k is not null).Select(k => k!).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6) - the works with no day, no expectation and no stage: no number is asked (P4), and each counts
    /// only the records LINKED to it that count as done and were made by today. Null when the schedule has no such work.
    /// </summary>
    private static StageCount? StageUnknownCount(ScheduleDefinition schedule, List<Rec> records, DateOnly today)
    {
        var unknown = schedule.Activities.Where(a => a.StageUnknown).ToList();
        if (unknown.Count == 0)
        {
            return null;
        }

        var counts = unknown
            .Select(a => new ActivityCount(
                a.ActivityId,
                a.Part ?? string.Empty,
                a.Title,
                null,
                a.TaskKey is null
                    ? 0
                    : records.Count(r => string.Equals(r.Work.ForTaskKey, a.TaskKey, StringComparison.Ordinal)
                        && r.Work.WorkDate <= today && ScheduledWorkMatcher.CountsAsDone(r.Work)),
                null,
                0,
                0))
            .ToList();
        return new StageCount(string.Empty, StageState.Current, null, null, null, null, counts);
    }

    private static void Place(List<Line> lines, IReadOnlySet<string> scheduleKeys, List<Rec> done, List<Rec> linkedByDay, List<Rec> said, bool[] anyLineAsks)
    {
        // slice 6 - the explicit link first: a record linked to a work of THIS schedule is that work's, whatever its words (even words nobody can read) and
        // whatever its day. It counts on that work's line in the window that holds the line, once, and never on another line of this schedule by its words.
        var linked = new HashSet<int>();
        foreach (var r in done.Where(r => r.Work.ForTaskKey is { } key && scheduleKeys.Contains(key)))
        {
            linked.Add(r.Index);
            anyLineAsks[r.Index] = true; // a work of his schedule, never "own work" of this window
        }

        var lineKeys = lines.Select(l => l.Plan.TaskKey).Where(k => k is not null).ToHashSet(StringComparer.Ordinal);
        foreach (var r in linkedByDay.Where(r => lineKeys.Contains(r.Work.ForTaskKey!)).OrderBy(r => r.Work.WorkDate).ThenBy(r => r.Index))
        {
            var line = lines.First(l => string.Equals(l.Plan.TaskKey, r.Work.ForTaskKey, StringComparison.Ordinal));

            if (!line.Stored || line.Left > 0)
            {
                line.Done++;
            }
            else
            {
                line.More++;
            }
        }

        var placeable = done.Where(r => r.Identity is not null && !linked.Contains(r.Index)).ToList();
        var ordered = placeable.Where(r => IsKeyed(r.Identity!)).OrderBy(r => r.Work.WorkDate).ThenBy(r => r.Index)
            .Concat(placeable.Where(r => !IsKeyed(r.Identity!)).OrderBy(r => r.Work.WorkDate).ThenBy(r => r.Index));

        foreach (var r in ordered)
        {
            var candidates = Candidates(lines, r.Identity!);
            if (candidates.Count == 0)
            {
                continue;
            }

            anyLineAsks[r.Index] = true;
            var room = candidates.Where(l => l.Stored && l.Left > 0)
                .OrderByDescending(l => l.Left).ThenBy(l => l.NextDay).ThenBy(l => l.Plan.ActivityId)
                .FirstOrDefault();
            if (room is not null)
            {
                room.Done++;
                continue;
            }

            var wordsOnly = candidates.FirstOrDefault(l => !l.Stored);
            if (wordsOnly is not null)
            {
                wordsOnly.Done++;
                continue;
            }

            candidates[0].More++;
        }

        // "said not done": per same-work line, capped at what that line has not yet
        foreach (var r in said.Where(r => r.Identity is not null && !(r.Work.ForTaskKey is { } key && scheduleKeys.Contains(key))))
        {
            var target = Candidates(lines, r.Identity!)
                .Where(l => l.Stored && l.Left - l.Said > 0)
                .OrderByDescending(l => l.Left - l.Said).ThenBy(l => l.Plan.ActivityId)
                .FirstOrDefault();
            if (target is not null)
            {
                target.Said++;
            }
        }
    }

    /// <summary>What work one activity of a schedule IS (the stored part / role / operation key overrule its title). Read by the engine and, since lane SCH-ADV, by "what do my schedules ask for this work".</summary>
    public static WorkIdentity? IdentityOf(ScheduleDefinition schedule, Guid activityId)
    {
        var def = schedule.Activities.First(a => a.ActivityId == activityId);
        return IdentityOf(def.Title, def.Part, def.OperationKey, def.Role, def.NutrientKey);
    }

    /// <summary>
    /// spec: plr-d10 lane ATT-W (R35) - the ONE rule that reads a scheduled work's identity from its title and what the schedule
    /// STORES, public so the attention board's <see cref="ScheduledWorkMatcher"/> asks the very same rule and never keeps a copy
    /// of it (a pure extraction: <see cref="Follow"/> reads exactly what it read before).
    /// </summary>
    public static WorkIdentity? IdentityOf(string title, string? part, string? operationKey, string? role, string? nutrientKey)
    {
        var id = WorkRecogniser.Recognise(title);
        if (id is null)
        {
            // stored truth beats words: a stored part with a stored role or operation key reads the work even when the
            // title is not recognised. Nothing stored -> no identity -> the activity takes no records (R12).
            if (Enum.TryParse<WorkPart>(part, true, out var storedPart) && (role is not null || operationKey is not null))
            {
                return new WorkIdentity(storedPart, operationKey, null, [], role, nutrientKey);
            }

            return null;
        }

        // what the schedule stores overrules what the title alone says
        return id with
        {
            Role = role ?? id.Role,
            NutrientKey = nutrientKey ?? id.NutrientKey,
            OperationKey = operationKey ?? id.OperationKey,
        };
    }

    private static StageCount Total(string name, StageState state, int? daysLeft, List<Line> lines)
    {
        var counts = lines.Select(l => new ActivityCount(
            l.Plan.ActivityId,
            l.Plan.Part,
            l.Plan.Title,
            state == StageState.Ahead ? null : l.Plan.TimesInStage,
            l.Done,
            state == StageState.Ahead || !l.Stored ? null : l.Plan.TimesInStage - l.Done,
            l.Said,
            l.More)).ToList();

        if (state == StageState.Ahead)
        {
            return new StageCount(name, state, null, null, null, null, counts);
        }

        var stored = lines.Where(l => l.Stored).ToList();
        if (stored.Count == 0)
        {
            return new StageCount(name, state, null, null, null, daysLeft, counts);
        }

        var asked = stored.Sum(l => l.Plan.TimesInStage!.Value);
        var doneTotal = stored.Sum(l => l.Done);
        return new StageCount(name, state, asked, doneTotal, asked - doneTotal, daysLeft, counts);
    }

    // ---- order notes (R34) ------------------------------------------------------------------------------

    private static IReadOnlyList<OrderNote> OrderNotes(ScheduleDefinition schedule, List<Rec> records, DateOnly today)
    {
        var notes = new List<OrderNote>();
        foreach (var then in schedule.Activities.Where(a => a.AfterActivityId.HasValue))
        {
            var first = schedule.Activities.FirstOrDefault(a => a.ActivityId == then.AfterActivityId);
            if (first is null)
            {
                continue;
            }

            var thenDay = FirstKeyedDay(schedule, then, records, today);
            var firstDay = FirstKeyedDay(schedule, first, records, today);
            if (thenDay.HasValue && (!firstDay.HasValue || thenDay.Value < firstDay.Value))
            {
                notes.Add(new OrderNote(first.ActivityId, then.ActivityId, firstDay, thenDay.Value));
            }
        }

        return notes;
    }

    // only records tied to the work by operation key or role: never a generic record's tie-break placement
    private static DateOnly? FirstKeyedDay(ScheduleDefinition schedule, ScheduleActivityDef activity, List<Rec> records, DateOnly today)
    {
        var id = IdentityOf(schedule, activity.ActivityId);
        if (id is null)
        {
            return null;
        }

        DateOnly? best = null;
        foreach (var r in records)
        {
            if (r.Identity is null || !IsKeyed(r.Identity) || r.Work.WorkDate > today || !ScheduledWorkMatcher.CountsAsDone(r.Work))
            {
                continue;
            }

            if (WorkRecogniser.Same(id, r.Identity).Matched && (best is null || r.Work.WorkDate < best))
            {
                best = r.Work.WorkDate;
            }
        }

        return best;
    }
}
