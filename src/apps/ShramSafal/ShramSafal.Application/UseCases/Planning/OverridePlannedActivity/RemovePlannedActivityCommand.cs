namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed record RemovePlannedActivityCommand(
    Guid PlannedActivityId,
    Guid FarmId,
    string Reason,
    Guid CallerUserId,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
