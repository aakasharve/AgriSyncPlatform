using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class FarmerEngagementProjectionFoldTests
{
    // Build a stamped aggregate the way Phase 2 would: 5-arg shell Create,
    // then ApplyDerivation to set the folded columns. `flags: default` is the
    // zero value of the ContributingFlags parameter (no member name needed).
    private static DailyRichnessAggregate Day(
        int year, int month, int day,
        DayClassification classification,
        bool advancesStreak,
        bool advancesBar,
        int points)
    {
        var aggregate = DailyRichnessAggregate.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(year, month, day),
            "Asia/Kolkata",
            DateTimeOffset.UtcNow);

        aggregate.ApplyDerivation(
            execScore: null,
            insightScore: null,
            learningScore: null,
            classification: classification,
            flags: default,
            advancesStreak: advancesStreak,
            advancesBar: advancesBar,
            shramPoints: points,
            rewardReasonsJson: "[]",
            noWorkReasonCode: null,
            scoreEngineVersion: DfesTuning.ScoreEngineVersion,
            componentsJson: "{}");

        return aggregate;
    }

    [Fact]
    public void EmptyHistory_ReturnsAllZeroLockedProjection()
    {
        var result = FarmerEngagementProjection.Fold(Array.Empty<DailyRichnessAggregate>());

        Assert.Equal(0, result.CurrentStreak);
        Assert.Equal(0, result.LongestStreak);
        Assert.Equal(0, result.TotalShramPoints);
        Assert.Equal(0, result.TotalRichDays);
        Assert.Null(result.LastAccountedDate);
        Assert.Equal("locked", result.UnlockStatus);
    }

    [Fact]
    public void ConsecutiveAdvancingDays_BuildCurrentAndLongestStreak()
    {
        var days = new[]
        {
            Day(2026, 7, 1, DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10),
            Day(2026, 7, 2, DayClassification.BasicWorkDay, advancesStreak: true, advancesBar: false, points: 5),
            Day(2026, 7, 3, DayClassification.DeclaredNoWorkDay, advancesStreak: true, advancesBar: false, points: 2),
        };

        var result = FarmerEngagementProjection.Fold(days);

        Assert.Equal(3, result.CurrentStreak);
        Assert.Equal(3, result.LongestStreak);
        Assert.Equal(17, result.TotalShramPoints);
        Assert.Equal(new DateOnly(2026, 7, 3), result.LastAccountedDate);
    }

    [Fact]
    public void SingleUnaccountedDay_WithinGrace_DoesNotBreakStreak()
    {
        // DfesTuning.Streak.GraceDaysBeforeBreak = 1 → one unaccounted day is tolerated.
        var days = new[]
        {
            Day(2026, 7, 1, DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10),
            Day(2026, 7, 2, DayClassification.UnaccountedDay, advancesStreak: false, advancesBar: false, points: 0),
            Day(2026, 7, 3, DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10),
        };

        var result = FarmerEngagementProjection.Fold(days);

        Assert.Equal(2, result.CurrentStreak);   // advance did not reset on the tolerated gap
        Assert.Equal(2, result.LongestStreak);
    }

    [Fact]
    public void ConsecutiveUnaccounted_BeyondGrace_BreaksStreak()
    {
        var days = new[]
        {
            Day(2026, 7, 1, DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10),
            Day(2026, 7, 2, DayClassification.UnaccountedDay, advancesStreak: false, advancesBar: false, points: 0),
            Day(2026, 7, 3, DayClassification.UnaccountedDay, advancesStreak: false, advancesBar: false, points: 0),
        };

        var result = FarmerEngagementProjection.Fold(days);

        Assert.Equal(0, result.CurrentStreak);   // 2 consecutive > grace(1) → broken
        Assert.Equal(1, result.LongestStreak);   // the day-1 streak still counts as the longest
    }

    [Fact]
    public void PendingReconciliation_IsNonBreakingPause_AndNotCountedAsAccounted()
    {
        var days = new[]
        {
            Day(2026, 7, 1, DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10),
            Day(2026, 7, 2, DayClassification.PendingReconciliation, advancesStreak: false, advancesBar: false, points: 0),
            Day(2026, 7, 3, DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10),
        };

        var result = FarmerEngagementProjection.Fold(days);

        Assert.Equal(2, result.CurrentStreak);                            // pause neither advanced nor broke
        Assert.Equal(new DateOnly(2026, 7, 3), result.LastAccountedDate); // pending day excluded from "accounted"
    }

    [Fact]
    public void RichDayCount_AtThreshold_UnlocksAndStaysMonotonic()
    {
        var threshold = DfesTuning.RichDayThreshold;
        var days = Enumerable.Range(0, threshold)
            .Select(i => Day(2026, 1, 1 + (i % 27),
                DayClassification.RichWorkDay, advancesStreak: true, advancesBar: true, points: 10))
            .ToArray();

        var result = FarmerEngagementProjection.Fold(days);

        Assert.Equal(threshold, result.TotalRichDays);
        Assert.Equal("unlocked", result.UnlockStatus);
    }
}
