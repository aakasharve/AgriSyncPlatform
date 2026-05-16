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
    string ClientAppVersion = "unknown",
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims()).
    // Carry the X-Device-Id header + salted remote-IP hash for the emitted
    // AuditEvent row's DeviceId / IpHash columns. The CostEntry created by
    // CreateLabourPayout does not carry these fields; only the AuditEvent
    // emission needs the new provenance. Default sentinels keep direct-
    // construction unit tests green.
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
