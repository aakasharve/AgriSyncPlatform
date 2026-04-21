using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

public sealed class ScheduleTemplateEditedEvent : DomainEvent
{
    public ScheduleTemplateEditedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid templateId,
        Guid previousVersionId,
        int newVersion,
        UserId editedByUserId)
        : base(eventId, occurredOnUtc)
    {
        TemplateId = templateId;
        PreviousVersionId = previousVersionId;
        NewVersion = newVersion;
        EditedByUserId = editedByUserId;
    }

    public Guid TemplateId { get; }
    public Guid PreviousVersionId { get; }
    public int NewVersion { get; }
    public UserId EditedByUserId { get; }
}
