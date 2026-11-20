namespace ShramSafal.Application.UseCases.Farms.SetPlotGroup;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane GRP-1a. Names (or, with <c>null</c> / whitespace, clears) the
/// owner's group label on ONE plot of ONE farm. <see cref="GroupName"/> is the raw text the caller sent; the rule that trims
/// it, turns whitespace into "no group" and refuses more than 30 characters is <c>Plot.NormalizeGroupName</c>.
/// </summary>
public sealed record SetPlotGroupCommand(
    Guid FarmId,
    Guid PlotId,
    string? GroupName,
    Guid ActorUserId,
    string? ClientCommandId = null,
    // Forensic provenance sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version header; the defaults match
    // the worker / unknown path so direct-construction unit tests stay green (as on CreatePlotCommand).
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
