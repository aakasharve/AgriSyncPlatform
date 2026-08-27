using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class ThreeLensScorerTests
{
    private static ScoredDimension Dim(string name, int weight, double cov)
        => new(name, weight, Applicable: true, Coverage: cov, ConfidenceFactor: 1.0);

    [Fact]
    public void FullCoverageExecution_scores_100()
    {
        var input = new LensInput(
            Execution: [Dim("WHAT", 20, 1.0), Dim("DOSE", 20, 1.0), Dim("COST", 12, 1.0)],
            Insight: [],
            Learning: []);

        var scores = ThreeLensScorer.Score(input);

        scores.ExecutionScore.Should().Be(100);
        scores.InsightScore.Should().BeNull();   // no applicable insight dim → UNKNOWN
        scores.LearningScore.Should().BeNull();
    }

    [Fact]
    public void PartialCoverage_is_weighted_and_rounded()
    {
        // WHAT full (20*1), DOSE half (20*0.5=10) → 30/40 = 75
        var input = new LensInput(
            Execution: [Dim("WHAT", 20, 1.0), Dim("DOSE", 20, 0.5)],
            Insight: [], Learning: []);

        ThreeLensScorer.Score(input).ExecutionScore.Should().Be(75);
    }

    [Fact]
    public void NotApplicable_dims_are_excluded_from_denominator()
    {
        var input = new LensInput(
            Execution:
            [
                Dim("WHAT", 20, 1.0),
                new ScoredDimension("DOSE", 20, Applicable: false, Coverage: 0, ConfidenceFactor: 1.0),
            ],
            Insight: [], Learning: []);

        ThreeLensScorer.Score(input).ExecutionScore.Should().Be(100); // DOSE weight not counted
    }

    [Fact]
    public void ConfidenceFactor_scales_contribution()
    {
        var input = new LensInput(
            Execution: [new ScoredDimension("WHAT", 20, true, 1.0, ConfidenceFactor: 0.5)],
            Insight: [], Learning: []);

        ThreeLensScorer.Score(input).ExecutionScore.Should().Be(50);
    }
}
