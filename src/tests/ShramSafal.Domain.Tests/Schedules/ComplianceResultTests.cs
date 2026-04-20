using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ComplianceResultTests
{
    [Fact]
    public void Unscheduled_HasNullSubscriptionAndMatchedTask()
    {
        var result = ComplianceResult.Unscheduled();
        Assert.Equal(ComplianceOutcome.Unscheduled, result.Outcome);
        Assert.Null(result.SubscriptionId);
        Assert.Null(result.MatchedTaskId);
        Assert.Null(result.DeltaDays);
    }

    [Theory]
    [InlineData(-5, 2, ComplianceOutcome.Early)]
    [InlineData(-2, 2, ComplianceOutcome.OnTime)]
    [InlineData(0, 2, ComplianceOutcome.OnTime)]
    [InlineData(2, 2, ComplianceOutcome.OnTime)]
    [InlineData(5, 2, ComplianceOutcome.Late)]
    public void Matched_ClassifiesDeltaByTolerance(int deltaDays, int tolerance, ComplianceOutcome expected)
    {
        var sub = ScheduleSubscriptionId.New();
        var task = PrescribedTaskId.New();
        var result = ComplianceResult.Matched(sub, task, deltaDays, tolerance);
        Assert.Equal(expected, result.Outcome);
        Assert.Equal(deltaDays, result.DeltaDays);
        Assert.Equal(sub, result.SubscriptionId);
        Assert.Equal(task, result.MatchedTaskId);
    }

    [Fact]
    public void Matched_NegativeTolerance_Throws()
    {
        Assert.Throws<ArgumentException>(() =>
            ComplianceResult.Matched(
                ScheduleSubscriptionId.New(),
                PrescribedTaskId.New(),
                0,
                -1));
    }
}
