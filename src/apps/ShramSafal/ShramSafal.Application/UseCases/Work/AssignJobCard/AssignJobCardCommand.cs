using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.AssignJobCard;

/// <summary>
/// Assigns a JobCard to a worker. CEI Phase 4 §4.8 — Task 2.1.2.
/// </summary>
public sealed record AssignJobCardCommand(
    Guid JobCardId,
    UserId WorkerUserId,
    UserId CallerUserId,
    string? ClientCommandId);
