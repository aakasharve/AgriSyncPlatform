// spec: data-principle-spine-2026-05-05/05.2
// spec: 2026-08-25-prod-cutover-waves (D1 - tenant-DEK authorization)
//
// Request envelope for ResolveTenantDek. The DekId is
// the opaque base64-url-safe value issued by IssueTenantDekHandler; the
// handler hands it back to ITenantDekService.ResolveAsync which calls
// AWS KMS Decrypt with the same EncryptionContext that wrapped it. A
// mismatch (different OwnerAccountId, wrong region, disabled key) makes
// KMS return null and the endpoint surfaces 404.
//
// FarmId names the farm whose owner account the unwrap is attempted under; the
// handler derives that owner account from the farm after re-checking the caller's
// Active membership. A reader that does not know which account sealed a clip tries
// one farm per candidate account and lets KMS refuse the wrong ones.

namespace ShramSafal.Application.UseCases.Privacy.ResolveTenantDek;

public sealed record ResolveTenantDekCommand(
    Guid UserId,
    Guid FarmId,
    string DekId,
    string ClientAppVersion = "unknown",
    string ActorRole = "Unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
