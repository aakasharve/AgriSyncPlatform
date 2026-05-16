namespace ShramSafal.Application.UseCases.Finance.CorrectCostEntry;

public sealed record CorrectCostEntryCommand(
    Guid CostEntryId,
    decimal CorrectedAmount,
    string CurrencyCode,
    string Reason,
    Guid CorrectedByUserId,
    Guid? FinanceCorrectionId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. Default sentinels
    // keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
