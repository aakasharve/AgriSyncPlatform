using AgriSync.BuildingBlocks.Domain;
using ShramSafal.Domain.Schedules;

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

    /// <summary>
    /// Schedule compliance stamped on this task when it was created. Null means the
    /// evaluator was never run (legacy task) or evaluation returned no match.
    /// Invariant I-17: once stamped, immutable.
    /// </summary>
    public ComplianceResult? Compliance { get; private set; }

    public void StampCompliance(ComplianceResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (Compliance is not null)
        {
            throw new InvalidOperationException("Compliance is immutable once stamped (I-17).");
        }

        Compliance = result;
    }
}
