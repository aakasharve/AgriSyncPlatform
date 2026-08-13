using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Phase 0). Locks DfesTuning as the single
/// source of every DFES tunable. If any number here changes, it is a
/// deliberate product decision — this test is the guard against silent drift
/// and against a consuming phase inventing its own copy.
/// </summary>
public sealed class DfesTuningTests
{
    [Fact]
    public void Thresholds_and_version_match_the_locked_contract()
    {
        DfesTuning.RichDayThreshold.Should().Be(25);
        DfesTuning.UnlockThreshold.Should().Be(25);
        DfesTuning.DailyPointCap.Should().Be(15);
        // dfes-2 (2026-08-13): the Day Understanding rollup became covered ÷ possible
        // weight against a fixed denominator. Rows still stamped dfes-1 came from the
        // old mean-over-applicable-lenses engine and are deliberately NOT backfilled.
        DfesTuning.ScoreEngineVersion.Should().Be("dfes-2");
    }

    [Fact]
    public void ShramPointValues_default_matches_the_locked_contract()
    {
        var p = DfesTuning.Points;
        p.NoWork.Should().Be(2);
        p.Basic.Should().Be(5);
        p.Rich.Should().Be(10);
        p.ObservationBonus.Should().Be(3);
        p.LearningBonus.Should().Be(5);
        p.FollowupBonus.Should().Be(2);
    }

    [Fact]
    public void StreakRules_default_matches_the_locked_contract()
    {
        var s = DfesTuning.Streak;
        s.AdvanceOnDeclaredNoWork.Should().BeTrue();
        s.NeutralOnRestDay.Should().BeTrue();
        s.GraceDaysBeforeBreak.Should().Be(1);
    }
}
