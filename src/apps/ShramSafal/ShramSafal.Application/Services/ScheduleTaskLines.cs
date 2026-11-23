using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "नोंद and तुलना close the loop"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>One work in the task format, as तुलना and लक्ष द्या read it: the id it is counted under (an own work's id, or a version's task id) and its content.</summary>
public sealed record ScheduleTaskSource(Guid Id, ScheduleTaskContent Content);

/// <summary>
/// The ONE place a work in the task format becomes a line the schedule engine counts, and a record becomes LINKED to the work it was recorded for.
/// <list type="bullet">
/// <item><b>Lines</b>: a work with a stated day once (or every N days with a stated end) asks its days; an "after" or "when seen" work asks ONE day once its
/// date is known from what really happened (the earlier work recorded, the sign seen), never before (P4: an unseen sign has no date). Until then it is a line of
/// words only (no number asked) under the stage that holds its expected day, else its own stage, else "stage unknown". An own work's stage 0 may be a stage left
/// open (the format has no open value), so it is never read as the first stage. "Observe" works are looks, not work: no line.</item>
/// <item><b>Links</b>: a plan made from a work and completed WITH a record links that record to the work (<c>LinkedDailyLogIds</c>). One record counts for one
/// work only: each plan takes one task of its earliest linked log that has one left (the same work by its words first, else the first done one). A plan marked
/// done with no record links nothing: no record is never "done" (and never "not done" either).</item>
/// </list>
/// Pure: no clock, no database. Recording never copies words from the plan into the log; the link is read here, never written into the log.
/// </summary>
public static class ScheduleTaskLines
{
    /// <summary>
    /// The engine lines of <paramref name="tasks"/>, leaving out the works <paramref name="alreadyStored"/> already wrote as stored activities.
    /// <paramref name="orderedStages"/> is the मुख्य schedule's stage line in the windows' order; <paramref name="dayZero"/> the day 0 the works count from.
    /// </summary>
    public static IReadOnlyList<ScheduleActivityDef> Lines(
        IReadOnlyList<ScheduleTaskSource> tasks,
        IReadOnlySet<string> alreadyStored,
        IReadOnlyList<StageDefinition> orderedStages,
        DateOnly dayZero,
        IReadOnlyDictionary<string, ScheduleTaskFacts> facts,
        bool stageZeroMayBeOpen)
    {
        ArgumentNullException.ThrowIfNull(tasks);
        var timings = tasks
            .GroupBy(t => t.Content.TaskKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Content.Timing, StringComparer.Ordinal);
        var lines = new List<ScheduleActivityDef>();
        foreach (var task in tasks
                     .OrderBy(t => t.Content.StageIndex).ThenBy(t => t.Content.Order).ThenBy(t => t.Content.TaskKey, StringComparer.Ordinal))
        {
            var content = task.Content;
            if (alreadyStored.Contains(content.TaskKey) || PartOf(content.Kind) is not { } part)
            {
                continue;
            }

            var title = content.Name.Trim();
            var timing = content.Timing;
            ScheduleActivityDef Line(int startDay, int? endDay, FrequencyMode? mode, int? interval, bool unknown = false) =>
                new(task.Id, title, part, null, null, null, startDay, endDay, mode, interval, null, content.TaskKey, unknown);

            if (timing.Timer == ScheduleTimerKind.Day && timing.Repeat == ScheduleRepeatMode.EveryNDays
                && timing.FromDay is { } from && timing.RepeatInterval is { } every and > 0 && (timing.RepeatEndDay ?? timing.ToDay) is { } end && end >= from)
            {
                lines.Add(Line(from, end, FrequencyMode.EveryNDays, every));
                continue;
            }

            var resolved = ScheduleTimerResolver.Resolve(content.TaskKey, timings, dayZero, facts);
            if (timing.Repeat == ScheduleRepeatMode.Once && resolved.Due is { } due)
            {
                var day = due.From.DayNumber - dayZero.DayNumber;
                lines.Add(Line(day, day, FrequencyMode.OneTime, 1));
                continue;
            }

            if ((resolved.Due ?? resolved.Expected) is { } known)
            {
                lines.Add(Line(known.From.DayNumber - dayZero.DayNumber, null, null, null));
                continue;
            }

            var index = content.StageIndex;
            var stageKnown = index >= 0 && index < orderedStages.Count && !(stageZeroMayBeOpen && index == 0);
            lines.Add(stageKnown ? Line(orderedStages[index].StartDay, null, null, null) : Line(0, null, null, null, unknown: true));
        }

        return lines;
    }

