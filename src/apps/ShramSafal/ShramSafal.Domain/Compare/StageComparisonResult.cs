namespace ShramSafal.Domain.Compare;

public sealed record StageComparisonResult(
    string StageName,
    int StartDay,
    int EndDay,
    IReadOnlyList<StageComparisonBucket> Buckets,
    HealthScore OverallHealth);

public sealed record StageComparisonBucket(
    string Category,
    IReadOnlyList<string> Planned,
    IReadOnlyList<string> Executed,
    IReadOnlyList<string> Matched,
    IReadOnlyList<string> Missing,
    IReadOnlyList<string> Extra,
    HealthScore Health);

