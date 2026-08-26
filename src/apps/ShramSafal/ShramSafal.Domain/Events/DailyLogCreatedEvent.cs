using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Domain.Events;

public sealed class DailyLogCreatedEvent : DomainEvent
{
    // LABOUR_PHASE2 P2.1 — the event carries the SAME spatial assertion as the
    // row it describes. Before this change PlotId/CropCycleId were non-nullable,
    // so a farm-wide or multi-plot log would have had to raise an event
    // asserting a plot that does not exist. This is a durable outbox payload:
    // a field not added now can never be back-filled onto historical rows.
    //
    // Legacy payloads written before this change carry no `scope` / `plotIds`
    // members. System.Text.Json gives the missing ctor parameters their default
    // (Plot / null), which is TRUE of every log that existed at that time — the
    // migration classifies all of them as scope='Plot'.
    public DailyLogCreatedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid dailyLogId,
        FarmId farmId,
        DailyLogScope scope,
        IReadOnlyCollection<Guid>? plotIds,
        Guid? plotId,
        Guid? cropCycleId,
        DateOnly logDate)
        : base(eventId, occurredOnUtc)
    {
        DailyLogId = dailyLogId;
        FarmId = farmId;
        Scope = scope;
        PlotIds = plotIds ?? [];
        PlotId = plotId;
        CropCycleId = cropCycleId;
        LogDate = logDate;
    }

    public Guid DailyLogId { get; }
    public FarmId FarmId { get; }

    /// <summary>What the farmer asserted about where this happened.</summary>
    public DailyLogScope Scope { get; }

    /// <summary>
    /// The canonical plot set. Empty for <see cref="DailyLogScope.Farm"/>.
    /// </summary>
    public IReadOnlyCollection<Guid> PlotIds { get; }

    /// <summary>
    /// Compatibility projection — set only for <see cref="DailyLogScope.Plot"/>.
    /// </summary>
    public Guid? PlotId { get; }

    public Guid? CropCycleId { get; }
    public DateOnly LogDate { get; }
}
