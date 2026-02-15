using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Logs;

public sealed class LogTask : Entity<Guid>
{
    private LogTask() : base(Guid.Empty) { } // EF Core

    internal LogTask(
        Guid id,
        Guid dailyLogId,
        string activityType,
        string? notes,
        DateTime occurredAtUtc)
        : base(id)
    {
        DailyLogId = dailyLogId;
        ActivityType = activityType;
        Notes = notes;
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid DailyLogId { get; private set; }
    public string ActivityType { get; private set; } = string.Empty;
    public string? Notes { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
}

