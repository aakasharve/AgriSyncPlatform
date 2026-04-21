using FluentAssertions;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work;

public sealed class ReliabilityScoreTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void ReliabilityScore_Overall_ForPerfectWorker_Is100()
    {
        // All logs verified, no disputes, all work on time.
        var score = ReliabilityScore.Compute(
            logCount30d: 10,
            verifiedCount: 10,
            disputedCount: 0,
            onTimeCount: 10,
            plannedCount: 10,
            computedAtUtc: Now);

        score.Overall.Should().Be(100m);
        score.VerifiedRatio.Should().Be(1m);
        score.OnTimeRatio.Should().Be(1m);
        score.DisputeFreeRatio.Should().Be(1m);
    }

    [Fact]
    public void ReliabilityScore_Overall_ForAllDisputed_IsLow()
    {
        // All logs disputed, no verified, no on-time work.
        var score = ReliabilityScore.Compute(
            logCount30d: 10,
            verifiedCount: 0,
            disputedCount: 10,
            onTimeCount: 0,
            plannedCount: 10,
            computedAtUtc: Now);

        // verifiedRatio=0, disputeFreeRatio=0, onTimeRatio=0 → overall=0
        score.Overall.Should().Be(0m);
        score.VerifiedRatio.Should().Be(0m);
        score.OnTimeRatio.Should().Be(0m);
        score.DisputeFreeRatio.Should().Be(0m);
    }

    [Fact]
    public void ReliabilityScore_WithNoLogs_DefaultsToAllOnes()
    {
        // No logs yet — new worker. Defaults to perfect score ratios.
        var score = ReliabilityScore.Compute(
            logCount30d: 0,
            verifiedCount: 0,
            disputedCount: 0,
            onTimeCount: 0,
            plannedCount: 0,
            computedAtUtc: Now);

        score.VerifiedRatio.Should().Be(1m);
        score.DisputeFreeRatio.Should().Be(1m);
        score.OnTimeRatio.Should().Be(1m);
        score.Overall.Should().Be(100m);
    }

    [Fact]
    public void ReliabilityScore_MixedMetrics_ComputesCorrectly()
    {
        // 8/10 verified, 1/10 disputed, 7/10 on time
        // verifiedRatio = 0.8, disputeFreeRatio = 0.9, onTimeRatio = 0.7
        // overall = 0.5×0.8×100 + 0.3×0.7×100 + 0.2×0.9×100 = 40 + 21 + 18 = 79
        var score = ReliabilityScore.Compute(
            logCount30d: 10,
            verifiedCount: 8,
            disputedCount: 1,
            onTimeCount: 7,
            plannedCount: 10,
            computedAtUtc: Now);

        score.Overall.Should().Be(79m);
        score.LogCount30d.Should().Be(10);
        score.DisputeCount30d.Should().Be(1);
        score.ComputedAtUtc.Should().Be(Now);
    }
}
