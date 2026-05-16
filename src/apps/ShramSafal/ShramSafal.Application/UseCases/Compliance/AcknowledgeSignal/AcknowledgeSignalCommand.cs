using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;

/// <summary>
/// CEI Phase 3 §4.6 — acknowledges a compliance signal.
/// Allowed roles: Mukadam and above.
/// </summary>
public sealed record AcknowledgeSignalCommand(
    Guid SignalId,
    UserId CallerUserId,
    AppRole CallerRole,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
