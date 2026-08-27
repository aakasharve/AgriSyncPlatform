namespace ShramSafal.Domain.Dfes;

/// <summary>Pure re-bucket of scoreVlog: folds each lens's dimensions into a
/// 0–100 score via Σ_applicable(weight·coverage·cf) / Σ_applicable(weight).
/// No I/O, no DfesTuning tunables (dimension weights are engine constants set
/// by the caller/extractor). A lens with zero applicable weight → null.</summary>
public static class ThreeLensScorer
{
    public static LensScores Score(LensInput input)
        => new(ScoreLens(input.Execution), ScoreLens(input.Insight), ScoreLens(input.Learning));

    private static int? ScoreLens(IReadOnlyList<ScoredDimension> dims)
    {
        double weighted = 0, weightSum = 0;
        foreach (var d in dims)
        {
            if (!d.Applicable) continue;
            weighted += d.Weight * d.Coverage * d.ConfidenceFactor;
            weightSum += d.Weight;
        }

        return weightSum > 0 ? (int)Math.Round(100 * weighted / weightSum, MidpointRounding.AwayFromZero) : null;
    }
}
