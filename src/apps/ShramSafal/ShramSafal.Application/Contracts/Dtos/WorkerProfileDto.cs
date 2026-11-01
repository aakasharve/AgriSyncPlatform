namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Output DTO for the GetWorkerProfile query.
/// CEI Phase 4 §4.8 — Work Trust Ledger.
/// </summary>
public sealed record WorkerProfileDto(
    Guid WorkerUserId,
    string DisplayName,
    int JobCardsLast30d,
    int JobCardsPaidOutLast30d,
    // lane MU-3 fix 1 (F7) — what the farm paid him (a wage): null = withheld from this reader, never ₹0.
    decimal? EarnedLast30d,
    string EarnedCurrencyCode,
    decimal ReliabilityOverall,
    decimal VerifiedRatio,
    decimal OnTimeRatio,
    decimal DisputeFreeRatio,
    int LogCount30d,
    int DisputeCount30d,
    DateTime ComputedAtUtc);
