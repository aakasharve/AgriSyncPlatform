using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Planning;

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
        DateTime adoptedAtUtc,
        DateOnly? referenceDate,
        ScheduleOrigin? origin,
        ScheduleCheckState? checkStateAtAdopt,
        short? slot)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        CropKey = cropKey;
        ScheduleTemplateId = templateId;
        ScheduleVersionTag = scheduleVersionTag;
        AdoptedAtUtc = adoptedAtUtc;
        ReferenceDate = referenceDate;
        Origin = origin;
        CheckStateAtAdopt = checkStateAtAdopt;
        Slot = slot;
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

    /// <summary>
    /// spec: plr-d10 lane L8b-1 — the plot's day 0 the farmer set in "शेड्यूल बदला" (a pruning or planting day), from which
    /// the schedule's days count. <c>null</c> = the crop cycle's own start date (every subscription made before this lane,
    /// and every phone that does not send one: P11).
    /// </summary>
    public DateOnly? ReferenceDate { get; private set; }

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (R5) - whose schedule this is. <c>null</c> = chosen before this lane; read as
    /// <see cref="ScheduleOrigin.Outside"/> (L8b-3 backfills it, so no row has none once that migration has run).
    /// </summary>
    public ScheduleOrigin? Origin { get; private set; }

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (R7) - what ShramSafal's check said when this was chosen: <see cref="ScheduleCheckState.Checked"/> or
    /// <see cref="ScheduleCheckState.NotChecked"/> (a sample, or a choice carried over from a phone). <c>null</c> = chosen before
    /// this lane. A later withdrawal never changes it (R8): the live state is read from the schedule.
    /// </summary>
    public ScheduleCheckState? CheckStateAtAdopt { get; private set; }

    /// <summary>
    /// spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the place this schedule holds on its plot-season: 0 = his own, 1..3 = an
    /// outside schedule (<see cref="ScheduleSlots"/>). <c>null</c> = made by a binary that sets none (a row chosen before this lane
    /// that is not Active any more, or one the deployed 1.0.17 server wrote); the pick reads it after every row that has a place.
    /// The database holds the places of Active rows unique; the place stays on a row that is no longer Active.
    /// </summary>
    public short? Slot { get; private set; }

    public static ScheduleSubscription Adopt(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid cropCycleId,
        string cropKey,
        ScheduleTemplateId templateId,
        string scheduleVersionTag,
        DateTime adoptedAtUtc,
        DateOnly? referenceDate = null,
        ScheduleOrigin? origin = null,
        ScheduleCheckState? checkStateAtAdopt = null,
        short? slot = null)
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

        if (checkStateAtAdopt is not (null or ScheduleCheckState.Checked or ScheduleCheckState.NotChecked))
        {
            throw new ArgumentException("Only Checked or NotChecked can be recorded at adoption.", nameof(checkStateAtAdopt));
        }

        if (slot is { } place)
        {
            if (!ScheduleSlots.IsValid(place))
            {
                throw new ArgumentException("A place is 0 (his own) or 1 to 3 (outside).", nameof(slot));
            }

            // The database says the same (ck_sched_sub_slot_origin): his own schedule is place 0 and nothing else is.
            if (origin is null || (origin == ScheduleOrigin.Own) != (place == ScheduleSlots.OwnSlot))
            {
                throw new ArgumentException("Place 0 is for his own schedule only, and his own schedule holds place 0 only.", nameof(slot));
            }
        }

        return new ScheduleSubscription(
            id,
            farmId,
            plotId,
            cropCycleId,
            cropKey.Trim().ToLowerInvariant(),
            templateId,
            scheduleVersionTag.Trim(),
            adoptedAtUtc,
            referenceDate,
            origin,
            checkStateAtAdopt,
            slot);
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
