using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Tests;

public sealed class TestInstanceReportedEvent : DomainEvent
{
    public TestInstanceReportedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid testInstanceId,
        UserId reportedByUserId,
        int resultCount,
        int attachmentCount)
        : base(eventId, occurredOnUtc)
    {
        TestInstanceId = testInstanceId;
        ReportedByUserId = reportedByUserId;
        ResultCount = resultCount;
        AttachmentCount = attachmentCount;
    }

    public Guid TestInstanceId { get; }
    public UserId ReportedByUserId { get; }
    public int ResultCount { get; }
    public int AttachmentCount { get; }
}
