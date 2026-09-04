namespace ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

public sealed record UpdateFarmBoundaryCommand(
    Guid FarmId,
    Guid ActorUserId,
    string PolygonGeoJson,
    double CentreLat,
    double CentreLng,
    decimal CalculatedAreaAcres,
    // Stage A0 / A3 — ActorRole removed. The server resolves the actor's role on the
    // target farm at write time (GetUserRoleForFarmAsync), so a role travelling on the
    // command is at best redundant and at worst a value a future reader would trust.
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

