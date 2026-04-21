using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.CompleteJobCard;

/// <summary>
/// Completes a JobCard and links it to a DailyLog. CEI Phase 4 §4.8 — Task 2.1.4.
/// </summary>
public sealed record CompleteJobCardCommand(
    Guid JobCardId,
    Guid DailyLogId,
    UserId CallerUserId,
    string? ClientCommandId);
