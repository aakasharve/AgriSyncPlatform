// spec: data-principle-spine-2026-05-05/05.2
namespace AgriSync.BuildingBlocks.Security;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.2 — port that hands callers a
/// per-tenant Data Encryption Key (DEK) bound to an
/// <c>owner_account_id</c> EncryptionContext. The plaintext DEK is intended
/// to be used immediately (AES-GCM seal of a voice clip, for example) and
/// then discarded; the wrapped form (<see cref="TenantDek.DekId"/>) is what
/// gets persisted next to the ciphertext so a later read can
/// <see cref="ResolveAsync"/> the bytes back.
///
/// <para>
/// <b>Why the port lives in BuildingBlocks/Security/.</b> Per OQ-1 verdict
/// (conflict-resolver 2026-05-17), <c>BuildingBlocks/Security/</c> is the
/// permanent home for cross-cutting security primitives — sibling to
/// <c>Auth/</c> + <c>Auditing/</c>. The KMS adapter lives in the same
/// folder so the consumer's project owns the AWS SDK reference.
/// </para>
///
/// <para>
/// <b>EncryptionContext as tenant binding.</b> The AWS KMS
/// <c>EncryptionContext</c> is part of the AAD on every wrap/unwrap call:
/// supplying a different <c>owner_account_id</c> at
/// <see cref="ResolveAsync"/> time causes KMS to reject the decrypt with a
/// <c>KeyManagementServiceException</c>. The adapter swallows that and
/// returns <c>null</c> so cross-tenant DEK unwrap attempts surface as
/// "DEK not available" instead of a stack trace.
/// </para>
/// </summary>
public interface ITenantDekService
{
    /// <summary>
    /// Generate a fresh per-tenant DEK bound to <paramref name="ownerAccountId"/>
    /// via the KMS EncryptionContext. The returned <see cref="TenantDek.DekBytes"/>
    /// MUST be used and discarded immediately; the
    /// <see cref="TenantDek.DekId"/> is the only safe-to-persist form (a
    /// base64-url-safe encoding of the KMS-wrapped ciphertext blob).
    /// </summary>
    Task<TenantDek> IssueAsync(Guid ownerAccountId, CancellationToken ct);

    /// <summary>
    /// Resolve a previously-issued DEK from its wrapped form
    /// (<paramref name="dekId"/>). Returns the plaintext DEK bytes on
    /// success; returns <c>null</c> when the unwrap fails (wrong owner
    /// account, wrong region, KMS key disabled, etc.). The non-throwing
    /// signature is deliberate — callers (Phase 05.3 frontend
    /// <c>tenantDekClient.ts</c>) treat a null as "clip unrecoverable on
    /// this session" and surface a benign UX, not an error toast.
    /// </summary>
    Task<byte[]?> ResolveAsync(Guid ownerAccountId, string dekId, CancellationToken ct);
}

/// <summary>
/// Issued DEK envelope returned by <see cref="ITenantDekService.IssueAsync"/>.
/// <para>
/// <b>Lifetime contract:</b> 24h <see cref="ExpiresAtUtc"/>. The frontend
/// caches the DEK in memory only and refetches when expired — see Phase 05.3
/// <c>tenantDekClient.ts</c>. The wrapped form (<see cref="DekId"/>) is
/// safe to persist alongside ciphertexts indefinitely; the KMS master
/// key has no rotation schedule that would invalidate older wrappings
/// (a rotated CMK keeps the old material available for decrypts).
/// </para>
/// </summary>
/// <param name="DekId">
/// Base64-url-safe (RFC 4648 §5) encoding of the KMS-wrapped ciphertext
/// blob. Persistable; opaque to callers.
/// </param>
/// <param name="DekBytes">
/// 32-byte AES-256 plaintext key. MUST be used immediately and discarded —
/// do NOT persist this value anywhere.
/// </param>
/// <param name="ExpiresAtUtc">
/// Cache-expiry hint for the frontend. 24h from <see cref="IssueAsync"/>.
/// </param>
public sealed record TenantDek(string DekId, byte[] DekBytes, DateTime ExpiresAtUtc);
