using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.CancelJobCard;

public sealed record CancelJobCardCommand(
    Guid JobCardId,
    string Reason,
    UserId CallerUserId,
    string? ClientCommandId);
