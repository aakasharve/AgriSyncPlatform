using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

public sealed class PlanOverriddenEvent : DomainEvent
{
    public PlanOverriddenEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid plannedActivityId,
        Guid cropCycleId,
        string[] fieldsChanged,
        string reason,
        UserId overriddenByUserId)
        : base(eventId, occurredOnUtc)
    {
        PlannedActivityId = plannedActivityId;
        CropCycleId = cropCycleId;
        FieldsChanged = fieldsChanged;
        Reason = reason;
        OverriddenByUserId = overriddenByUserId;
    }

    public Guid PlannedActivityId { get; }
    public Guid CropCycleId { get; }
    public string[] FieldsChanged { get; }
    public string Reason { get; }
    public UserId OverriddenByUserId { get; }
}
