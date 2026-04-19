using ShramSafal.Application.Ports;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// Default implementation of <see cref="IScheduleComplianceService"/>.
/// Matches a logged (taskType + stage) against the active subscription's template tasks
/// using a window of max(tolerance, <see cref="DefaultMatchWindowDays"/>) days. The closest
/// task by absolute day-delta wins. The classification (Early / OnTime / Late) is bounded
/// by the *task's* tolerance, not the match window — a wide window only decides which task
/// is the candidate; the verdict stays strict.
/// </summary>
public sealed class ScheduleComplianceService(IShramSafalRepository repo) : IScheduleComplianceService
{
    public const int DefaultMatchWindowDays = 5;

    public async Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var cycle = await repo.GetCropCycleByIdAsync(query.CropCycleId, ct);
        if (cycle is null)
        {
            return ComplianceResult.Unscheduled();
        }

        var active = await repo.GetActiveScheduleSubscriptionAsync(
            cycle.PlotId,
            cycle.CropName,
            cycle.Id,
            ct);
        if (active is null)
        {
            return ComplianceResult.Unscheduled();
        }

        var template = await repo.GetCropScheduleTemplateByIdAsync(active.ScheduleTemplateId, ct);
        if (template is null || template.Tasks.Count == 0)
        {
            return ComplianceResult.Unscheduled();
        }

        var normalizedType = query.TaskType.Trim().ToLowerInvariant();
        var normalizedStage = query.Stage.Trim().ToLowerInvariant();
        var loggedDayOffset = query.LoggedOn.DayNumber - cycle.StartDate.DayNumber;

        PrescribedTask? bestMatch = null;
        var bestAbsDelta = int.MaxValue;

        foreach (var task in template.Tasks)
        {
            if (task.TaskType != normalizedType || task.Stage != normalizedStage)
            {
                continue;
            }

            var window = Math.Max(task.ToleranceDaysPlusMinus, DefaultMatchWindowDays);
            var delta = loggedDayOffset - task.DayOffsetFromCycleStart;
            var absDelta = Math.Abs(delta);

            if (absDelta > window)
            {
                continue;
            }

            if (absDelta < bestAbsDelta)
            {
                bestAbsDelta = absDelta;
                bestMatch = task;
            }
        }

        if (bestMatch is null)
        {
            return ComplianceResult.Unscheduled();
        }

        var finalDelta = loggedDayOffset - bestMatch.DayOffsetFromCycleStart;
        return ComplianceResult.Matched(
            active.SubscriptionId,
            bestMatch.Id,
            finalDelta,
            bestMatch.ToleranceDaysPlusMinus);
    }
}
