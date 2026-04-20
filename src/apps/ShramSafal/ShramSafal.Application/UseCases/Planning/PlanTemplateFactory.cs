using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning;

internal static class PlanTemplateFactory
{
    public static ScheduleTemplate BuildProjectedTemplate(
        CropCycle cropCycle,
        IReadOnlyCollection<PlannedActivity> plannedActivities,
        DateTime nowUtc)
    {
        var stageDefinitions = BuildStages(cropCycle, plannedActivities);
        var template = ScheduleTemplate.Create(
            Guid.NewGuid(),
            $"{cropCycle.CropName} - Derived Template",
            cropCycle.Stage,
            nowUtc,
            stages: stageDefinitions);

        AddActivities(cropCycle, plannedActivities, template);
        return template;
    }

    private static List<StageDefinition> BuildStages(
        CropCycle cropCycle,
        IReadOnlyCollection<PlannedActivity> plannedActivities)
    {
        var stageDefinitions = plannedActivities
            .Where(p => !string.IsNullOrWhiteSpace(p.Stage))
            .GroupBy(p => p.Stage.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var startDay = g.Min(x => x.PlannedDate.DayNumber - cropCycle.StartDate.DayNumber);
                var endDay = g.Max(x => x.PlannedDate.DayNumber - cropCycle.StartDate.DayNumber);
                var name = g.First().Stage.Trim();
                return new StageDefinition(name, startDay, endDay);
            })
            .OrderBy(s => s.StartDay)
            .ThenBy(s => s.EndDay)
            .ToList();

        if (stageDefinitions.Count > 0)
        {
            return stageDefinitions;
        }

        var fallbackEndDay = plannedActivities.Count > 0
            ? plannedActivities.Max(x => x.PlannedDate.DayNumber - cropCycle.StartDate.DayNumber)
            : 120;

        return [new StageDefinition(cropCycle.Stage, 0, Math.Max(0, fallbackEndDay))];
    }

    private static void AddActivities(
        CropCycle cropCycle,
        IReadOnlyCollection<PlannedActivity> plannedActivities,
        ScheduleTemplate template)
    {
        var groupedActivities = plannedActivities
            .Where(p => !string.IsNullOrWhiteSpace(p.ActivityName))
            .GroupBy(
                p => $"{p.Stage.Trim()}|{p.ActivityName.Trim()}",
                StringComparer.OrdinalIgnoreCase);

        foreach (var group in groupedActivities)
        {
            var orderedOffsets = group
                .Select(p => p.PlannedDate.DayNumber - cropCycle.StartDate.DayNumber)
                .Distinct()
                .OrderBy(x => x)
                .ToList();

            if (orderedOffsets.Count == 0)
            {
                continue;
            }

            var activityName = group.First().ActivityName.Trim();
            var isRecurring = TryResolveRecurringInterval(orderedOffsets, out var intervalDays);

            if (isRecurring)
            {
                template.AddActivity(
                    Guid.NewGuid(),
                    activityName,
                    orderedOffsets[0],
                    FrequencyMode.EveryNDays,
                    intervalDays);
                continue;
            }

            foreach (var offset in orderedOffsets)
            {
                template.AddActivity(
                    Guid.NewGuid(),
                    activityName,
                    offset,
                    FrequencyMode.OneTime,
                    1);
            }
        }
    }

    private static bool TryResolveRecurringInterval(IReadOnlyList<int> offsets, out int intervalDays)
    {
        intervalDays = 0;
        if (offsets.Count < 2)
        {
            return false;
        }

        var diffs = new List<int>(offsets.Count - 1);
        for (var i = 1; i < offsets.Count; i++)
        {
            var diff = offsets[i] - offsets[i - 1];
            if (diff <= 0)
            {
                return false;
            }

            diffs.Add(diff);
        }

        var firstDiff = diffs[0];
        if (diffs.All(d => d == firstDiff))
        {
            intervalDays = firstDiff;
            return true;
        }

        return false;
    }
}

