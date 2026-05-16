namespace ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;

public sealed record SetPriceConfigVersionCommand(
    string ItemName,
    decimal UnitPrice,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    int Version,
    Guid CreatedByUserId,
    Guid? PriceConfigId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. Default sentinels
    // keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
