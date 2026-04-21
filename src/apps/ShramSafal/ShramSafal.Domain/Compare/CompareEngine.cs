using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Compare;

public static class CompareEngine
{
    private static readonly string[] BucketOrder = ["spray", "fertigation", "irrigation", "activity"];

    public static StageComparisonResult ComputeStageComparison(
        List<PlannedActivity> planned,
        List<LogTask> executed,
        string stageName)
    {
        var plannedByBucket = planned
            .Where(p => !string.IsNullOrWhiteSpace(p.ActivityName))
            .GroupBy(p => Categorize(p.ActivityName), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g
                    .Select(p => p.ActivityName.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                StringComparer.OrdinalIgnoreCase);

        // Skipped and Delayed tasks do not count as executed — their planned counterparts
        // will fall through to the Missing bucket. Partial/Modified/Completed all count.
        // Partial tasks count as full match in v1 — see CEI §4.3 deferral note.
        var executedByBucket = executed
            .Where(t => !string.IsNullOrWhiteSpace(t.ActivityType))
            .Where(t => t.ExecutionStatus != ExecutionStatus.Skipped && t.ExecutionStatus != ExecutionStatus.Delayed)
            .GroupBy(t => Categorize(t.ActivityType), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g
                    .Select(t => t.ActivityType.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                StringComparer.OrdinalIgnoreCase);

        var buckets = new List<StageComparisonBucket>(BucketOrder.Length);
        foreach (var bucketName in BucketOrder)
        {
            var plannedItems = plannedByBucket.GetValueOrDefault(bucketName, []);
            var executedItems = executedByBucket.GetValueOrDefault(bucketName, []);

            var matched = new List<string>();
            var missing = new List<string>();
            var extra = new List<string>();
            var matchedExecutedIndexes = new HashSet<int>();

            foreach (var plannedItem in plannedItems)
            {
                var matchedIndex = -1;
                for (var i = 0; i < executedItems.Count; i++)
                {
                    if (matchedExecutedIndexes.Contains(i))
                    {
                        continue;
                    }

                    if (FuzzyMatchActivity(plannedItem, executedItems[i]))
                    {
                        matchedIndex = i;
                        break;
                    }
                }

                if (matchedIndex >= 0)
                {
                    matched.Add(plannedItem);
                    matchedExecutedIndexes.Add(matchedIndex);
                }
                else
                {
                    missing.Add(plannedItem);
                }
            }

            for (var i = 0; i < executedItems.Count; i++)
            {
                if (!matchedExecutedIndexes.Contains(i))
                {
                    extra.Add(executedItems[i]);
                }
            }

            var health = DetermineBucketHealth(matched.Count, plannedItems.Count);
            buckets.Add(new StageComparisonBucket(
                Category: bucketName,
                Planned: plannedItems,
                Executed: executedItems,
                Matched: matched,
                Missing: missing,
                Extra: extra,
                Health: health));
        }

        var overallHealth = DetermineOverallHealth(buckets.Select(b => b.Health).ToList());

        var startDay = 0;
        var endDay = 0;
        if (planned.Count > 0)
        {
            var minDate = planned.Min(x => x.PlannedDate);
            var maxDate = planned.Max(x => x.PlannedDate);
            endDay = maxDate.DayNumber - minDate.DayNumber;
        }

        return new StageComparisonResult(
            StageName: stageName,
            StartDay: startDay,
            EndDay: endDay,
            Buckets: buckets,
            OverallHealth: overallHealth);
    }

    public static bool FuzzyMatchActivity(string planned, string executed)
    {
        if (string.IsNullOrWhiteSpace(planned) || string.IsNullOrWhiteSpace(executed))
        {
            return false;
        }

        var plannedNormalized = planned.Trim();
        var executedNormalized = executed.Trim();

        return plannedNormalized.Contains(executedNormalized, StringComparison.OrdinalIgnoreCase)
            || executedNormalized.Contains(plannedNormalized, StringComparison.OrdinalIgnoreCase);
    }

    public static HealthScore DetermineBucketHealth(int matched, int planned)
    {
        if (planned <= 0)
        {
            return HealthScore.Excellent;
        }

        var ratio = (decimal)matched / planned;
        if (ratio >= 0.85m)
        {
            return HealthScore.Excellent;
        }

        if (ratio >= 0.60m)
        {
            return HealthScore.Good;
        }

        if (ratio >= 0.30m)
        {
            return HealthScore.NeedsAttention;
        }

        return HealthScore.Critical;
    }

    public static HealthScore DetermineOverallHealth(List<HealthScore> bucketHealths)
    {
        if (bucketHealths.Count == 0)
        {
            return HealthScore.NeedsAttention;
        }

        if (bucketHealths.Contains(HealthScore.Critical))
        {
            return HealthScore.Critical;
        }

        if (bucketHealths.Contains(HealthScore.NeedsAttention))
        {
            return HealthScore.NeedsAttention;
        }

        return bucketHealths.All(h => h == HealthScore.Excellent)
            ? HealthScore.Excellent
            : HealthScore.Good;
    }

    private static string Categorize(string activityName)
    {
        var normalized = activityName.Trim().ToLowerInvariant();
        if (normalized.Contains("spray") ||
            normalized.Contains("pesticide") ||
            normalized.Contains("fungicide"))
        {
            return "spray";
        }

        if (normalized.Contains("fert") ||
            normalized.Contains("urea") ||
            normalized.Contains("dap") ||
            normalized.Contains("nutri"))
        {
            return "fertigation";
        }

        if (normalized.Contains("irrig") || normalized.Contains("water"))
        {
            return "irrigation";
        }

        return "activity";
    }
}

