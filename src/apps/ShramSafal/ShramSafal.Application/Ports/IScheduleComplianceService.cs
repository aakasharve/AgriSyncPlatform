using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Stamps a <see cref="ComplianceResult"/> on a log or task as it is being recorded.
/// Returns <see cref="ComplianceResult.Unscheduled"/> when the plot-crop-cycle has no
/// Active <see cref="ScheduleSubscription"/>. Otherwise matches against the subscription's
/// template using (task-type + stage) within a tolerance window and classifies the delta
/// as Early / OnTime / Late per invariant I-17.
/// </summary>
public interface IScheduleComplianceService
{
    Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default);
}

public sealed record ScheduleComplianceQuery(
    Guid CropCycleId,
    string TaskType,
    string Stage,
    DateOnly LoggedOn);
