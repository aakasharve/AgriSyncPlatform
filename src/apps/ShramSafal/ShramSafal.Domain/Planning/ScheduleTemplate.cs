using AgriSync.BuildingBlocks.Domain;
using ShramSafal.Domain.Events;

namespace ShramSafal.Domain.Planning;

public sealed class ScheduleTemplate : Entity<Guid>
{
    private readonly List<TemplateActivity> _activities = [];

    private ScheduleTemplate() : base(Guid.Empty) { } // EF Core

    private ScheduleTemplate(
        Guid id,
        string name,
        string stage,
        DateTime createdAtUtc)
        : base(id)
    {
        Name = name;
        Stage = stage;
        CreatedAtUtc = createdAtUtc;
    }

    public string Name { get; private set; } = string.Empty;
    public string Stage { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public IReadOnlyCollection<TemplateActivity> Activities => _activities.AsReadOnly();

    public static ScheduleTemplate Create(Guid id, string name, string stage, DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Template name is required.", nameof(name));
        }

        if (string.IsNullOrWhiteSpace(stage))
        {
            throw new ArgumentException("Template stage is required.", nameof(stage));
        }

        return new ScheduleTemplate(id, name.Trim(), stage.Trim(), createdAtUtc);
    }

    public TemplateActivity AddActivity(Guid activityId, string activityName, int offsetDays)
    {
        if (string.IsNullOrWhiteSpace(activityName))
        {
            throw new ArgumentException("Activity name is required.", nameof(activityName));
        }

        var activity = new TemplateActivity(activityId, Id, activityName.Trim(), offsetDays);
        _activities.Add(activity);
        return activity;
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

