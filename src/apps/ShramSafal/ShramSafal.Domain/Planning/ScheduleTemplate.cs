using AgriSync.BuildingBlocks.Domain;
using ShramSafal.Domain.Events;

namespace ShramSafal.Domain.Planning;

public sealed class ScheduleTemplate : Entity<Guid>
{
    private readonly List<TemplateActivity> _activities = [];
    private readonly List<StageDefinition> _stages = [];

    private ScheduleTemplate() : base(Guid.Empty) { } // EF Core

    private ScheduleTemplate(
        Guid id,
        string name,
        string stage,
        DateTime createdAtUtc,
        IEnumerable<StageDefinition>? stages = null)
        : base(id)
    {
        Name = name;
        Stage = stage;
        CreatedAtUtc = createdAtUtc;
        if (stages is not null)
        {
            _stages.AddRange(
                stages
                    .Where(s => !string.IsNullOrWhiteSpace(s.Name))
                    .OrderBy(s => s.StartDay)
                    .ThenBy(s => s.EndDay));
        }
    }

    public string Name { get; private set; } = string.Empty;
    public string Stage { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public IReadOnlyCollection<TemplateActivity> Activities => _activities.AsReadOnly();
    public IReadOnlyCollection<StageDefinition> Stages => _stages.AsReadOnly();

    public static ScheduleTemplate Create(
        Guid id,
        string name,
        string stage,
        DateTime createdAtUtc,
        IReadOnlyCollection<StageDefinition>? stages = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Template name is required.", nameof(name));
        }

        if (string.IsNullOrWhiteSpace(stage))
        {
            throw new ArgumentException("Template stage is required.", nameof(stage));
        }

        return new ScheduleTemplate(id, name.Trim(), stage.Trim(), createdAtUtc, stages);
    }

    public TemplateActivity AddActivity(
        Guid activityId,
        string activityName,
        int offsetDays,
        FrequencyMode frequencyMode = FrequencyMode.OneTime,
        int intervalDays = 1)
    {
        if (string.IsNullOrWhiteSpace(activityName))
        {
            throw new ArgumentException("Activity name is required.", nameof(activityName));
        }

        if (intervalDays <= 0)
        {
            throw new ArgumentException("Interval days must be greater than zero.", nameof(intervalDays));
        }

        var activity = new TemplateActivity(
            activityId,
            Id,
            activityName.Trim(),
            offsetDays,
            frequencyMode,
            intervalDays);
        _activities.Add(activity);
        return activity;
    }

    public void AddStage(StageDefinition stageDefinition)
    {
        if (string.IsNullOrWhiteSpace(stageDefinition.Name))
        {
            throw new ArgumentException("Stage name is required.", nameof(stageDefinition));
        }

        _stages.Add(stageDefinition);
        _stages.Sort((a, b) =>
        {
            var byStart = a.StartDay.CompareTo(b.StartDay);
            if (byStart != 0)
            {
                return byStart;
            }

            return a.EndDay.CompareTo(b.EndDay);
        });
    }

    public void MarkGenerated(Guid cropCycleId, DateTime occurredAtUtc)
    {
        Raise(new PlanGeneratedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            cropCycleId,
            Id,
            _activities.Count));
    }
}
