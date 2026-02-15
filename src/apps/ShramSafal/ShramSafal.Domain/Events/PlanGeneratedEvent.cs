using AgriSync.BuildingBlocks.Events;

namespace ShramSafal.Domain.Events;

public sealed class PlanGeneratedEvent : DomainEvent
{
    public PlanGeneratedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid cropCycleId,
        Guid templateId,
        int activitiesCount)
        : base(eventId, occurredOnUtc)
    {
        CropCycleId = cropCycleId;
        TemplateId = templateId;
        ActivitiesCount = activitiesCount;
    }

    public Guid CropCycleId { get; }
    public Guid TemplateId { get; }
    public int ActivitiesCount { get; }
}

