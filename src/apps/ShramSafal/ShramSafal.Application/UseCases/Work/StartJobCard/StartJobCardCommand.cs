using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.StartJobCard;

/// <summary>
/// Marks a JobCard as started (InProgress). CEI Phase 4 §4.8 — Task 2.1.3.
/// Only the assigned worker may call this.
/// </summary>
public sealed record StartJobCardCommand(
    Guid JobCardId,
    UserId CallerUserId,
    string? ClientCommandId);
