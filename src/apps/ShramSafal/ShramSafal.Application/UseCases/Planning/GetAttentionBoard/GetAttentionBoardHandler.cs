using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

public sealed class GetAttentionBoardHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<AttentionBoardDto>> HandleAsync(GetAttentionBoardQuery query, CancellationToken ct = default)
    {
        if (query.CallerUserId == Guid.Empty)
            return Result.Failure<AttentionBoardDto>(ShramSafalErrors.InvalidCommand);

        var asOf = query.AsOfUtc ?? clock.UtcNow;

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
                    .Count(p => p.PlannedDate < DateOnly.FromDateTime(asOf)
                                && !executedTypes.Contains(p.ActivityName.Trim().ToLowerInvariant()));

                // Count disputes
                var disputeCount = await repository.GetDisputedLogCountForPlotAsync(plot.Id, ct);

                // Determine rank
                var rank = DetermineRank(health, overdueCount, disputeCount);

                // Only include non-Healthy plots
                if (rank == AttentionRank.Healthy) continue;

                var card = BuildCard(
                    farmId, farm.Name, plot.Id, plot.Name,
                    latestCycle.Id, stageName, rank,
                    health, overdueCount, disputeCount, asOf);

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

    private static AttentionRank DetermineRank(HealthScore? health, int overdueCount, int disputeCount)
    {
        // Rule 1: Critical health → Critical
        if (health == HealthScore.Critical) return AttentionRank.Critical;
        // Rule 2: Any dispute → Critical
        if (disputeCount > 0) return AttentionRank.Critical;
        // Rule 3: 3+ overdue → NeedsAttention
        if (overdueCount >= 3) return AttentionRank.NeedsAttention;
        // Rule 4: NeedsAttention health → NeedsAttention
        if (health == HealthScore.NeedsAttention) return AttentionRank.NeedsAttention;
        // Rule 5: 1-2 overdue → Watch
        if (overdueCount >= 1) return AttentionRank.Watch;
        // Rule 6: Healthy
        return AttentionRank.Healthy;
    }

    private static AttentionCardDto BuildCard(
        Guid farmId, string farmName, Guid plotId, string plotName,
        Guid cropCycleId, string stageName, AttentionRank rank,
        HealthScore? health, int overdueCount, int disputeCount,
        DateTime asOf)
    {
        // Determine suggested action and labels based on rank + context
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
        else if (rank == AttentionRank.NeedsAttention && health == HealthScore.NeedsAttention)
        {
            action = SuggestedActionKind.OpenStageCompare;
            labelEn = "Open stage compare"; labelMr = "टप्पा तुलना पहा";
            titleEn = "Stage needs attention"; titleMr = "टप्प्यात लक्ष द्या";
            descEn = "Some planned activities are not being logged";
            descMr = "काही नियोजित कामांच्या नोंदी नाहीत";
        }
        else // Watch
        {
            action = SuggestedActionKind.OpenPlot;
            labelEn = "Go to plot"; labelMr = "तुकडा पहा";
            titleEn = overdueCount > 0 ? $"{overdueCount} task(s) slightly behind" : "Plot needs a check";
            titleMr = overdueCount > 0 ? $"{overdueCount} काम थोडे उशीर" : "तुकडा तपासा";
            descEn = "A few activities may need follow-up";
            descMr = "काही कामांवर लक्ष द्यावे";
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
            ComputedAtUtc: asOf);
    }
}
