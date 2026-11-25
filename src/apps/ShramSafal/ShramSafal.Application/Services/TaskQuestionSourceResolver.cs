using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule"; CTO rulings askOnlyWithSource, ownExperienceIsLabelled)

/// <summary>
/// <see cref="ITaskQuestionSources"/> over the task format. For a plot it reads (1) the works of its OWN schedule for the current season and (2) the tasks of the
/// schedule it follows as main (<see cref="MainSchedule.Pick"/>, the same pick the stage line uses), and finds each named task there; the rules that decide whether a
/// task stands on a source are the pure ones in <see cref="TaskQuestionLines"/>. The embedded schedule stays the fallback ONLY for a plot with neither (until the
/// content is loaded, slice 14). Read only: it writes nothing and refuses nothing but the one question.
/// </summary>
public sealed class TaskQuestionSourceResolver(
    IShramSafalRepository repository, IPlotSeasonReader plotSeasons, IOwnScheduleStore ownStore) : ITaskQuestionSources
{
    public async Task<TaskQuestionResolution> ResolveAsync(Guid farmId, Guid? plotId, IReadOnlyList<string> lineIds, CancellationToken ct = default)
    {
        var lines = lineIds ?? [];
        if (plotId is not { } plot || plot == Guid.Empty)
        {
            // No plot, no schedule: a task line has nothing to stand on; any other line is the embedded schedule's, as before.
            return lines.Any(TaskQuestionLines.IsTaskLine) ? Refused : NotTaskFormat;
        }

        if (await repository.GetFarmByIdAsync(farmId, ct) is not { } farm)
        {
            return lines.Any(TaskQuestionLines.IsTaskLine) ? Refused : NotTaskFormat;
        }

        // The plot's season and its main schedule come from the ONE reader the stage line and the day count use (PlotSeasonReader): never a second pick.
        var season = await plotSeasons.ReadAsync(farmId, plot, farm.OwnerUserId.Value, ct);
        if (season.CropCycleId is not { } cycleId)
        {
            return lines.Any(TaskQuestionLines.IsTaskLine) ? Refused : NotTaskFormat;
        }

        var own = (await ownStore.GetSeasonAsync(plot, cycleId, ct))
            .Where(i => i.State == OwnScheduleItemState.Active)
            .ToDictionary(i => i.TaskKey, StringComparer.Ordinal);

        var reference = season.TemplateId is { } mainId ? await repository.GetScheduleTemplateWithTasksByIdAsync(mainId, ct) : null;
        var referenceTasks = reference is { Tasks.Count: > 0 }
            ? reference.Tasks.GroupBy(t => t.TaskKey, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First().Content, StringComparer.Ordinal)
            : new Dictionary<string, ScheduleTaskContent>(StringComparer.Ordinal);

        if (own.Count == 0 && referenceTasks.Count == 0)
        {
            // The plot has no task-format schedule and no work of its own: only the embedded schedule can answer, and never a task line.
            return lines.Any(TaskQuestionLines.IsTaskLine) ? Refused : NotTaskFormat;
        }

        if (lines.Count == 0 || !lines.All(TaskQuestionLines.IsTaskLine))
        {
            // The plot uses the task format: a line of the embedded schedule (or a mix) is not a source for it. All or nothing.
            return Refused;
        }

        var resolved = new List<QuestionSourceRef>();
        foreach (var lineId in lines)
        {
            if (!TaskQuestionLines.TryParse(lineId, out var taskKey, out var part))
            {
                return Refused;
            }

            ScheduleTaskContent? task;
            TaskWorkKind kind;
            IReadOnlyList<ScheduleSource>? originSources = null;
            if (own.TryGetValue(taskKey, out var item))
            {
                task = item.Content;
                var taken = OwnScheduleItemOrigin.IsTakenText(item.Origin);
                kind = taken ? TaskWorkKind.OwnTaken : TaskWorkKind.OwnByHand;
                if (taken && (task.Sources is null || task.Sources.Count == 0))
                {
                    originSources = await OriginSourcesAsync(item, ct);
                }
            }
            else if (referenceTasks.TryGetValue(taskKey, out var referenceTask))
            {
                task = referenceTask;
                kind = TaskWorkKind.Reference;
            }
            else
            {
                return Refused;
            }

            if (!TaskQuestionLines.HasWords(task, part) || TaskQuestionLines.SourcesOf(task, kind, originSources) is not { Count: > 0 } sources)
            {
                return Refused;
            }

            resolved.AddRange(sources.Select(s => new QuestionSourceRef(lineId, s.Document, s.Page)));
        }

        return new TaskQuestionResolution(TaskQuestionGate.Resolved, resolved);
    }

    private async Task<IReadOnlyList<ScheduleSource>?> OriginSourcesAsync(OwnScheduleItem item, CancellationToken ct)
    {
        var origin = await ownStore.GetOriginAsync(item.Id, ct);
        if (origin is null || await repository.GetScheduleTemplateWithTasksByIdAsync(origin.SourceVersionId, ct) is not { } source)
        {
            return null;
        }

        return source.Tasks.FirstOrDefault(t => string.Equals(t.TaskKey, origin.SourceTaskKey, StringComparison.Ordinal))?.Content.Sources;
    }

    private static TaskQuestionResolution Refused { get; } = new(TaskQuestionGate.Refused);

    private static TaskQuestionResolution NotTaskFormat { get; } = new(TaskQuestionGate.NotTaskFormat);
}
