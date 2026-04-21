using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.SettleJobCardPayout;

public sealed record SettleJobCardPayoutCommand(
    Guid JobCardId,
    decimal ActualPayoutAmount,
    string ActualPayoutCurrencyCode,
    string? SettlementNote,
    UserId CallerUserId,
    string? ClientCommandId);
