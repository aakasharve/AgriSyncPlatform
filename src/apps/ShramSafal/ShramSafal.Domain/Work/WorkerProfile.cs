using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Work;

/// <summary>
/// Projection of a worker's performance profile. Not an entity — not persisted.
/// Computed on demand from job cards and reliability metrics.
/// CEI Phase 4 §4.8 — Work Trust Ledger.
/// </summary>
public sealed class WorkerProfile
{
    public UserId WorkerUserId { get; init; }
    public string DisplayName { get; init; } = string.Empty;
    public int JobCardsLast30d { get; init; }
    public int JobCardsPaidOutLast30d { get; init; }
    public decimal EarnedLast30d { get; init; }
    public string EarnedCurrencyCode { get; init; } = "INR";
    public ReliabilityScore Reliability { get; init; } = default!;
}
