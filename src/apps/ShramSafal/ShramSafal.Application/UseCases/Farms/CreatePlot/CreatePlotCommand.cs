namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

public sealed record CreatePlotCommand(
    Guid FarmId,
    string Name,
    decimal AreaInAcres,
    Guid ActorUserId,
    Guid? PlotId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
