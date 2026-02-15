using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Planning;

public sealed class TemplateActivity : Entity<Guid>
{
    private TemplateActivity() : base(Guid.Empty) { } // EF Core

    internal TemplateActivity(
        Guid id,
        Guid scheduleTemplateId,
        string activityName,
        int offsetDays)
        : base(id)
    {
        ScheduleTemplateId = scheduleTemplateId;
        ActivityName = activityName;
        OffsetDays = offsetDays;
    }

    public Guid ScheduleTemplateId { get; private set; }
    public string ActivityName { get; private set; } = string.Empty;
    public int OffsetDays { get; private set; }
}

