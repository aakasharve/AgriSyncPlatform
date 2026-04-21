namespace ShramSafal.Domain.Work;

/// <summary>
/// Value object representing a worker's reliability score computed over the trailing 30 days.
/// CEI Phase 4 §4.8 — Work Trust Ledger.
///
/// Formula:
///   Overall = 0.50 × verifiedRatio × 100
///           + 0.30 × onTimeRatio × 100
///           + 0.20 × disputeFreeRatio × 100
/// </summary>
public sealed record ReliabilityScore(
    decimal Overall,
    decimal VerifiedRatio,
    decimal OnTimeRatio,
    decimal DisputeFreeRatio,
    int LogCount30d,
    int DisputeCount30d,
    DateTime ComputedAtUtc)
{
    public static ReliabilityScore Compute(
        int logCount30d,
        int verifiedCount,
        int disputedCount,
        int onTimeCount,
        int plannedCount,
        DateTime computedAtUtc)
    {
        var verifiedRatio = logCount30d == 0 ? 1m : (decimal)verifiedCount / logCount30d;
        var disputeFreeRatio = logCount30d == 0 ? 1m : 1m - (decimal)disputedCount / logCount30d;
        var onTimeRatio = plannedCount == 0 ? 1m : (decimal)onTimeCount / plannedCount;
        var overall = 0.50m * verifiedRatio * 100m
                    + 0.30m * onTimeRatio * 100m
                    + 0.20m * disputeFreeRatio * 100m;

        return new(
            Math.Round(overall, 2),
            verifiedRatio,
            onTimeRatio,
            disputeFreeRatio,
            logCount30d,
            disputedCount,
            computedAtUtc);
    }
}
