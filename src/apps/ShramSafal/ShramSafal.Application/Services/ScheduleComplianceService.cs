using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Compare;
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

        // spec: plr-d10 lane L8b-3 (R6, D-76) - a plot-season may follow several schedules (3 + 1); a record is measured against the
        // मुख्य one, the same pick the pull sends. One followed schedule is that one (no lookups).
        var followed = await repo.GetActiveScheduleSubscriptionsAsync(cycle.PlotId, cycle.Id, ct);
        var active = followed.Count <= 1
            ? followed.FirstOrDefault()
            : MainSchedule.Pick(followed, await MainScheduleFactsReader.FromRepositoryAsync(repo, followed.Select(s => s.ScheduleTemplateId).ToList(), ct));
        if (active is null)
        {
            return ComplianceResult.Unscheduled();
        }

        var template = await repo.GetCropScheduleTemplateByIdAsync(active.ScheduleTemplateId, ct);
        if (template is null || template.Tasks.Count == 0)
        {
            // spec: plr-d10 lane CMP-D2 - a LIBRARY schedule (schedule_templates) is not in the old model: it used to stamp every record
            // "Unscheduled". It is read from its row, counting from the subscription's own day 0.
            return await EvaluateLibraryAsync(query, cycle, active, ct);
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

    /// <summary>
    /// A library row that STORES its days: the nearest stored day of the SAME work (WORK-ID, either language) within the match window wins. A row
    /// that stores no days, or work that is not in it, is "Unscheduled" - never a guess from the name (P4).
    /// </summary>
    private async Task<ComplianceResult> EvaluateLibraryAsync(
        ScheduleComplianceQuery query, Domain.Crops.CropCycle cycle, ScheduleSubscription active, CancellationToken ct)
    {
        var row = await repo.GetScheduleTemplateByIdAsync(active.ScheduleTemplateId.Value, ct);
        if (row is null || !row.HasStoredDays)
        {
            return ComplianceResult.Unscheduled();
        }

        var dayZero = active.ReferenceDate ?? cycle.StartDate;
        ExpectedStep? best = null;
        var bestAbs = int.MaxValue;
        foreach (var step in ScheduleFollowEngine.Expand(ScheduleDefinitionMapper.FromRow(row), dayZero))
        {
            var abs = Math.Abs(query.LoggedOn.DayNumber - step.Date.DayNumber);
            if (abs > DefaultMatchWindowDays || abs >= bestAbs || !WorkRecogniser.SameWork(step.Title, query.TaskType).Matched)
            {
                continue;
            }

            best = step;
            bestAbs = abs;
        }

        // fix round 1 (P006): a library schedule keeps no per-work tolerance (the old model did); the stamp reads the ONE shared
        // on-time constant (the attention board's, ScheduledWorkMatcher), read-only - लक्ष द्या keeps its own day rule and तुलना reads none (R35).
        return best is null
            ? ComplianceResult.Unscheduled()
            : ComplianceResult.Matched(
                active.SubscriptionId,
                new PrescribedTaskId(best.ActivityId),
                query.LoggedOn.DayNumber - best.Date.DayNumber,
                ScheduledWorkMatcher.OnTimeToleranceDays);
    }
}
