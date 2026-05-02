namespace ShramSafal.Domain.Planning;

public static class PlanDerivationEngine
{
    public static List<PlannedActivity> DerivePlannedItemsForDay(
        ScheduleTemplate template,
        DateOnly startDate,
        DateOnly targetDate)
    {
        var dayNumber = targetDate.DayNumber - startDate.DayNumber;
        var stageName = GetCurrentStage(template, dayNumber);
        if (string.IsNullOrWhiteSpace(stageName))
        {
            return [];
        }

        var nowUtc = DateTime.UtcNow;
        var planned = new List<PlannedActivity>();

        foreach (var activity in template.Activities)
        {
            if (!string.Equals(
                    GetCurrentStage(template, activity.OffsetDays),
                    stageName,
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!ShouldRunOnDay(activity, dayNumber))
            {
                continue;
            }

            planned.Add(PlannedActivity.CreateFromTemplate(
                Guid.NewGuid(),
                Guid.Empty,
                activity.ActivityName,
                stageName,
                targetDate,
                activity.Id,
                nowUtc));
        }

        return planned
            .OrderBy(x => x.ActivityName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static string GetCurrentStage(ScheduleTemplate template, int dayNumber)
    {
        if (template.Stages.Count == 0)
        {
            return template.Stage;
        }

        var orderedStages = template.Stages
            .OrderBy(s => s.StartDay)
            .ThenBy(s => s.EndDay)
            .ToList();

        var active = orderedStages.FirstOrDefault(s => dayNumber >= s.StartDay && dayNumber <= s.EndDay);
        if (active is not null)
        {
            return active.Name;
        }

        if (dayNumber < orderedStages[0].StartDay)
        {
            return orderedStages[0].Name;
        }

        return orderedStages[^1].Name;
    }

    public static List<PlannedActivity> DerivePlannedItemsForStage(
        ScheduleTemplate template,
        DateOnly startDate,
        string stageName)
    {
        if (string.IsNullOrWhiteSpace(stageName))
        {
            return [];
        }

        var (stageStart, stageEnd) = ResolveStageRange(template, stageName.Trim());
        if (stageEnd < stageStart)
        {
            return [];
        }

        var nowUtc = DateTime.UtcNow;
        var planned = new List<PlannedActivity>();

        foreach (var activity in template.Activities)
        {
            if (!string.Equals(
                    GetCurrentStage(template, activity.OffsetDays),
                    stageName,
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            switch (activity.FrequencyMode)
            {
                case FrequencyMode.OneTime:
                    if (activity.OffsetDays >= stageStart && activity.OffsetDays <= stageEnd)
                    {
                        planned.Add(CreatePlannedItem(activity, startDate, activity.OffsetDays, stageName, nowUtc));
                    }
                    break;

                case FrequencyMode.EveryNDays:
                    {
                        var interval = Math.Max(1, activity.IntervalDays);
                        var firstDue = AlignFirstDueDay(activity.OffsetDays, stageStart, interval);
                        for (var day = firstDue; day <= stageEnd; day += interval)
                        {
                            planned.Add(CreatePlannedItem(activity, startDate, day, stageName, nowUtc));
                        }
                        break;
                    }

                case FrequencyMode.PerWeek:
                    {
                        var occurrencesPerWeek = Math.Max(1, activity.IntervalDays);
                        var interval = Math.Max(1, (int)Math.Floor(7d / occurrencesPerWeek));
                        var firstDue = AlignFirstDueDay(activity.OffsetDays, stageStart, interval);
                        for (var day = firstDue; day <= stageEnd; day += interval)
                        {
                            planned.Add(CreatePlannedItem(activity, startDate, day, stageName, nowUtc));
                        }
                        break;
                    }
            }
        }

        return planned
            .OrderBy(x => x.PlannedDate)
            .ThenBy(x => x.ActivityName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool ShouldRunOnDay(TemplateActivity activity, int dayNumber)
    {
        if (dayNumber < activity.OffsetDays)
        {
            return false;
        }

        var relativeDay = dayNumber - activity.OffsetDays;
        return activity.FrequencyMode switch
        {
            FrequencyMode.OneTime => relativeDay == 0,
            FrequencyMode.EveryNDays => relativeDay % Math.Max(1, activity.IntervalDays) == 0,
            FrequencyMode.PerWeek => relativeDay % Math.Max(1, (int)Math.Floor(7d / Math.Max(1, activity.IntervalDays))) == 0,
            _ => false
        };
    }

    private static (int StartDay, int EndDay) ResolveStageRange(ScheduleTemplate template, string stageName)
    {
        var stage = template.Stages
            .FirstOrDefault(s => string.Equals(s.Name, stageName, StringComparison.OrdinalIgnoreCase));

        if (stage is not null)
        {
            return (stage.StartDay, stage.EndDay);
        }

        if (template.Activities.Count == 0)
        {
            return (0, -1);
        }

        var minOffset = template.Activities.Min(a => a.OffsetDays);
        var maxOffset = template.Activities.Max(a => a.OffsetDays);
        return (minOffset, maxOffset + 30);
    }

    private static int AlignFirstDueDay(int offsetDay, int stageStartDay, int interval)
    {
        if (offsetDay >= stageStartDay)
        {
            return offsetDay;
        }

        var delta = stageStartDay - offsetDay;
        var remainder = delta % interval;
        return remainder == 0 ? stageStartDay : stageStartDay + (interval - remainder);
    }

    private static PlannedActivity CreatePlannedItem(
        TemplateActivity activity,
        DateOnly startDate,
        int dayNumber,
        string stageName,
        DateTime nowUtc)
    {
        return PlannedActivity.CreateFromTemplate(
            Guid.NewGuid(),
            Guid.Empty,
            activity.ActivityName,
            stageName,
            startDate.AddDays(dayNumber),
            activity.Id,
            nowUtc);
    }
}

