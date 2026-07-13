using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Locks the lens→/10 rollup:
/// mean of APPLICABLE (non-null) lenses ÷ 10, rounded away-from-zero, clamped
/// to 0–10; all-null → null. N/A lenses are excluded, never counted as 0.
/// </summary>
public sealed class DayUnderstandingScoreTests
{
    [Fact]
    public void ThreeApplicable_averages_then_rolls_to_ten()
    {
        // mean(80,60,40) = 60 → 6.0 → 6
        DayUnderstandingScore.From(new LensScores(80, 60, 40)).Should().Be(6);
    }

    [Fact]
    public void OneApplicable_scores_on_that_lens_alone()
    {
        // only Insight applies: 55 → 5.5 → 6 (away-from-zero). The two N/A
        // lenses do NOT drag the score down (they are excluded, not zeroed).
        DayUnderstandingScore.From(new LensScores(null, 55, null)).Should().Be(6);
    }

    [Fact]
    public void TwoApplicable_excludes_the_null_lens_from_the_mean()
    {
        // mean(90, 70) = 80 → 8.0 → 8; Learning null is excluded (not a 0 that
        // would have made mean(90,70,0)=53 → 5).
        DayUnderstandingScore.From(new LensScores(90, null, 70)).Should().Be(8);
    }

    [Fact]
    public void AllNull_returns_null_no_score()
    {
        DayUnderstandingScore.From(new LensScores(null, null, null)).Should().BeNull();
    }

    [Theory]
    [InlineData(45, 5)]   // 4.5 → 5 (midpoint rounds up)
    [InlineData(75, 8)]   // 7.5 → 8
    [InlineData(25, 3)]   // 2.5 → 3
    [InlineData(5, 1)]    // 0.5 → 1
    [InlineData(4, 0)]    // 0.4 → 0
    [InlineData(44, 4)]   // 4.4 → 4 (below midpoint rounds down)
    [InlineData(0, 0)]    // an honest-but-empty lens still scores 0, not null
    [InlineData(100, 10)] // ceiling
    public void SingleLens_rounds_at_the_midpoint_away_from_zero(int lensScore, int expected)
    {
        DayUnderstandingScore.From(new LensScores(lensScore, null, null)).Should().Be(expected);
    }

    [Theory]
    [InlineData(120, 10)]  // out-of-range high → clamped to 10
    [InlineData(-5, 0)]    // out-of-range low  → clamped to 0
    public void OutOfRange_lens_is_clamped_to_the_zero_to_ten_scale(int lensScore, int expected)
    {
        DayUnderstandingScore.From(new LensScores(lensScore, null, null)).Should().Be(expected);
    }

    [Fact]
    public void Version_is_tied_to_the_score_engine_version()
    {
        DayUnderstandingScore.Version.Should().Be(DfesTuning.ScoreEngineVersion);
        DayUnderstandingScore.Version.Should().Be("dfes-1");
    }
}
