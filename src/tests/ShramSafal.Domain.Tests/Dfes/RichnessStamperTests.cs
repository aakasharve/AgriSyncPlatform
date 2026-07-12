using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class RichnessStamperTests
{
    private static ClassifierSignals Sig(bool obs = false, bool learning = false,
        bool followup = false, string? noWorkCode = null)
        => new(true, false, false, obs, learning, false, false, false, noWorkCode,
               null, null, null, obs, followup);

    [Fact]
    public void RichWorkDay_stacks_bonuses_and_caps_at_DailyPointCap()
    {
        // Rich(10) + Observation(3) + Learning(5) + Followup(2) = 20 → capped to 15.
        var stamp = RichnessStamper.Stamp(DayClassification.RichWorkDay,
            Sig(obs: true, learning: true, followup: true));

        stamp.ShramPointsEarned.Should().Be(DfesTuning.DailyPointCap); // 15
        stamp.AdvancesStreak.Should().BeTrue();
        stamp.AdvancesBar.Should().BeTrue();
    }

    [Fact]
    public void BasicWorkDay_earns_Basic_advances_streak_not_bar()
    {
        var stamp = RichnessStamper.Stamp(DayClassification.BasicWorkDay, Sig());
        stamp.ShramPointsEarned.Should().Be(DfesTuning.Points.Basic); // 5
        stamp.AdvancesStreak.Should().BeTrue();
        stamp.AdvancesBar.Should().BeFalse();
    }

    [Fact]
    public void ObservationDay_and_LearningDay_advance_the_bar()
    {
        RichnessStamper.Stamp(DayClassification.ObservationDay, Sig(obs: true))
            .AdvancesBar.Should().BeTrue();
        RichnessStamper.Stamp(DayClassification.LearningDay, Sig(learning: true))
            .AdvancesBar.Should().BeTrue();
    }

    [Fact]
    public void DeclaredNoWork_restReason_is_neutral_when_NeutralOnRestDay()
    {
        var stamp = RichnessStamper.Stamp(DayClassification.DeclaredNoWorkDay, Sig(noWorkCode: "rest"));
        // NeutralOnRestDay=true → rest day does NOT advance the streak.
        stamp.AdvancesStreak.Should().BeFalse();
        stamp.ShramPointsEarned.Should().Be(DfesTuning.Points.NoWork); // 2
    }

    [Fact]
    public void DeclaredNoWork_externalBlocker_advances_streak()
    {
        var stamp = RichnessStamper.Stamp(DayClassification.DeclaredNoWorkDay, Sig(noWorkCode: "weather"));
        stamp.AdvancesStreak.Should().Be(DfesTuning.Streak.AdvanceOnDeclaredNoWork); // true
    }

    [Fact]
    public void UnaccountedDay_earns_zero_and_is_neutral()
    {
        var stamp = RichnessStamper.Stamp(DayClassification.UnaccountedDay, Sig());
        stamp.ShramPointsEarned.Should().Be(0);
        stamp.AdvancesStreak.Should().BeFalse();
        stamp.AdvancesBar.Should().BeFalse();
    }

    [Fact]
    public void Stamper_reads_DfesTuning_symbolically_not_literals()
    {
        // Rich day with all bonuses computes from the SAME symbols Phase 0 owns.
        var expected = System.Math.Min(
            DfesTuning.Points.Rich + DfesTuning.Points.ObservationBonus
              + DfesTuning.Points.LearningBonus + DfesTuning.Points.FollowupBonus,
            DfesTuning.DailyPointCap);

        RichnessStamper.Stamp(DayClassification.RichWorkDay,
            Sig(obs: true, learning: true, followup: true))
            .ShramPointsEarned.Should().Be(expected);
    }
}
