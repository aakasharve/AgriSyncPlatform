using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Schedules;

public sealed class ScheduleSubscription : Entity<Guid>
{
    private ScheduleSubscription() : base(Guid.Empty) { } // EF Core

    private ScheduleSubscription(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        string cropKey,
        ScheduleTemplateId templateId,
        string scheduleVersionTag,
        DateTime adoptedAtUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        CropKey = cropKey;
        ScheduleTemplateId = templateId;
        ScheduleVersionTag = scheduleVersionTag;
        AdoptedAtUtc = adoptedAtUtc;
        State = ScheduleSubscriptionState.Active;
    }

    public ScheduleSubscriptionId SubscriptionId => new(Id);
    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }
    public string CropKey { get; private set; } = string.Empty;
    public ScheduleTemplateId ScheduleTemplateId { get; private set; }
    public string ScheduleVersionTag { get; private set; } = string.Empty;
    public DateTime AdoptedAtUtc { get; private set; }
    public ScheduleSubscriptionState State { get; private set; }
    public ScheduleSubscriptionId? MigratedFromSubscriptionId { get; private set; }
    public ScheduleSubscriptionId? MigratedToSubscriptionId { get; private set; }
    public ScheduleMigrationReason? MigrationReason { get; private set; }
    public DateTime? StateChangedAtUtc { get; private set; }

    public static ScheduleSubscription Adopt(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        string cropKey,
        ScheduleTemplateId templateId,
        string scheduleVersionTag,
        DateTime adoptedAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Subscription id is required.", nameof(id));
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

        if (string.IsNullOrWhiteSpace(cropKey))
        {
            throw new ArgumentException("Crop key is required.", nameof(cropKey));
        }

        if (templateId.IsEmpty)
        {
            throw new ArgumentException("Template id is required.", nameof(templateId));
        }

        if (string.IsNullOrWhiteSpace(scheduleVersionTag))
        {
            throw new ArgumentException("Version tag is required.", nameof(scheduleVersionTag));
        }

        return new ScheduleSubscription(
            id,
            farmId,
            plotId,
            cropCycleId,
            cropKey.Trim().ToLowerInvariant(),
            templateId,
            scheduleVersionTag.Trim(),
            adoptedAtUtc);
    }

    public void Migrate(
        ScheduleSubscriptionId newSubscriptionId,
        ScheduleMigrationReason reason,
        DateTime utcNow)
    {
        if (State != ScheduleSubscriptionState.Active)
        {
            throw new InvalidOperationException(
                $"Only an Active subscription can be migrated; current state is {State}.");
        }

        if (newSubscriptionId.IsEmpty)
        {
            throw new ArgumentException("New subscription id is required.", nameof(newSubscriptionId));
        }

        if (newSubscriptionId.Value == Id)
        {
            throw new InvalidOperationException("A subscription cannot migrate to itself.");
        }

        State = ScheduleSubscriptionState.Migrated;
        MigrationReason = reason;
        MigratedToSubscriptionId = newSubscriptionId;
        StateChangedAtUtc = utcNow;
    }

    public void Abandon(DateTime utcNow)
    {
        if (State != ScheduleSubscriptionState.Active)
        {
            throw new InvalidOperationException(
                $"Only an Active subscription can be abandoned; current state is {State}.");
        }

        State = ScheduleSubscriptionState.Abandoned;
        StateChangedAtUtc = utcNow;
    }

    public void Complete(DateTime utcNow)
    {
        if (State != ScheduleSubscriptionState.Active)
        {
            throw new InvalidOperationException(
                $"Only an Active subscription can be completed; current state is {State}.");
        }

        State = ScheduleSubscriptionState.Completed;
        StateChangedAtUtc = utcNow;
    }

    public void AttachMigratedFrom(ScheduleSubscriptionId previousId)
    {
        if (MigratedFromSubscriptionId is not null)
        {
            throw new InvalidOperationException("MigratedFromSubscriptionId is already set.");
        }

        if (previousId.IsEmpty)
        {
            throw new ArgumentException("Previous subscription id is required.", nameof(previousId));
        }

        MigratedFromSubscriptionId = previousId;
    }
}
