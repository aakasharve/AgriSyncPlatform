namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Raw metrics for a worker, used to compute ReliabilityScore.
/// Returned by IShramSafalRepository.GetWorkerMetricsAsync.
/// </summary>
public sealed record WorkerMetricsDto(
    int LogCount30d,
    int VerifiedCount30d,
    int DisputedCount30d,
    int OnTimeCount30d,
    int PlannedCount30d,
    int JobCardsLast30d,
    int JobCardsPaidOutLast30d,
    decimal EarnedLast30d = 0m,
    string EarnedCurrencyCode = "INR");
