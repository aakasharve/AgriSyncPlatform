using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
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
        UserId? createdByUserId,
        TenantScope tenantScope,
        int version,
        Guid? previousVersionId,
        Guid? derivedFromTemplateId,
        IEnumerable<StageDefinition>? stages = null)
        : base(id)
    {
        Name = name;
        Stage = stage;
        CreatedAtUtc = createdAtUtc;
        CreatedByUserId = createdByUserId;
        TenantScope = tenantScope;
        Version = version;
        PreviousVersionId = previousVersionId;
        DerivedFromTemplateId = derivedFromTemplateId;
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

    // New fields — CEI Phase 1
    public UserId? CreatedByUserId { get; private set; }
    public TenantScope TenantScope { get; private set; } = TenantScope.Public;
    public int Version { get; private set; } = 1;
    public Guid? PreviousVersionId { get; private set; }
    public Guid? DerivedFromTemplateId { get; private set; }
    public DateTime? PublishedAtUtc { get; private set; }

    // Single Create factory. Old callers that passed `stages` positionally must now use
    // named argument `stages:` — but all existing call sites pass only the first 4 params
    // positionally, so they compile without change. New callers use named params for
    // createdByUserId / tenantScope.
    public static ScheduleTemplate Create(
        Guid id,
        string name,
        string stage,
        DateTime createdAtUtc,
        UserId? createdByUserId = null,
        TenantScope tenantScope = TenantScope.Public,
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

        return new ScheduleTemplate(
            id,
            name.Trim(),
            stage.Trim(),
            createdAtUtc,
            createdByUserId,
            tenantScope,
            version: 1,
            previousVersionId: null,
            derivedFromTemplateId: null,
            stages);
    }

    // CEI-I1: copy-on-write edit — produces a NEW template row, original is NOT mutated.
    public ScheduleTemplate EditCopyOnWrite(
        Guid newId,
        string? newName,
        string? newStage,
        UserId editedByUserId,
        DateTime occurredAtUtc)
    {
        var copy = new ScheduleTemplate(
            newId,
            newName is not null ? newName.Trim() : Name,
            newStage is not null ? newStage.Trim() : Stage,
            occurredAtUtc,
            CreatedByUserId,       // author attribution preserved — CEI-I2
            TenantScope,
            version: Version + 1,
            previousVersionId: Id,
            derivedFromTemplateId: null, // edit lineage does not chain root
            _stages.ToList());

        // Copy activities by value onto the new template
        foreach (var a in _activities)
        {
            copy._activities.Add(
                new TemplateActivity(
                    Guid.NewGuid(),
                    newId,
                    a.ActivityName,
                    a.OffsetDays,
                    a.FrequencyMode,
                    a.IntervalDays));
        }

        copy.Raise(new ScheduleTemplateEditedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            newId,
            Id,
            copy.Version,
            editedByUserId));

        return copy;
    }

    // Clone — produces NEW template, preserves root lineage.
    public ScheduleTemplate Clone(
        Guid newId,
        UserId newOwnerUserId,
        TenantScope newScope,
        string reason,
        DateTime occurredAtUtc)
    {
        var copy = new ScheduleTemplate(
            newId,
            Name,
            Stage,
            occurredAtUtc,
            newOwnerUserId,
            newScope,
            version: 1,
            previousVersionId: null,
            derivedFromTemplateId: DerivedFromTemplateId ?? Id, // always points to root
            _stages.ToList());

        foreach (var a in _activities)
        {
            copy._activities.Add(
                new TemplateActivity(
                    Guid.NewGuid(),
                    newId,
                    a.ActivityName,
                    a.OffsetDays,
                    a.FrequencyMode,
                    a.IntervalDays));
        }

        copy.Raise(new ScheduleTemplateClonedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            newId,
            DerivedFromTemplateId ?? Id,
            newOwnerUserId,
            reason));

        return copy;
    }

    // Publish — mutates this template.
    public void Publish(UserId publisherUserId, DateTime occurredAtUtc)
    {
        PublishedAtUtc = occurredAtUtc;
        Raise(new ScheduleTemplatePublishedEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            Version,
            publisherUserId));
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
