using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Events;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>
/// One stage of an own schedule as "हेच मुख्य करा" sends it: its name, its days in STORED days (pruning, shown day 1, is stored 0) and, optionally, the sign it
/// starts or ends on. A stage that ends on a sign still names an EXPECTED end day (the column stays NOT NULL for the deployed binary): the day is an
/// expectation, and the stage stays open until its sign (see <see cref="ScheduleTemplate.HasStageLine"/> and the stage-line rule in the Application layer).
/// </summary>
public sealed record OwnScheduleStage(string Name, int StartDay, int EndDay, string? StartSign = null, string? EndSign = null);

public sealed partial class ScheduleTemplate
{
    /// <summary>
    /// True when this version has a STAGE LINE a plot can follow: at least one stage, every stage with its days, and either its days stored the old way
    /// (<see cref="HasStoredDays"/>) or at least one task in the task format. A schedule made only of "after" and "sign" works has no stored day of a
    /// work, and it still has a stage line (slice 3: <c>MakeMain_WithSignEndedStages_KeepsStageLine</c>). Needs the tasks loaded (a loader that does not
    /// include them sees the old answer, <see cref="HasStoredDays"/>).
    /// </summary>
    public bool HasStageLine =>
        _stages.Count > 0
        && _stages.All(s => s.StartDay <= s.EndDay)
        && (HasStoredDays || _tasks.Count > 0);

