// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — wire-shape of the per-tenant DEK issued to the browser.
// `DekBase64` is the raw 32-byte AES-256 plaintext key, base64-encoded.
// The frontend caches it in memory only — see Phase 05.3 tenantDekClient.ts.

namespace ShramSafal.Application.UseCases.Privacy.IssueTenantDek;

public sealed record IssueTenantDekResult(
    string DekId,
    string DekBase64,
    DateTime ExpiresAtUtc);
