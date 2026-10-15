// spec: data-principle-spine-2026-05-05/05.2
// spec: 2026-08-25-prod-cutover-waves (D1 - tenant-DEK authorization)
//
// Request envelope for the IssueTenantDek handler. The command names the FARM the
// caller is working in; the handler derives the OWNER ACCOUNT from that farm
// server-side (after the endpoint has proven the caller belongs to it). The owner
// account is deliberately NOT a field here: a caller-supplied owner account id
// would be a value to authorize, and the farm already carries the authoritative one.
// Mirrors the CoVeReverifyCommand / UpdateProviderConfigCommand pattern from 05.1 / 04.3b.

namespace ShramSafal.Application.UseCases.Privacy.IssueTenantDek;

public sealed record IssueTenantDekCommand(
    // Endpoint-sourced caller identity. Cannot be Guid.Empty (the endpoint
    // rejects unauthenticated requests with 401 before this handler runs).
    Guid UserId,
    // The farm whose owner account the DEK is bound to. Must be a farm the caller
    // is an Active member (or declared owner) of; the handler re-checks.
    Guid FarmId,
    // Audit provenance (mirror of CoVeReverifyCommand defaults so direct-
    // construction unit tests stay green).
    string ClientAppVersion = "unknown",
    string ActorRole = "Unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
