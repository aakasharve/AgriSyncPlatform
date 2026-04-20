using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

public sealed class PlannedActivity : Entity<Guid>
{
    private PlannedActivity() : base(Guid.Empty) { } // EF Core

    private PlannedActivity(
        Guid id,
        Guid cropCycleId,
        string activityName,
        string stage,
        DateOnly plannedDate,
        DateTime createdAtUtc)
        : base(id)
    {
        CropCycleId = cropCycleId;
        ActivityName = activityName;
        Stage = stage;
        PlannedDate = plannedDate;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public Guid CropCycleId { get; private set; }
    public string ActivityName { get; private set; } = string.Empty;
    public string Stage { get; private set; } = string.Empty;
    public DateOnly PlannedDate { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    // CEI-I3: SourceTemplateActivityId has no public setter (immutable once set)
    public Guid? SourceTemplateActivityId { get; private set; }
    public string? OverrideReason { get; private set; }
    public UserId? OverriddenByUserId { get; private set; }
    public DateTime? OverriddenAtUtc { get; private set; }
    public bool IsLocallyAdded => SourceTemplateActivityId is null;
    public bool IsLocallyChanged => OverrideReason is not null;

    // Soft delete fields
    public DateTime? RemovedAtUtc { get; private set; }
    public UserId? RemovedByUserId { get; private set; }
    public string? RemovedReason { get; private set; }
    public bool IsRemoved => RemovedAtUtc is not null;

    [Obsolete("Use CreateFromTemplate or CreateLocallyAdded")]
    public static PlannedActivity Create(
        Guid id,
        Guid cropCycleId,
        string activityName,
        string stage,
        DateOnly plannedDate,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(activityName))
        {
            throw new ArgumentException("Activity name is required.", nameof(activityName));
        }

        if (string.IsNullOrWhiteSpace(stage))
        {
            throw new ArgumentException("Stage is required.", nameof(stage));
        }

        return new PlannedActivity(
            id,
            cropCycleId,
            activityName.Trim(),
            stage.Trim(),
            plannedDate,
            createdAtUtc);
    }

    // For activities generated from a template (stamps the source activity id)
    public static PlannedActivity CreateFromTemplate(
        Guid id,
        Guid cropCycleId,
        string activityName,
        string stage,
        DateOnly plannedDate,
        Guid sourceTemplateActivityId,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(activityName))
            throw new ArgumentException("Activity name is required.", nameof(activityName));

        if (string.IsNullOrWhiteSpace(stage))
            throw new ArgumentException("Stage is required.", nameof(stage));

        if (sourceTemplateActivityId == Guid.Empty)
            throw new ArgumentException("Source template activity ID is required.", nameof(sourceTemplateActivityId));

        var activity = new PlannedActivity(id, cropCycleId, activityName.Trim(), stage.Trim(), plannedDate, createdAtUtc);
        activity.SourceTemplateActivityId = sourceTemplateActivityId;
        return activity;
    }

    // For activities added locally on a specific farm/crop cycle (not from template)
    public static PlannedActivity CreateLocallyAdded(
        Guid id,
        Guid cropCycleId,
        string activityName,
        string stage,
        DateOnly plannedDate,
        UserId addedByUserId,
        string reason,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(activityName))
            throw new ArgumentException("Activity name is required.", nameof(activityName));

        if (string.IsNullOrWhiteSpace(stage))
            throw new ArgumentException("Stage is required.", nameof(stage));

        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("Reason is required for locally-added activities.", nameof(reason));

        var activity = new PlannedActivity(id, cropCycleId, activityName.Trim(), stage.Trim(), plannedDate, createdAtUtc);
        // SourceTemplateActivityId stays null — it's locally added
        activity.OverrideReason = reason.Trim();
        activity.OverriddenByUserId = addedByUserId;
        activity.OverriddenAtUtc = createdAtUtc;
        return activity;
    }

    // Shift date / rename / restage. Emits PlanOverriddenEvent.
    public void Override(
        DateOnly? newPlannedDate,
        string? newActivityName,
        string? newStage,
        UserId userId,
        string reason,
        DateTime occurredAtUtc)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("Override reason is required.", nameof(reason));

        var fieldsChanged = new List<string>();

        if (newPlannedDate.HasValue && newPlannedDate.Value != PlannedDate)
        {
            PlannedDate = newPlannedDate.Value;
            fieldsChanged.Add("plannedDate");
        }
        if (!string.IsNullOrWhiteSpace(newActivityName) && newActivityName.Trim() != ActivityName)
        {
            ActivityName = newActivityName.Trim();
            fieldsChanged.Add("activityName");
        }
        if (!string.IsNullOrWhiteSpace(newStage) && newStage.Trim() != Stage)
        {
            Stage = newStage.Trim();
            fieldsChanged.Add("stage");
        }

        OverrideReason = reason.Trim();
        OverriddenByUserId = userId;
        OverriddenAtUtc = occurredAtUtc;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new PlanOverriddenEvent(
            Guid.NewGuid(),
            occurredAtUtc,
            Id,
            CropCycleId,
            fieldsChanged.ToArray(),
            reason.Trim(),
            userId));
    }

    // Soft-remove a template-derived activity (alternative to hard-delete for derived rows)
    public void SoftRemove(UserId removedByUserId, string reason, DateTime occurredAtUtc)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("Reason is required for removal.", nameof(reason));

        RemovedAtUtc = occurredAtUtc;
        RemovedByUserId = removedByUserId;
        RemovedReason = reason.Trim();
        ModifiedAtUtc = occurredAtUtc;
    }
}
