using AgriSync.BuildingBlocks.Domain;
using ShramSafal.Domain.Compare;

namespace ShramSafal.Domain.Planning;

public sealed class TemplateActivity : Entity<Guid>
{
    // spec: plr-d10 lane SCH-A — what a schedule row that was never given its days looks like in memory: a one-time work.
    private FrequencyMode _inMemoryMode = FrequencyMode.OneTime;
    private int _inMemoryInterval = 1;

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
        _inMemoryMode = frequencyMode;
        _inMemoryInterval = intervalDays;
    }

    public Guid ScheduleTemplateId { get; private set; }
    public string ActivityName { get; private set; } = string.Empty;

    /// <summary>The first day of the work (the stored <c>offset_days</c>).</summary>
    public int OffsetDays { get; private set; }

    // ── spec: plr-d10 lane SCH-A (Task 1) — the days ShramSafal stores. NULL on every row made before the lane =
    // "days not stored" (such a row is never checkable, R3/P4). ──

    /// <summary>The last day of the work; null = not stored.</summary>
    public int? EndDay { get; private set; }

    /// <summary>The repeat as stored; null = not stored (a reader never mistakes the in-memory default for a stored one).</summary>
    public FrequencyMode? StoredFrequencyMode { get; private set; }

    /// <summary>The interval as stored (every N days, or times a week); null = not stored.</summary>
    public int? StoredIntervalDays { get; private set; }

    /// <summary>The part of work (<see cref="WorkPart"/> by name); null = not stored.</summary>
    public string? Part { get; private set; }

    /// <summary>WORK-ID's operation key (<c>op_*</c>), when the work was recognised; null otherwise.</summary>
    public string? OperationKey { get; private set; }

    /// <summary>R34: the once-only work of THIS row that this one comes after; null = no order.</summary>
    public Guid? AfterActivityId { get; private set; }

    /// <summary>D-104a: <c>fungicide | insecticide | herbicide | pgr | nutrient</c>; ticked by the checker with the row.</summary>
    public string? Role { get; private set; }

    /// <summary>D-104a: the nutrient's key (e.g. <c>npk-0-52-34</c>, <c>boron</c>).</summary>
    public string? NutrientKey { get; private set; }

    public FrequencyMode FrequencyMode => StoredFrequencyMode ?? _inMemoryMode;
    public int IntervalDays => StoredIntervalDays ?? _inMemoryInterval;

    /// <summary>The work's days are all stored: part, start, end and repeat.</summary>
    public bool HasStoredDays =>
        EndDay is not null && StoredFrequencyMode is not null && StoredIntervalDays is not null
        && !string.IsNullOrWhiteSpace(Part);

    internal static TemplateActivity Stored(
        Guid id,
        Guid scheduleTemplateId,
        string activityName,
        int startDay,
        int endDay,
        FrequencyMode mode,
        int intervalDays,
        string part,
        string? operationKey,
        string? role,
        string? nutrientKey,
        Guid? afterActivityId)
    {
        var activity = new TemplateActivity(id, scheduleTemplateId, activityName, startDay, mode, intervalDays)
        {
            EndDay = endDay,
            StoredFrequencyMode = mode,
            StoredIntervalDays = intervalDays,
            Part = part,
            OperationKey = operationKey,
            Role = role,
            NutrientKey = nutrientKey,
            AfterActivityId = afterActivityId,
        };
        return activity;
    }

    /// <summary>The same stored work for a copy: a new id, the order link remapped by the caller.</summary>
    internal TemplateActivity CopyTo(Guid newId, Guid newTemplateId)
    {
        var copy = new TemplateActivity(newId, newTemplateId, ActivityName, OffsetDays, _inMemoryMode, _inMemoryInterval)
        {
            EndDay = EndDay,
            StoredFrequencyMode = StoredFrequencyMode,
            StoredIntervalDays = StoredIntervalDays,
            Part = Part,
            OperationKey = OperationKey,
            Role = Role,
            NutrientKey = NutrientKey,
            AfterActivityId = AfterActivityId,
        };
        return copy;
    }

    internal void RemapAfter(IReadOnlyDictionary<Guid, Guid> newIdByOldId)
    {
        if (AfterActivityId is { } old)
        {
            AfterActivityId = newIdByOldId.TryGetValue(old, out var mapped) ? mapped : null;
        }
    }
}