    /// <summary>
    /// "हेच मुख्य करा": freezes the works of a plot-season's own schedule into a NEW version of the person's own schedule - the next version of
    /// <paramref name="previous"/> (the own version that plot follows now), else version 1 of a new chain. Nothing is written to <paramref name="previous"/> (P3).
    /// <list type="bullet">
    /// <item><b>Owner</b>: <paramref name="ownerUserId"/>, the owner of the farm read from the farm row by the caller; Team scope; the maker is <paramref name="madeBy"/>.</item>
    /// <item><b>Stages</b>: as sent, else the stages (and signs) of <paramref name="previous"/>. Listed in day order (refused otherwise); a task's stage index names
    /// the stage by its place in that order, the same in every version.</item>
    /// <item><b>Tasks</b>: written once (<see cref="SetTasks"/>), and against <paramref name="previous"/> no safety or pre-harvest gap may shrink
    /// (<see cref="ScheduleSafetyGaps.CheckVersion"/>).</item>
    /// <item><b>For old phones</b>: every task with a day window that the old rules can hold (a work kind, not "observe"; once, or every N days with a stated end;
    /// inside the stages; name of at most <see cref="MaxNameLength"/>) is ALSO written as a stored activity, so a 1.0.17 phone reads it as before. Nothing is
    /// invented: a task whose days are not fully stated, an "after" and a "sign" task stay in the task format only.</item>
    /// </list>
    /// Returns null and the reason when a rule refuses it; nothing is raised then.
    /// </summary>
    public static ScheduleTemplate? FreezeOwn(
        Guid newId,
        ScheduleTemplate? previous,
        string? name,
        string? cropKey,
        UserId ownerUserId,
        UserId madeBy,
        DateTime at,
        IReadOnlyList<OwnScheduleStage>? stages,
        IReadOnlyList<ScheduleTaskContent> tasks,
        out ScheduleTaskProblem? problem)
    {
        problem = null;
        tasks ??= [];
        if (newId == Guid.Empty || ownerUserId.IsEmpty || madeBy.IsEmpty)
        {
            problem = new("OwnScheduleFreeze", "A frozen version needs its id, the farm's owner and who made it.");
            return null;
        }

        if (previous is not null && (previous.OwnerUserId != ownerUserId || previous.TenantScope != TenantScope.Team))
        {
            problem = new("OwnSchedulePrevious", "The version before is not this owner's own schedule.");
            return null;
        }

        var stageInput = stages ?? previous?.OwnStages();
        if (stageInput is null || stageInput.Count == 0)
        {
            problem = new("OwnScheduleStages", "Making it main needs at least one stage.");
            return null;
        }

        problem = CheckOwnStages(stageInput);
        if (problem is not null)
        {
            return null;
        }

        var finalName = string.IsNullOrWhiteSpace(name) ? previous?.Name : name.Trim();
        if (string.IsNullOrWhiteSpace(finalName) || finalName.Length > MaxNameLength)
        {
            problem = new("OwnScheduleName", $"The schedule needs a name of 1 to {MaxNameLength} characters.");
            return null;
        }

        var finalCrop = previous?.CropKey ?? cropKey?.Trim();
        if (string.IsNullOrWhiteSpace(finalCrop) || finalCrop.Length > MaxCropKeyLength)
        {
            problem = new("OwnScheduleCrop", $"The schedule needs a crop of 1 to {MaxCropKeyLength} characters.");
            return null;
        }

        // A work's stage index names a stage by its place in the stage line ORDERED BY DAY - the same place in every version, so a work saved once keeps its
        // stage when a later version reuses the line. A line sent out of day order is refused rather than re-ordered behind the works' backs.
        var order = stageInput.Select((s, i) => (Stage: s, Sent: i)).ToList();
        for (var i = 1; i < order.Count; i++)
        {
            var before = order[i - 1].Stage;
            var stage = order[i].Stage;
            if (stage.StartDay < before.StartDay || (stage.StartDay == before.StartDay && stage.EndDay < before.EndDay))
            {
                problem = new("OwnScheduleStageOrder", "The stages are listed in day order (a work names its stage by its place in that order).");
                return null;
            }
        }

        var placed = tasks.ToList();

        if (previous is not null
            && ScheduleSafetyGaps.CheckVersion(previous._tasks.Select(t => t.Content), placed.Where(t => t is not null)) is { } gap)
        {
            problem = gap;
            return null;
        }

        var definitions = order.Select(x => new StageDefinition(x.Stage.Name.Trim(), x.Stage.StartDay, x.Stage.EndDay)).ToList();
        var copy = new ScheduleTemplate(
            newId,
            finalName,
            definitions[0].Name,
            at,
            madeBy,
            TenantScope.Team,
            version: previous is null ? 1 : previous.Version + 1,
            previousVersionId: previous?.Id,
            derivedFromTemplateId: null,
            definitions)
        {
            OwnerType = ScheduleOwnerType.User,
            SourceLabel = previous?.SourceLabel,
            CropKey = finalCrop,
            OwnerUserId = ownerUserId,
        };
        copy.CopyMadeForFrom(previous?.MadeFor ?? ScheduleMadeFor.None);

        if (!copy.SetTasks(placed, [], out problem))
        {
            return null;
        }

        var signs = order
            .Select((x, i) => new ScheduleStageSign(i, Words(x.Stage.StartSign), Words(x.Stage.EndSign)))
            .Where(s => s.StartSign is not null || s.EndSign is not null)
            .ToList();
        if (!copy.SetStageSigns(signs, out problem))
        {
            return null;
        }

        copy.ProjectDayTasks(definitions);

        if (previous is not null)
        {
            copy.Raise(new ScheduleTemplateEditedEvent(Guid.NewGuid(), at, newId, previous.Id, copy.Version, madeBy));
        }

        return copy;

        static string? Words(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }

    /// <summary>The stages of this version with their signs, as <see cref="FreezeOwn"/> takes them.</summary>
    public IReadOnlyList<OwnScheduleStage> OwnStages() =>
        _stages
            .OrderBy(s => s.OrderIndex)
            .Select(s => new OwnScheduleStage(s.Name, s.StartDay, s.EndDay, s.StartSign, s.EndSign))
            .ToList();

    /// <summary>Whether this version is written in the task format (it has tasks or challenges, or a stage sign).</summary>
    public bool IsInTaskFormat =>
        _tasks.Count > 0 || _challenges.Count > 0 || _stages.Any(s => s.StartSign is not null || s.EndSign is not null);

    private static ScheduleTaskProblem? CheckOwnStages(IReadOnlyList<OwnScheduleStage> stages)
    {
        if (stages.Count > MaxEditStages)
        {
            return new("OwnScheduleStages", $"A schedule has at most {MaxEditStages} stages.");
        }

        foreach (var stage in stages)
        {
            if (stage is null || string.IsNullOrWhiteSpace(stage.Name) || stage.Name.Trim().Length > MaxStageNameLength)
            {
                return new("OwnScheduleStages", $"Every stage needs a name of 1 to {MaxStageNameLength} characters.");
            }

            // The old rule (CheckStages): a stage starts on day 0 or later. A stage before pruning waits for a reader that can show it (old phones read these days).
            if (stage.StartDay < 0 || stage.EndDay < stage.StartDay || stage.EndDay > MaxEditDay)
            {
                return new("OwnScheduleStageDays", $"Stage \"{stage.Name.Trim()}\": its days are 0 to {MaxEditDay} and it does not end ({stage.EndDay}) before it starts ({stage.StartDay}).");
            }

            if (Over(stage.StartSign) || Over(stage.EndSign))
            {
                return new("ScheduleStageSign", $"A stage sign is at most {MaxStageSignLength} characters.");
            }
        }

        return null;

        static bool Over(string? text) => text is not null && text.Trim().Length > MaxStageSignLength;
    }

    /// <summary>Writes, as stored activities, the day tasks the old rules can hold (see <see cref="FreezeOwn"/>). Never invents a day.</summary>
    private void ProjectDayTasks(IReadOnlyList<StageDefinition> orderedStages)
    {
        foreach (var p in ProjectableDayTasks(orderedStages))
        {
            var identity = WorkRecogniser.Recognise(p.Title);
            var role = identity?.Role;
            _activities.Add(TemplateActivity.Stored(
                Guid.NewGuid(), Id, p.Title, p.From, p.End, p.Mode, p.Interval, p.Part.ToString(), identity?.OperationKey, role,
                role == "nutrient" ? identity?.NutrientKey : null, afterActivityId: null));
        }
    }

    /// <summary>
    /// For a version frozen from own works: which task each stored activity was written from (activity id, task key). The projection is a pure function of the
    /// tasks and the stages, so it is worked out again and matched on the stored fields; an activity it does not explain is left out. Needs tasks and activities loaded.
    /// Lets a change move what belongs to a step (a moved reminder) from one version to the next by the task's permanent key.
    /// </summary>
    public IReadOnlyDictionary<Guid, string> ProjectedTaskKeyByActivity()
    {
        var result = new Dictionary<Guid, string>();
        if (_stages.Count == 0 || _tasks.Count == 0)
        {
            return result;
        }

        var unused = _activities.ToList();
        foreach (var p in ProjectableDayTasks(Stages.ToList()))
        {
            var match = unused.FirstOrDefault(a =>
                a.ActivityName == p.Title && a.OffsetDays == p.From && a.EndDay == p.End && a.StoredFrequencyMode == p.Mode
                && a.StoredIntervalDays == p.Interval && a.Part == p.Part.ToString());
            if (match is not null)
            {
                result[match.Id] = p.TaskKey;
                unused.Remove(match);
            }
        }

        return result;
    }

    private sealed record ProjectedDayTask(string TaskKey, string Title, int From, int End, FrequencyMode Mode, int Interval, WorkPart Part);

    private IEnumerable<ProjectedDayTask> ProjectableDayTasks(IReadOnlyList<StageDefinition> orderedStages)
    {
        var lastDay = orderedStages.Max(s => s.EndDay);
        foreach (var task in _tasks.OrderBy(t => t.StageIndex).ThenBy(t => t.Order).ThenBy(t => t.TaskKey, StringComparer.Ordinal))
        {
            var content = task.Content;
            var timing = content.Timing;
            if (timing.Timer != ScheduleTimerKind.Day || timing.FromDay is not { } from || PartOf(content.Kind) is not { } part)
            {
                continue;
            }

            int end;
            FrequencyMode mode;
            int interval;
            switch (timing.Repeat)
            {
                case ScheduleRepeatMode.Once:
                    end = timing.ToDay ?? from;
                    mode = FrequencyMode.OneTime;
                    interval = 1;
                    break;
                case ScheduleRepeatMode.EveryNDays when timing.RepeatInterval is { } every && (timing.RepeatEndDay ?? timing.ToDay) is { } stated:
                    end = stated;
                    mode = FrequencyMode.EveryNDays;
                    interval = every;
                    break;
                default:
                    continue; // a repeat that ends on a sign, has no stated end, or is "per week" has no stored days the old rules can hold
            }

            var title = content.Name.Trim();
            if (CheckActivityDays(title, from, end, mode, interval, orderedStages, lastDay) is not null)
            {
                continue;
            }

            yield return new ProjectedDayTask(task.TaskKey, title, from, end, mode, interval, part);
        }
    }

    private static WorkPart? PartOf(ScheduleTaskKind kind) => kind switch
    {
        ScheduleTaskKind.Irrigation => WorkPart.Irrigation,
        ScheduleTaskKind.Nutrition => WorkPart.Nutrition,
        ScheduleTaskKind.Spray => WorkPart.Spray,
        ScheduleTaskKind.Work => WorkPart.Work,
        _ => null, // "observe" is not a work an old phone can count
    };
}
