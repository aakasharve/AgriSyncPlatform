using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

public sealed class GetAttentionBoardHandler(
    IShramSafalRepository repository,
    ITestInstanceRepository testInstanceRepository,
    IComplianceSignalRepository complianceSignalRepository,
    IClock clock)
{
    private static readonly TestInstanceStatus[] MissingStatuses =
    [
        TestInstanceStatus.Due,
        TestInstanceStatus.Overdue
    ];

    public async Task<Result<AttentionBoardDto>> HandleAsync(GetAttentionBoardQuery query, CancellationToken ct = default)
    {
        if (query.CallerUserId == Guid.Empty)
            return Result.Failure<AttentionBoardDto>(ShramSafalErrors.InvalidCommand);

        var asOf = query.AsOfUtc ?? clock.UtcNow;
        var today = DateOnly.FromDateTime(asOf);

        // 1. Get all farmIds for the caller
        var farmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId, ct);
        if (farmIds.Count == 0)
            return Result.Success(new AttentionBoardDto(asOf, Array.Empty<AttentionCardDto>()));

        var cards = new List<AttentionCardDto>();

        foreach (var farmId in farmIds)
        {
            var farm = await repository.GetFarmByIdAsync(farmId, ct);
            if (farm is null) continue;

            var plots = await repository.GetPlotsByFarmIdAsync(farmId, ct);

            // CEI Phase 2 §4.5 — pull Due/Overdue test instances for this farm and
            // bucket them per plot using only those whose planned due date has
            // arrived (≤ today).
            var missingByPlot = await GetMissingTestCountsByPlotAsync(new FarmId(farmId), today, ct);

            foreach (var plot in plots)
            {
                var cycles = await repository.GetCropCyclesByPlotIdAsync(plot.Id, ct);
                // Most recent cycle
                var latestCycle = cycles.OrderByDescending(c => c.StartDate).FirstOrDefault();
                if (latestCycle is null) continue;

                // Get planned activities and log tasks for this cycle
                var planned = await repository.GetPlannedActivitiesByCropCycleIdAsync(latestCycle.Id, ct);
                var executed = await repository.GetExecutedTasksByCropCycleIdAsync(latestCycle.Id, ct);

                // Filter out removed planned activities
                planned = planned.Where(p => !p.IsRemoved).ToList();

                // Compute health using CompareEngine
                var stageName = latestCycle.Stage ?? "Unknown";
                HealthScore? health = null;
                if (planned.Count > 0)
                {
                    var compareResult = CompareEngine.ComputeStageComparison(planned, executed, stageName);
                    health = compareResult.OverallHealth;
                }

                // Count overdue: planned where PlannedDate < asOf.Date AND no matching executed task
                var executedTypes = executed
                    .Where(t => t.ExecutionStatus != ExecutionStatus.Skipped && t.ExecutionStatus != ExecutionStatus.Delayed)
                    .Select(t => t.ActivityType.Trim().ToLowerInvariant())
                    .ToHashSet();
                var overdueCount = planned
                    .Count(p => p.PlannedDate < today
                                && !executedTypes.Contains(p.ActivityName.Trim().ToLowerInvariant()));

                // Count disputes
                var disputeCount = await repository.GetDisputedLogCountForPlotAsync(plot.Id, ct);

                // CEI Phase 2 §4.5 — missing tests on this plot
                var missingTestCount = missingByPlot.TryGetValue(plot.Id, out var mtc) ? mtc : 0;

                // Determine rank — applies missing-test elevation rules
                var rank = DetermineRank(health, overdueCount, disputeCount, missingTestCount);

                // CEI Phase 3 §4.6 — compliance signal elevation
                IReadOnlyList<ComplianceSignal> complianceSignals;
                try
                {
                    complianceSignals = await complianceSignalRepository.GetOpenForFarmAsync(
                        new FarmId(farmId), ct);
                }
                catch
                {
                    complianceSignals = Array.Empty<ComplianceSignal>();
                }

                var plotSignals = complianceSignals.Where(s => s.PlotId == plot.Id).ToList();
                var openComplianceSignalCount = plotSignals.Count;
                ComplianceSignal? highestSeveritySignal = plotSignals
                    .OrderByDescending(s => (int)s.Severity)
                    .FirstOrDefault();

                // Elevate rank based on compliance severity
                if (highestSeveritySignal is not null)
                {
                    rank = highestSeveritySignal.Severity switch
                    {
                        ComplianceSeverity.Critical when rank > AttentionRank.Critical
                            => AttentionRank.Critical,
                        ComplianceSeverity.NeedsAttention when rank > AttentionRank.NeedsAttention
                            => AttentionRank.NeedsAttention,
                        _ => rank
                    };
                }

                // Only include non-Healthy plots (or plots with compliance signals)
                if (rank == AttentionRank.Healthy && openComplianceSignalCount == 0) continue;

                // If the only reason for inclusion is a compliance signal, we still include the plot
                if (rank == AttentionRank.Healthy && openComplianceSignalCount > 0)
                {
                    rank = AttentionRank.Watch;
                }

                var card = BuildCard(
                    farmId, farm.Name, plot.Id, plot.Name,
                    latestCycle.Id, stageName, rank,
                    health, overdueCount, disputeCount, missingTestCount,
                    openComplianceSignalCount, highestSeveritySignal, asOf);

                cards.Add(card);
            }
        }

        // Sort: rank asc (Critical first), then overdueCount desc, then farmName asc
        var sorted = cards
            .OrderBy(c => c.Rank)
            .ThenByDescending(c => c.OverdueTaskCount ?? 0)
            .ThenBy(c => c.FarmName)
            .ToList();

        return Result.Success(new AttentionBoardDto(asOf, sorted));
    }

    private async Task<Dictionary<Guid, int>> GetMissingTestCountsByPlotAsync(
        FarmId farmId,
        DateOnly today,
        CancellationToken ct)
    {
        var instances = await testInstanceRepository
            .GetByFarmIdAndStatusAsync(farmId, MissingStatuses, ct);

        var result = new Dictionary<Guid, int>();
        if (instances.Count == 0)
        {
            return result;
        }

        foreach (var instance in instances)
        {
            if (instance.PlannedDueDate > today)
            {
                continue; // not yet due
            }

            result[instance.PlotId] = result.TryGetValue(instance.PlotId, out var existing)
                ? existing + 1
                : 1;
        }

        return result;
    }

    private static AttentionRank DetermineRank(
        HealthScore? health,
        int overdueCount,
        int disputeCount,
        int missingTestCount)
    {
        // Rule 1: Critical health → Critical
        if (health == HealthScore.Critical) return AttentionRank.Critical;
        // Rule 2: Any dispute → Critical
        if (disputeCount > 0) return AttentionRank.Critical;
        // Rule 3: 3+ overdue → NeedsAttention
        if (overdueCount >= 3) return AttentionRank.NeedsAttention;
        // Rule 4: NeedsAttention health → NeedsAttention
        if (health == HealthScore.NeedsAttention) return AttentionRank.NeedsAttention;

        // CEI Phase 2 §4.5 — missing-test elevation rules
        // 3+ missing tests → NeedsAttention
        if (missingTestCount >= 3) return AttentionRank.NeedsAttention;

        // Rule 5: 1-2 overdue → Watch
        if (overdueCount >= 1) return AttentionRank.Watch;

        // CEI Phase 2 §4.5 — at least one missing test on a healthy plot bumps to Watch
        if (missingTestCount >= 1) return AttentionRank.Watch;

        // Rule 6: Healthy
        return AttentionRank.Healthy;
    }

    private static AttentionCardDto BuildCard(
        Guid farmId, string farmName, Guid plotId, string plotName,
        Guid cropCycleId, string stageName, AttentionRank rank,
        HealthScore? health, int overdueCount, int disputeCount, int missingTestCount,
        int openComplianceSignalCount, ComplianceSignal? highestSeveritySignal,
        DateTime asOf)
    {
        // Determine suggested action and labels based on rank + context.
        // CEI Phase 3 §4.6: prefer highest-severity compliance signal's SuggestedAction
        // over auto-derived when it produces a more specific action.
        SuggestedActionKind action;
        string labelEn, labelMr;
        string titleEn, titleMr, descEn, descMr;

        if (rank == AttentionRank.Critical && disputeCount > 0)
        {
            action = SuggestedActionKind.ResolveDispute;
            labelEn = "Open disputes"; labelMr = "वाद सोडवा";
            titleEn = "Log disputes need resolution"; titleMr = "नोंदींमध्ये वाद आहेत";
            descEn = $"{disputeCount} disputed log(s) need attention";
            descMr = $"{disputeCount} नोंदींमध्ये वाद आहे";
        }
        else if (rank == AttentionRank.Critical && highestSeveritySignal?.Severity == ComplianceSeverity.Critical)
        {
            // Compliance signal drives the critical rank — use its suggested action
            action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
            labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
            titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
            descEn = highestSeveritySignal.DescriptionEn;
            descMr = highestSeveritySignal.DescriptionMr;
        }
        else if (rank == AttentionRank.Critical && health == HealthScore.Critical)
        {
            action = SuggestedActionKind.OpenStageCompare;
            labelEn = "Open stage compare"; labelMr = "टप्पा तुलना पहा";
            titleEn = "Stage compliance is critical"; titleMr = "टप्प्याची अनुपालन गंभीर आहे";
            descEn = "Most planned activities are missing for this stage";
            descMr = "या टप्प्यात बहुतेक नियोजित कामे झाली नाहीत";
        }
        else if (rank == AttentionRank.NeedsAttention && overdueCount >= 3)
        {
            action = SuggestedActionKind.ReviewOverdueTasks;
            labelEn = "Review overdue tasks"; labelMr = "थकलेली कामे पहा";
            titleEn = $"{overdueCount} tasks overdue"; titleMr = $"{overdueCount} कामे थकलेली";
            descEn = "Several planned activities are past their scheduled date";
            descMr = "अनेक नियोजित कामे वेळेवर झाली नाहीत";
        }
        else if (rank == AttentionRank.NeedsAttention && missingTestCount >= 3)
        {
            action = SuggestedActionKind.AssignTest;
            labelEn = "Assign tests"; labelMr = "चाचण्या नियुक्त करा";
            titleEn = $"{missingTestCount} tests overdue"; titleMr = $"{missingTestCount} चाचण्या थकल्या";
            descEn = "Several scheduled tests have not been collected";
            descMr = "अनेक नियोजित चाचण्या घेतल्या गेल्या नाहीत";
        }
        else if (rank == AttentionRank.NeedsAttention && highestSeveritySignal?.Severity == ComplianceSeverity.NeedsAttention)
        {
            action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
            labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
            titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
            descEn = highestSeveritySignal.DescriptionEn;
            descMr = highestSeveritySignal.DescriptionMr;
        }
        else if (rank == AttentionRank.NeedsAttention && health == HealthScore.NeedsAttention)
        {
            action = SuggestedActionKind.OpenStageCompare;
            labelEn = "Open stage compare"; labelMr = "टप्पा तुलना पहा";
            titleEn = "Stage needs attention"; titleMr = "टप्प्यात लक्ष द्या";
            descEn = "Some planned activities are not being logged";
            descMr = "काही नियोजित कामांच्या नोंदी नाहीत";
        }
        else if (rank == AttentionRank.Watch && missingTestCount >= 1 && overdueCount == 0)
        {
            action = SuggestedActionKind.AssignTest;
            labelEn = "Assign tests"; labelMr = "चाचण्या नियुक्त करा";
            titleEn = missingTestCount == 1
                ? "1 test pending collection"
                : $"{missingTestCount} tests pending collection";
            titleMr = missingTestCount == 1
                ? "1 चाचणी प्रलंबित"
                : $"{missingTestCount} चाचण्या प्रलंबित";
            descEn = "Scheduled lab test(s) have not been collected yet";
            descMr = "नियोजित चाचणी अद्याप घेतलेली नाही";
        }
        else // Watch — overdue tasks or compliance signals
        {
            if (openComplianceSignalCount > 0 && overdueCount == 0 && highestSeveritySignal is not null)
            {
                action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
                labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
                titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
                descEn = highestSeveritySignal.DescriptionEn;
                descMr = highestSeveritySignal.DescriptionMr;
            }
            else
            {
                action = SuggestedActionKind.OpenPlot;
                labelEn = "Go to plot"; labelMr = "तुकडा पहा";
                titleEn = overdueCount > 0 ? $"{overdueCount} task(s) slightly behind" : "Plot needs a check";
                titleMr = overdueCount > 0 ? $"{overdueCount} काम थोडे उशीर" : "तुकडा तपासा";
                descEn = "A few activities may need follow-up";
                descMr = "काही कामांवर लक्ष द्यावे";
            }
        }

        return new AttentionCardDto(
            CardId: Guid.NewGuid(),
            FarmId: farmId,
            FarmName: farmName,
            PlotId: plotId,
            PlotName: plotName,
            CropCycleId: cropCycleId,
            StageName: stageName,
            Rank: rank,
            TitleEn: titleEn,
            TitleMr: titleMr,
            DescriptionEn: descEn,
            DescriptionMr: descMr,
            SuggestedAction: action,
            SuggestedActionLabelEn: labelEn,
            SuggestedActionLabelMr: labelMr,
            OverdueTaskCount: overdueCount > 0 ? overdueCount : null,
            LatestHealthScore: health?.ToString(),
            UnresolvedDisputeCount: disputeCount > 0 ? disputeCount : null,
            MissingTestCount: missingTestCount > 0 ? missingTestCount : null,
            OpenComplianceSignalCount: openComplianceSignalCount,
            ComputedAtUtc: asOf);
    }

    /// <summary>
    /// Maps a <see cref="ComplianceSuggestedAction"/> to the attention board's
    /// <see cref="SuggestedActionKind"/>. Both enums cover overlapping domain actions.
    /// </summary>
    private static SuggestedActionKind MapComplianceSuggestedAction(ComplianceSuggestedAction action) =>
        action switch
        {
            ComplianceSuggestedAction.OpenStageCompare => SuggestedActionKind.OpenStageCompare,
            ComplianceSuggestedAction.AssignTest => SuggestedActionKind.AssignTest,
            ComplianceSuggestedAction.ResolveDispute => SuggestedActionKind.ResolveDispute,
            ComplianceSuggestedAction.ScheduleMissingActivity => SuggestedActionKind.ReviewOverdueTasks,
            _ => SuggestedActionKind.OpenPlot
        };
}
