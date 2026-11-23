namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// The task format of a version, beside its stored activities. ADDITIVE: a version with no tasks reads and behaves exactly as before (HasStoredDays, Stages and
// Activities are not touched by anything here), and the existing loaders do not read the task tables. Tasks are written ONCE with their version (SetTasks), never
// changed after (P3: a change is a new version, with the gaps checked by ScheduleSafetyGaps), and carried by value into a copy.

public sealed partial class ScheduleTemplate
{
    /// <summary>The longest a stage's start or end sign may be (the width of <c>start_sign</c> / <c>end_sign</c>).</summary>
    public const int MaxStageSignLength = 160;

    private readonly List<ScheduleTask> _tasks = [];
    private readonly List<ScheduleChallenge> _challenges = [];

    /// <summary>The tasks of this version in the task format (<c>ssf.schedule_tasks</c>); empty on every version made before the format, and on one loaded without them.</summary>
    public IReadOnlyCollection<ScheduleTask> Tasks => _tasks.AsReadOnly();

    /// <summary>The challenges of this version (<c>ssf.schedule_challenges</c>).</summary>
    public IReadOnlyCollection<ScheduleChallenge> Challenges => _challenges.AsReadOnly();

    /// <summary>
    /// Writes the tasks and challenges of a NEW version, whole. Refused (and nothing changed) when: tasks were already written to this version; a task or
    /// challenge does not hold together (<see cref="ScheduleTaskContent.Check"/>); a key is used twice; a stage index names a stage this version does not have
    /// (a version with no stages yet accepts any); an 'after' names a task that is not in this version, or the order loops back on itself.
    /// The tenant of every row (scope, and the person whose schedule it is: the owner, else the maker) is copied from this version.
    /// </summary>
    public bool SetTasks(
        IReadOnlyList<ScheduleTaskContent> tasks,
        IReadOnlyList<ScheduleChallengeContent> challenges,
        out ScheduleTaskProblem? problem)
    {
        tasks ??= [];
        challenges ??= [];
        problem = null;
        if (_tasks.Count > 0 || _challenges.Count > 0)
        {
            problem = new("ScheduleTaskAlreadySet", "The tasks of a version are written once; a change is a new version.");
            return false;
        }

        var stageCount = _stages.Count;
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var task in tasks)
        {
            if (task is null)
            {
                problem = new("ScheduleTaskKey", "A task is missing.");
                return false;
            }

            problem = task.Check();
            if (problem is not null)
            {
                return false;
            }

            if (!keys.Add(task.TaskKey))
            {
                problem = new("ScheduleTaskKeyTaken", $"The task key '{task.TaskKey}' is used by two tasks of this version.");
                return false;
            }

            if (stageCount > 0 && task.StageIndex >= stageCount)
            {
                problem = new("ScheduleTaskStage", $"Task '{task.TaskKey}' belongs to stage {task.StageIndex}, and this version has {stageCount} stages.");
                return false;
            }
        }

        var afterOf = tasks
            .Where(t => t.Timing.Timer == ScheduleTimerKind.After)
            .ToDictionary(t => t.TaskKey, t => t.Timing.AfterTaskKey!, StringComparer.Ordinal);
        foreach (var (key, after) in afterOf)
        {
            if (!keys.Contains(after))
            {
                problem = new("ScheduleTaskAfter", $"Task '{key}' comes after '{after}', which is not a task of this version.");
                return false;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal) { key };
            var current = after;
            while (afterOf.TryGetValue(current, out var next))
            {
                if (!seen.Add(current))
                {
                    problem = new("ScheduleTaskAfter", $"The order around task '{key}' loops back on itself.");
                    return false;
                }

                current = next;
            }
        }

        var challengeKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var challenge in challenges)
        {
            if (challenge is null)
            {
                problem = new("ScheduleChallengeKey", "A challenge is missing.");
                return false;
            }

            problem = challenge.Check();
            if (problem is not null)
            {
                return false;
            }

            if (!challengeKeys.Add(challenge.ChallengeKey))
            {
                problem = new("ScheduleChallengeKeyTaken", $"The challenge key '{challenge.ChallengeKey}' is used by two challenges of this version.");
                return false;
            }

            if (stageCount > 0 && challenge.StageIndex >= stageCount)
            {
                problem = new("ScheduleChallengeStage", $"Challenge '{challenge.ChallengeKey}' belongs to stage {challenge.StageIndex}, and this version has {stageCount} stages.");
                return false;
            }
        }

        var owner = OwnerUserId ?? CreatedByUserId;
        _tasks.AddRange(tasks.Select(t => ScheduleTask.From(Id, TenantScope, owner, t)));
        _challenges.AddRange(challenges.Select(c => ScheduleChallenge.From(Id, TenantScope, owner, c)));
        return true;
    }

    /// <summary>
    /// Sets the signs some stages start or end on (words, or absent; the day numbers of a stage are not touched). Refused, and nothing changed, when a stage
    /// index names no stage or a sign is blank or longer than <see cref="MaxStageSignLength"/>. For a version being built: a saved version is never changed (P3).
    /// </summary>
    public bool SetStageSigns(IReadOnlyList<ScheduleStageSign> signs, out ScheduleTaskProblem? problem)
    {
        signs ??= [];
        problem = null;
        var ordered = _stages.OrderBy(s => s.OrderIndex).ToList();
        foreach (var sign in signs)
        {
            if (sign is null || sign.StageIndex < 0 || sign.StageIndex >= ordered.Count)
            {
                problem = new("ScheduleStageSign", "A sign names a stage of this version (the first stage is 0).");
                return false;
            }

            if (!SignOk(sign.StartSign) || !SignOk(sign.EndSign))
            {
                problem = new("ScheduleStageSign", $"A stage sign is words of 1 to {MaxStageSignLength} characters, or absent.");
                return false;
            }
        }

        foreach (var sign in signs)
        {
            ordered[sign.StageIndex].StartSign = sign.StartSign;
            ordered[sign.StageIndex].EndSign = sign.EndSign;
        }

        return true;

        static bool SignOk(string? text) => text is null || (!string.IsNullOrWhiteSpace(text) && text.Length <= MaxStageSignLength);
    }

    /// <summary>A copy carries the tasks and challenges by value (new row ids, the same keys and content) and the stage signs by position.</summary>
    private void CopyTasksFrom(ScheduleTemplate source)
    {
        var owner = OwnerUserId ?? CreatedByUserId;
        _tasks.AddRange(source._tasks.Select(t => t.CopyTo(Id, TenantScope, owner)));
        _challenges.AddRange(source._challenges.Select(c => c.CopyTo(Id, TenantScope, owner)));

        var from = source._stages.OrderBy(s => s.OrderIndex).ToList();
        var to = _stages.OrderBy(s => s.OrderIndex).ToList();
        for (var i = 0; i < Math.Min(from.Count, to.Count); i++)
        {
            to[i].StartSign = from[i].StartSign;
            to[i].EndSign = from[i].EndSign;
        }
    }
}