    /// <summary>
    /// What really happened to each work, by task key, as the timer resolver reads it: the day it was recorded (the earliest linked log of its latest plan that
    /// has one) and the day its sign was seen (the latest decisive answer). <paramref name="logDates"/> holds the days of the logs the plans link.
    /// </summary>
    public static IReadOnlyDictionary<string, ScheduleTaskFacts> Facts(
        IEnumerable<PlannedWork> plans, IReadOnlyDictionary<Guid, DateOnly> logDates, IEnumerable<ScheduleTaskEvent> events)
    {
        var recorded = plans
            .Where(p => p.ScheduleTaskKey is not null && p.Status != PlannedWorkStatus.Cancelled && LogsOf(p).Any(logDates.ContainsKey))
            .GroupBy(p => p.ScheduleTaskKey!, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => LogsOf(g.OrderByDescending(p => p.Occurrence ?? 0).First(p => LogsOf(p).Any(logDates.ContainsKey)))
                    .Where(logDates.ContainsKey).Select(id => logDates[id]).Min(),
                StringComparer.Ordinal);
        var seen = events
            .GroupBy(e => e.TaskKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => ScheduleSignFacts.SeenOn(g), StringComparer.Ordinal);

        var facts = new Dictionary<string, ScheduleTaskFacts>(StringComparer.Ordinal);
        foreach (var key in recorded.Keys.Concat(seen.Keys).Distinct(StringComparer.Ordinal))
        {
            facts[key] = new ScheduleTaskFacts(
                recorded.TryGetValue(key, out var actual) ? actual : null,
                seen.TryGetValue(key, out var on) ? on : null);
        }

        return facts;
    }

    /// <summary>
    /// Which recorded task each plan's link names, by log task id -> task key. <paramref name="plans"/> are the plans made from the works of ONE plot-season;
    /// <paramref name="tasks"/> that season's recorded tasks and <paramref name="logDays"/> the day of each log. A cancelled plan links nothing.
    /// </summary>
    public static IReadOnlyDictionary<Guid, string> Links(
        IEnumerable<PlannedWork> plans, IReadOnlyList<LogTask> tasks, IReadOnlyDictionary<Guid, DateOnly> logDays)
    {
        var links = new Dictionary<Guid, string>();
        var byLog = tasks.GroupBy(t => t.DailyLogId).ToDictionary(g => g.Key, g => g.OrderBy(t => t.OccurredAtUtc).ThenBy(t => t.Id).ToList());
        foreach (var plan in plans
                     .Where(p => p.ScheduleTaskKey is not null && p.Status != PlannedWorkStatus.Cancelled)
                     .OrderBy(p => p.Occurrence ?? 0)
                     .ThenBy(p => p.Id))
        {
            foreach (var logId in LogsOf(plan)
                         .Where(byLog.ContainsKey)
                         .OrderBy(id => logDays.TryGetValue(id, out var d) ? d.DayNumber : int.MaxValue)
                         .ThenBy(id => id))
            {
                var open = byLog[logId]
                    .Where(t => !links.ContainsKey(t.Id)
                        && ScheduledWorkMatcher.CountsAsDone(new RecordedWork(t.ActivityType, default, t.ExecutionStatus)))
                    .ToList();
                var pick = open.FirstOrDefault(t => ScheduledWorkMatcher.SameWork(plan.Title, t.ActivityType)) ?? open.FirstOrDefault();
                if (pick is not null)
                {
                    links[pick.Id] = plan.ScheduleTaskKey!;
                    break;
                }
            }
        }

        return links;
    }

    /// <summary>Every log a plan links (on the task or on one of its plot rows).</summary>
    public static IReadOnlyList<Guid> LogsOf(PlannedWork plan) =>
        plan.LinkedDailyLogIds.Concat(plan.Plots.SelectMany(p => p.LinkedDailyLogIds)).Distinct().ToList();

    private static string? PartOf(ScheduleTaskKind kind) => kind switch
    {
        ScheduleTaskKind.Irrigation => "irrigation",
        ScheduleTaskKind.Nutrition => "nutrition",
        ScheduleTaskKind.Spray => "spray",
        ScheduleTaskKind.Work => "work",
        _ => null,
    };
}
