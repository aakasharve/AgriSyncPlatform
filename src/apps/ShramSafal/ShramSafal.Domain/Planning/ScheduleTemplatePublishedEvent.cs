using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

public sealed class ScheduleTemplatePublishedEvent : DomainEvent
{
    public ScheduleTemplatePublishedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid templateId,
        int version,
        UserId publishedByUserId)
        : base(eventId, occurredOnUtc)
    {
        TemplateId = templateId;
        Version = version;
        PublishedByUserId = publishedByUserId;
    }

    public Guid TemplateId { get; }
    public int Version { get; }
    public UserId PublishedByUserId { get; }
}
