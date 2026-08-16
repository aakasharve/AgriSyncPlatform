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
        // dfes-3 (2026-08-13, founder-decided): LEARN_FACET left the /10 while nothing
        // can earn it, and DOSE/CARRIER became owed from the OPERATION rather than from
        // a named product. No weight moved. The frontend mirror
        // dfes-4 (2026-08-16, wave-3.5 — bumped ONCE for all of Wave 3): weather retires
        // when the app already holds it, water is decided by the product rather than a
        // method flag, and observations are anchored. Unlike every earlier bump these do
        // NOT reach old rows — DfesLensExtractor.Build freezes a day on the engine it was
        // scored under (see ScoreEngineVersionGuardTests). The frontend mirror
        // (mobile-web/src/features/logs/services/dfesTuning.ts) is value-locked to this
        // string by dfesTuning.test.ts — bump both or that test fails.
        DfesTuning.ScoreEngineVersion.Should().Be("dfes-4");
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
