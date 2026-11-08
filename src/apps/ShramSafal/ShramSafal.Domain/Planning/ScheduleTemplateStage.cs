using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 1) — one stage of a schedule row, STORED (<c>ssf.schedule_template_stages</c>): its
/// name and its day range. Before the lane the stages were not persisted (the library invented them by an equal split).
/// </summary>
public sealed class ScheduleTemplateStage : Entity<Guid>
{
    private ScheduleTemplateStage() : base(Guid.Empty) { } // EF Core

    internal ScheduleTemplateStage(Guid id, Guid scheduleTemplateId, int orderIndex, string name, int startDay, int endDay)
        : base(id)
    {
        ScheduleTemplateId = scheduleTemplateId;
        OrderIndex = orderIndex;
        Name = name;
        StartDay = startDay;
        EndDay = endDay;
    }

    public Guid ScheduleTemplateId { get; private set; }
    public int OrderIndex { get; internal set; }
    public string Name { get; private set; } = string.Empty;
    public int StartDay { get; private set; }
    public int EndDay { get; private set; }

    public StageDefinition ToDefinition() => new(Name, StartDay, EndDay);
}
