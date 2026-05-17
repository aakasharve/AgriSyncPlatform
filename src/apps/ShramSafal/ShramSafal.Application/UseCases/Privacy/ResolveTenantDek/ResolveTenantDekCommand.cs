// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — request envelope for ResolveTenantDek. The DekId is
// the opaque base64-url-safe value issued by IssueTenantDekHandler; the
// handler hands it back to ITenantDekService.ResolveAsync which calls
// AWS KMS Decrypt with the same EncryptionContext that wrapped it. A
// mismatch (different OwnerAccountId, wrong region, disabled key) makes
// KMS return null and the endpoint surfaces 404.

namespace ShramSafal.Application.UseCases.Privacy.ResolveTenantDek;

public sealed record ResolveTenantDekCommand(
    Guid UserId,
    string DekId,
    string ClientAppVersion = "unknown",
    string ActorRole = "Unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
