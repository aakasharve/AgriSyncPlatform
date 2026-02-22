using AgriSync.BuildingBlocks.Domain;

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
}
