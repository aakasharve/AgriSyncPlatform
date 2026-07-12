namespace ShramSafal.Domain.Dfes;

/// <summary>
/// Read-only fold of the Phase-2-populated <see cref="DailyRichnessAggregate"/>
/// columns into the farmer-facing engagement projection. This type performs NO
/// scoring/reward/streak DERIVATION — it only folds already-stamped columns
/// (ShramPointsEarned / AdvancesStreak / AdvancesBar / DayClassification) per
/// the LOCKED DFES fold rules, reading thresholds from the static
/// <see cref="DfesTuning"/>. Pure: no Infrastructure, no I/O.
/// </summary>
public sealed record FarmerEngagementProjection(
    int CurrentStreak,
    int LongestStreak,
    int TotalShramPoints,
    DateOnly? LastAccountedDate,
    int TotalRichDays,
    string UnlockStatus)
{
    public const string Locked = "locked";
    public const string Unlocked = "unlocked";

    public static FarmerEngagementProjection Fold(
        IReadOnlyList<DailyRichnessAggregate> aggregates)
    {
        ArgumentNullException.ThrowIfNull(aggregates);

        var ordered = aggregates.OrderBy(a => a.LocalDate).ToList();

        var totalShramPoints = ordered.Sum(a => a.ShramPointsEarned);
        var totalRichDays = ordered.Count(a => a.AdvancesBar);

        DateOnly? lastAccountedDate = ordered
            .Where(a => a.DayClassification != DayClassification.UnaccountedDay
                     && a.DayClassification != DayClassification.PendingReconciliation)
            .Select(a => (DateOnly?)a.LocalDate)
            .LastOrDefault();

        var currentStreak = 0;
        var longestStreak = 0;
        var consecutiveUnaccounted = 0;

        foreach (var day in ordered)
        {
            if (day.AdvancesStreak)
            {
                currentStreak += 1;
                consecutiveUnaccounted = 0;
                if (currentStreak > longestStreak)
                {
                    longestStreak = currentStreak;
                }
            }
            else if (day.DayClassification == DayClassification.PendingReconciliation)
            {
                // Non-breaking pause: leave streak + grace counters untouched.
            }
            else if (day.DayClassification == DayClassification.UnaccountedDay)
            {
                consecutiveUnaccounted += 1;
                if (consecutiveUnaccounted > DfesTuning.Streak.GraceDaysBeforeBreak)
                {
                    currentStreak = 0;
                }
            }
        }

        var unlockStatus = totalRichDays >= DfesTuning.RichDayThreshold ? Unlocked : Locked;

        return new FarmerEngagementProjection(
            currentStreak,
            longestStreak,
            totalShramPoints,
            lastAccountedDate,
            totalRichDays,
            unlockStatus);
    }
}
