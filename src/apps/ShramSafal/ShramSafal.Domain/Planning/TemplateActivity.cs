using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Planning;

public sealed class TemplateActivity : Entity<Guid>
{
    private TemplateActivity() : base(Guid.Empty) { } // EF Core

    internal TemplateActivity(
        Guid id,
        Guid scheduleTemplateId,
        string activityName,
        int offsetDays,
        FrequencyMode frequencyMode,
        int intervalDays)
        : base(id)
    {
        ScheduleTemplateId = scheduleTemplateId;
        ActivityName = activityName;
        OffsetDays = offsetDays;
        FrequencyMode = frequencyMode;
        IntervalDays = intervalDays;
    }

    public Guid ScheduleTemplateId { get; private set; }
    public string ActivityName { get; private set; } = string.Empty;
    public int OffsetDays { get; private set; }
    public FrequencyMode FrequencyMode { get; private set; } = FrequencyMode.OneTime;
    public int IntervalDays { get; private set; } = 1;
}
