using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Schedules;

public sealed class ScheduleMigrationEvent : Entity<Guid>
{
    private ScheduleMigrationEvent() : base(Guid.Empty) { } // EF Core

    private ScheduleMigrationEvent(
        Guid id,
        ScheduleSubscriptionId prevSubscriptionId,
        ScheduleSubscriptionId newSubscriptionId,
        ScheduleTemplateId prevScheduleId,
        ScheduleTemplateId newScheduleId,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        DateTime migratedAtUtc,
        ScheduleMigrationReason reason,
        string? reasonText,
        decimal complianceAtMigrationPct,
        UserId actorUserId)
        : base(id)
    {
        PrevSubscriptionId = prevSubscriptionId;
        NewSubscriptionId = newSubscriptionId;
        PrevScheduleId = prevScheduleId;
        NewScheduleId = newScheduleId;
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        MigratedAtUtc = migratedAtUtc;
        Reason = reason;
        ReasonText = reasonText;
        ComplianceAtMigrationPct = complianceAtMigrationPct;
        ActorUserId = actorUserId;
    }

    public Guid EventId => Id;
    public ScheduleSubscriptionId PrevSubscriptionId { get; private set; }
    public ScheduleSubscriptionId NewSubscriptionId { get; private set; }
    public ScheduleTemplateId PrevScheduleId { get; private set; }
    public ScheduleTemplateId NewScheduleId { get; private set; }
    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public DateTime MigratedAtUtc { get; private set; }
    public ScheduleMigrationReason Reason { get; private set; }
    public string? ReasonText { get; private set; }
    public decimal ComplianceAtMigrationPct { get; private set; }
    public UserId ActorUserId { get; private set; }

    public static ScheduleMigrationEvent Record(
        Guid id,
        ScheduleSubscriptionId prevSubscriptionId,
        ScheduleSubscriptionId newSubscriptionId,
        ScheduleTemplateId prevScheduleId,
        ScheduleTemplateId newScheduleId,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        DateTime migratedAtUtc,
        ScheduleMigrationReason reason,
        string? reasonText,
        decimal complianceAtMigrationPct,
        UserId actorUserId)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("EventId is required.", nameof(id));
        }

        if (prevSubscriptionId.IsEmpty)
        {
            throw new ArgumentException("Previous subscription id is required.", nameof(prevSubscriptionId));
        }

        if (newSubscriptionId.IsEmpty)
        {
            throw new ArgumentException("New subscription id is required.", nameof(newSubscriptionId));
        }

        if (prevSubscriptionId.Value == newSubscriptionId.Value)
        {
            throw new InvalidOperationException("Migration event requires distinct prev and new subscription ids.");
        }

        if (prevScheduleId.IsEmpty)
        {
            throw new ArgumentException("Previous schedule id is required.", nameof(prevScheduleId));
        }

        if (newScheduleId.IsEmpty)
        {
            throw new ArgumentException("New schedule id is required.", nameof(newScheduleId));
        }

        if (farmId.IsEmpty)
        {
            throw new ArgumentException("FarmId is required.", nameof(farmId));
        }

        if (plotId == Guid.Empty)
        {
            throw new ArgumentException("PlotId is required.", nameof(plotId));
        }

        if (cropCycleId == Guid.Empty)
        {
            throw new ArgumentException("CropCycleId is required.", nameof(cropCycleId));
        }

        if (actorUserId.IsEmpty)
        {
            throw new ArgumentException("ActorUserId is required.", nameof(actorUserId));
        }

        if (complianceAtMigrationPct < 0m || complianceAtMigrationPct > 100m)
        {
            throw new ArgumentException(
                "Compliance percentage must be between 0 and 100.",
                nameof(complianceAtMigrationPct));
        }

        return new ScheduleMigrationEvent(
            id,
            prevSubscriptionId,
            newSubscriptionId,
            prevScheduleId,
            newScheduleId,
            farmId,
            plotId,
            cropCycleId,
            migratedAtUtc,
            reason,
            string.IsNullOrWhiteSpace(reasonText) ? null : reasonText.Trim(),
            complianceAtMigrationPct,
            actorUserId);
    }
}
