using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.SettleJobCardPayout;

public sealed record SettleJobCardPayoutCommand(
    Guid JobCardId,
    decimal ActualPayoutAmount,
    string ActualPayoutCurrencyCode,
    string? SettlementNote,
    UserId CallerUserId,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — X-App-Version captured at the
    // endpoint (fallback "unknown"); stamped onto the labour-payout
    // CostEntry's Provenance.AppVersion. Labour payouts are always manual
    // (an owner explicitly settles a verified job card); no SourceAiJobId.
    string ClientAppVersion = "unknown");
