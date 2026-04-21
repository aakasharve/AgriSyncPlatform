using System.Text.Json;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Domain.Compliance;

public static class ComplianceRuleBook
{
    public static readonly IReadOnlyList<ComplianceRule> Rules = new[]
    {
        new ComplianceRule(
            ComplianceRuleCode.MissedTaskThresholdWeek,
            ComplianceSeverity.NeedsAttention,
            ComplianceSuggestedAction.ScheduleMissingActivity,
            "Three or more tasks missed this week",
            "या आठवड्यात ३ किंवा जास्त कामं राहिली",
            input =>
            {
                // Group planned activities by crop cycle and count tasks that were NOT completed/modified
                var completedOrModifiedIds = input.LogTasksLastWeek
                    .Where(t => t.ExecutionStatus == ExecutionStatus.Completed || t.ExecutionStatus == ExecutionStatus.Modified)
                    .Select(t => t.DailyLogId)
                    .ToHashSet();

                var missedByCycle = input.PlannedActivitiesLastWeek
                    .GroupBy(p => p.CropCycleId)
                    .Select(g =>
                    {
                        var planned = g.Count();
                        var completed = input.LogTasksLastWeek
                            .Where(t => t.ExecutionStatus == ExecutionStatus.Completed || t.ExecutionStatus == ExecutionStatus.Modified)
                            .Count();
                        var missed = Math.Max(0, planned - completed);
                        var plotId = input.Plots.FirstOrDefault(p => input.DailyLogs
                            .Any(d => d.CropCycleId == g.Key && d.PlotId == p.Id))?.Id ?? Guid.Empty;
                        return (CropCycleId: g.Key, PlotId: plotId, Missed: missed);
                    })
                    .Where(x => x.Missed >= 3)
                    .ToList();

                return missedByCycle.Select(x => new ComplianceEvidence(
                    input.FarmId,
                    PlotId: x.PlotId,
                    CropCycleId: x.CropCycleId,
                    PayloadJson: JsonSerializer.Serialize(new { missed = x.Missed }),
                    DescriptionEn: $"{x.Missed} tasks planned for this week were not completed.",
                    DescriptionMr: $"या आठवड्यात नियोजित {x.Missed} कामं पूर्ण झाली नाहीत."
                )).ToArray();
            }),

        new ComplianceRule(
            ComplianceRuleCode.RepeatedSkipsPerActivity,
            ComplianceSeverity.NeedsAttention,
            ComplianceSuggestedAction.OpenStageCompare,
            "Same activity skipped 3+ times",
            "एकच काम ३ वेळा राहिलं",
            input =>
            {
                var skipsByActivity = input.LogTasksLastWeek
                    .Where(t => t.ExecutionStatus == ExecutionStatus.Skipped)
                    .GroupBy(t => t.ActivityType, StringComparer.OrdinalIgnoreCase)
                    .Where(g => g.Count() >= 3)
                    .ToList();

                return skipsByActivity.Select(g => new ComplianceEvidence(
                    input.FarmId,
                    PlotId: Guid.Empty,
                    CropCycleId: null,
                    PayloadJson: JsonSerializer.Serialize(new { activityType = g.Key, count = g.Count() }),
                    DescriptionEn: $"'{g.Key}' was skipped {g.Count()} times in the last 7 days.",
                    DescriptionMr: $"'{g.Key}' हे काम गेल्या ७ दिवसांत {g.Count()} वेळा राहिलं."
                )).ToArray();
            }),

        new ComplianceRule(
            ComplianceRuleCode.SkippedTestOverdue,
            ComplianceSeverity.Critical,
            ComplianceSuggestedAction.AssignTest,
            "Test overdue by 7+ days",
            "चाचणी ७ दिवस उशीर",
            input =>
            {
                var cutoff = DateOnly.FromDateTime(input.AsOfUtc.AddDays(-7));
                var stale = input.TestInstances
                    .Where(t => t.Status == TestInstanceStatus.Overdue && t.PlannedDueDate <= cutoff)
                    .ToList();

                return stale.Select(t => new ComplianceEvidence(
                    t.FarmId,
                    t.PlotId,
                    t.CropCycleId,
                    PayloadJson: JsonSerializer.Serialize(new { testInstanceId = t.Id, dueDate = t.PlannedDueDate }),
                    DescriptionEn: $"Test '{t.Id}' has been overdue since {t.PlannedDueDate:yyyy-MM-dd}.",
                    DescriptionMr: $"चाचणी '{t.Id}' ही {t.PlannedDueDate:yyyy-MM-dd} पासून उशीर."
                )).ToArray();
            }),

        new ComplianceRule(
            ComplianceRuleCode.ResidueRiskReported,
            ComplianceSeverity.Critical,
            ComplianceSuggestedAction.ContactAgronomist,
            "Residue level reported high",
            "अवशेष जास्त आढळलं",
            input =>
            {
                var residueHigh = input.TestInstances
                    .Where(t => t.Status == TestInstanceStatus.Reported)
                    .Where(t => t.Results.Any(r => r.ParameterCode == "residue.level" && r.ParameterValue == "high"))
                    .ToList();

                return residueHigh.Select(t => new ComplianceEvidence(
                    t.FarmId, t.PlotId, t.CropCycleId,
                    PayloadJson: JsonSerializer.Serialize(new { testInstanceId = t.Id }),
                    DescriptionEn: "Residue level reported as high on the latest test.",
                    DescriptionMr: "नवीनतम चाचणीत अवशेष जास्त आढळलं."
                )).ToArray();
            }),

        new ComplianceRule(
            ComplianceRuleCode.UnresolvedDisputeAgeHigh,
            ComplianceSeverity.NeedsAttention,
            ComplianceSuggestedAction.ResolveDispute,
            "Dispute open for 3+ days",
            "वाद ३ दिवसांपासून सुरू",
            input =>
            {
                var cutoff = input.AsOfUtc.AddDays(-3);
                var disputed = input.DailyLogs
                    .Where(d => d.CurrentVerificationStatus == VerificationStatus.Disputed)
                    .Where(d => d.ModifiedAtUtc <= cutoff)
                    .ToList();

                return disputed.Select(d => new ComplianceEvidence(
                    d.FarmId, d.PlotId, d.CropCycleId,
                    PayloadJson: JsonSerializer.Serialize(new { dailyLogId = d.Id, disputedSince = d.ModifiedAtUtc }),
                    DescriptionEn: $"This daily log has been disputed since {d.ModifiedAtUtc:yyyy-MM-dd}.",
                    DescriptionMr: $"हा लॉग {d.ModifiedAtUtc:yyyy-MM-dd} पासून वादात आहे."
                )).ToArray();
            }),

        new ComplianceRule(
            ComplianceRuleCode.ProtocolBreakInStage,
            ComplianceSeverity.Critical,
            ComplianceSuggestedAction.OpenStageCompare,
            "Stage health Critical for 3+ days",
            "टप्प्यातील आरोग्य गंभीर - ३+ दिवस",
            input =>
            {
                // Handler-coupled rule: Evaluate returns empty; EvaluateComplianceHandler
                // materialises this signal using historical CompareEngine state.
                return Array.Empty<ComplianceEvidence>();
            })
    };
}
