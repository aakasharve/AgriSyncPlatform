using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;

public sealed record VerifyJobCardForPayoutCommand(
    Guid JobCardId,
    UserId CallerUserId,
    string? ClientCommandId);
