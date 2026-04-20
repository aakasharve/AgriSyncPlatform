using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

public sealed class CompareEngineDeviationTests
{
    private static DailyLog MakeLog() =>
        DailyLog.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            new DateOnly(2026, 4, 21),
            null, null,
            DateTime.UtcNow);

    private static List<PlannedActivity> PlannedWith(string activityName) =>
        new()
        {
            PlannedActivity.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                activityName,
                "Vegetative",
                new DateOnly(2026, 4, 21),
                DateTime.UtcNow)
        };

    [Fact]
    public void CompareEngine_SkippedExecution_MovesPlannedToMissing()
    {
        var planned = PlannedWith("Foliar Spray");
        var log = MakeLog();
        log.AddTask(Guid.NewGuid(), "Foliar Spray", null, DateTime.UtcNow,
            ExecutionStatus.Skipped, deviationReasonCode: "weather.rain");

        var result = CompareEngine.ComputeStageComparison(planned, log.Tasks.ToList(), "Vegetative");

        var sprayBucket = result.Buckets.First(b => b.Category == "spray");
        sprayBucket.Missing.Should().Contain("Foliar Spray");
        sprayBucket.Matched.Should().BeEmpty();
    }

    [Fact]
    public void CompareEngine_DelayedExecution_MovesPlannedToMissing()
    {
        var planned = PlannedWith("Foliar Spray");
        var log = MakeLog();
        log.AddTask(Guid.NewGuid(), "Foliar Spray", null, DateTime.UtcNow,
            ExecutionStatus.Delayed, deviationReasonCode: "labour.absent");

        var result = CompareEngine.ComputeStageComparison(planned, log.Tasks.ToList(), "Vegetative");

        var sprayBucket = result.Buckets.First(b => b.Category == "spray");
        sprayBucket.Missing.Should().Contain("Foliar Spray");
        sprayBucket.Matched.Should().BeEmpty();
    }

    [Fact]
    public void CompareEngine_Existing_Completed_Unaffected()
    {
        // Verified existing behavior: a Completed task still matches planned.
        var planned = PlannedWith("Foliar Spray");
        var log = MakeLog();
        log.AddTask(Guid.NewGuid(), "Foliar Spray", null, DateTime.UtcNow);

        var result = CompareEngine.ComputeStageComparison(planned, log.Tasks.ToList(), "Vegetative");

        result.OverallHealth.Should().Be(HealthScore.Excellent);
        result.Buckets.First(b => b.Category == "spray").Matched.Should().Contain("Foliar Spray");
    }

    [Fact]
    public void CompareEngine_PartialExecution_StillMatchesPlanned_V1()
    {
        // In v1, Partial counts as a full match (CEI §4.3 deferral note).
        var planned = PlannedWith("Foliar Spray");
        var log = MakeLog();
        log.AddTask(Guid.NewGuid(), "Foliar Spray", null, DateTime.UtcNow,
            ExecutionStatus.Partial, deviationReasonCode: "weather.rain");

        var result = CompareEngine.ComputeStageComparison(planned, log.Tasks.ToList(), "Vegetative");

        var sprayBucket = result.Buckets.First(b => b.Category == "spray");
        sprayBucket.Matched.Should().Contain("Foliar Spray");
        sprayBucket.Missing.Should().BeEmpty();
    }

    [Fact]
    public void CompareEngine_ModifiedExecution_StillMatchesPlanned()
    {
        var planned = PlannedWith("Drip Irrigation");
        var log = MakeLog();
        log.AddTask(Guid.NewGuid(), "Drip Irrigation", null, DateTime.UtcNow,
            ExecutionStatus.Modified, deviationReasonCode: "instruction.changed");

        var result = CompareEngine.ComputeStageComparison(planned, log.Tasks.ToList(), "Vegetative");

        var irrigBucket = result.Buckets.First(b => b.Category == "irrigation");
        irrigBucket.Matched.Should().Contain("Drip Irrigation");
    }
}
