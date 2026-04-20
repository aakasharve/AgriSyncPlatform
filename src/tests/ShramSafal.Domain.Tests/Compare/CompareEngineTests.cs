using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

public sealed class CompareEngineTests
{
    [Fact]
    public void FuzzyMatchActivity_AllowsContainsMatch()
    {
        var matched = CompareEngine.FuzzyMatchActivity(
            "Foliar Spray",
            "Foliar Spray with Sticker");

        Assert.True(matched);
    }

    [Fact]
    public void ComputeStageComparison_GeneratesBucketAndOverallHealth()
    {
        var planned = new List<PlannedActivity>
        {
            PlannedActivity.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                "Foliar Spray",
                "Vegetative",
                new DateOnly(2026, 2, 10),
                DateTime.UtcNow),
            PlannedActivity.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                "Drip Irrigation",
                "Vegetative",
                new DateOnly(2026, 2, 11),
                DateTime.UtcNow)
        };

        var log = DailyLog.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            new DateOnly(2026, 2, 10),
            null,
            null,
            DateTime.UtcNow);

        log.AddTask(Guid.NewGuid(), "Foliar Spray with Sticker", null, DateTime.UtcNow);
        log.AddTask(Guid.NewGuid(), "Drip Irrigation - 2hrs", null, DateTime.UtcNow);

        var result = CompareEngine.ComputeStageComparison(
            planned,
            log.Tasks.ToList(),
            "Vegetative");

        Assert.Equal("Vegetative", result.StageName);
        Assert.Equal(HealthScore.Excellent, result.OverallHealth);
        Assert.Contains(result.Buckets, b => b.Category == "spray" && b.Matched.Count == 1);
        Assert.Contains(result.Buckets, b => b.Category == "irrigation" && b.Matched.Count == 1);
    }

    [Fact]
    public void DetermineOverallHealth_ReturnsCritical_WhenAnyBucketCritical()
    {
        var health = CompareEngine.DetermineOverallHealth(
            [HealthScore.Good, HealthScore.Critical, HealthScore.Excellent]);

        Assert.Equal(HealthScore.Critical, health);
    }
}
