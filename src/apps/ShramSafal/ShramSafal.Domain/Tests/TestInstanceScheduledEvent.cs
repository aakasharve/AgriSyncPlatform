using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Tests;

public sealed class TestInstanceScheduledEvent : DomainEvent
{
    public TestInstanceScheduledEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid testInstanceId,
        Guid testProtocolId,
        Guid cropCycleId,
        FarmId farmId,
        Guid plotId,
        string stageName,
        DateOnly plannedDueDate)
        : base(eventId, occurredOnUtc)
    {
        TestInstanceId = testInstanceId;
        TestProtocolId = testProtocolId;
        CropCycleId = cropCycleId;
        FarmId = farmId;
        PlotId = plotId;
        StageName = stageName;
        PlannedDueDate = plannedDueDate;
    }

    public Guid TestInstanceId { get; }
    public Guid TestProtocolId { get; }
    public Guid CropCycleId { get; }
    public FarmId FarmId { get; }
    public Guid PlotId { get; }
    public string StageName { get; }
    public DateOnly PlannedDueDate { get; }
}
