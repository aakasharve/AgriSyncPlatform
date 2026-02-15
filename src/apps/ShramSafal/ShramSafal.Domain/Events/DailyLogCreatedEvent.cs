using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Events;

public sealed class DailyLogCreatedEvent : DomainEvent
{
    public DailyLogCreatedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid dailyLogId,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        DateOnly logDate)
        : base(eventId, occurredOnUtc)
    {
        DailyLogId = dailyLogId;
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        LogDate = logDate;
    }

    public Guid DailyLogId { get; }
    public FarmId FarmId { get; }
    public Guid PlotId { get; }
    public Guid CropCycleId { get; }
    public DateOnly LogDate { get; }
}
