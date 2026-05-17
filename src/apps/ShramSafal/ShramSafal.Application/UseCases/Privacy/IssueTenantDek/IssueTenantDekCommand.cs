// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — request envelope for the IssueTenantDek handler.
// The handler resolves OwnerAccountId from the per-request TenantContext;
// the command itself carries only the actor identity + forensic provenance
// stamped on the resulting AuditEvent. Mirrors the
// CoVeReverifyCommand / UpdateProviderConfigCommand pattern from 05.1 / 04.3b.

namespace ShramSafal.Application.UseCases.Privacy.IssueTenantDek;

public sealed record IssueTenantDekCommand(
    // Endpoint-sourced caller identity. Cannot be Guid.Empty (the endpoint
    // rejects unauthenticated requests with 401 before this handler runs).
    Guid UserId,
    // Audit provenance (mirror of CoVeReverifyCommand defaults so direct-
    // construction unit tests stay green).
    string ClientAppVersion = "unknown",
    string ActorRole = "Unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
