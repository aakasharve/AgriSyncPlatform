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
        DateTime occurredAtUtc,
        ExecutionStatus executionStatus = ExecutionStatus.Completed,
        string? deviationReasonCode = null,
        string? deviationNote = null)
        : base(id)
    {
        DailyLogId = dailyLogId;
        ActivityType = activityType;
        Notes = notes;
        OccurredAtUtc = occurredAtUtc;
        ExecutionStatus = executionStatus;

        // Invariant: if status != Completed, DeviationReasonCode must be non-empty
        // If status == Completed, DeviationReasonCode and DeviationNote must be null
        if (executionStatus != ExecutionStatus.Completed && string.IsNullOrWhiteSpace(deviationReasonCode))
            throw new ArgumentException("DeviationReasonCode is required when ExecutionStatus is not Completed.", nameof(deviationReasonCode));

        if (executionStatus == ExecutionStatus.Completed && !string.IsNullOrWhiteSpace(deviationReasonCode))
            throw new ArgumentException("DeviationReasonCode must be null when ExecutionStatus is Completed.", nameof(deviationReasonCode));

        DeviationReasonCode = string.IsNullOrWhiteSpace(deviationReasonCode) ? null : deviationReasonCode.Trim();
        DeviationNote = string.IsNullOrWhiteSpace(deviationNote) ? null : deviationNote.Trim();
    }

    public Guid DailyLogId { get; private set; }
    public string ActivityType { get; private set; } = string.Empty;
    public string? Notes { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
    public ExecutionStatus ExecutionStatus { get; private set; } = ExecutionStatus.Completed;
    public string? DeviationReasonCode { get; private set; }  // non-null when status != Completed
    public string? DeviationNote { get; private set; }

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
