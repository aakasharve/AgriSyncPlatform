namespace ShramSafal.Domain.AI;

public enum ConfidenceScore
{
    High = 0,
    Medium = 1,
    Low = 2
}

public static class ConfidenceScorePolicy
{
    public const decimal HighThreshold = 0.85m;
    public const decimal MediumThreshold = 0.50m;

    public static ConfidenceScore FromScore(decimal score)
    {
        var normalized = Normalize(score);

        if (normalized >= HighThreshold)
        {
            return ConfidenceScore.High;
        }

        if (normalized >= MediumThreshold)
        {
            return ConfidenceScore.Medium;
        }

        return ConfidenceScore.Low;
    }

    public static decimal Normalize(decimal score) => Math.Clamp(score, 0m, 1m);
}
