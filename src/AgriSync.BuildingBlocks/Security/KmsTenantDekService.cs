// spec: data-principle-spine-2026-05-05/05.2
using Amazon.KeyManagementService;
using Amazon.KeyManagementService.Model;
using Microsoft.Extensions.Options;

namespace AgriSync.BuildingBlocks.Security;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.2 — KMS-backed implementation
/// of <see cref="ITenantDekService"/>. Wraps every per-tenant DEK with the
/// configured CMK + an EncryptionContext that binds it to a single
/// <c>owner_account_id</c>; attempts to unwrap with a different account id
/// fail closed (returns <c>null</c>) because KMS treats the context as
/// part of the AAD.
///
/// <para>
/// <b>Why <see cref="DataKeySpec.AES_256"/>.</b> Per plan §05.2.1 + spec
/// note "Spec MUST be AES_256". 32-byte keys are the right shape for the
/// browser WebCrypto <c>AES-GCM</c> sealer that consumes them in Phase
/// 05.3 — anything narrower (AES_128) would still round-trip but mixes
/// algorithm-strength assumptions across the boundary.
/// </para>
///
/// <para>
/// <b>DEK lifetime.</b> 24h <see cref="TenantDek.ExpiresAtUtc"/> per call.
/// The frontend caches the plaintext DEK in memory only and refetches on
/// expiry — the wrapped <c>DekId</c> persists with the ciphertext so
/// older clips remain decryptable across rotations.
/// </para>
///
/// <para>
/// <b>DekId encoding.</b> Base64 → base64-url-safe (RFC 4648 §5) via
/// the canonical <c>+/</c> → <c>-_</c> substitution. Keeps the value
/// safe in URLs / JSON / headers without an HTTP-time
/// <c>WebUtility.UrlEncode</c> round-trip on every read.
/// </para>
/// </summary>
public sealed class KmsTenantDekService : ITenantDekService
{
    private readonly IAmazonKeyManagementService _kms;
    private readonly TenantDekOptions _options;

    public KmsTenantDekService(
        IAmazonKeyManagementService kms,
        IOptions<TenantDekOptions> options)
    {
        _kms = kms ?? throw new ArgumentNullException(nameof(kms));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));

        if (string.IsNullOrWhiteSpace(_options.MasterKeyId))
        {
            // The bootstrapper registers NullTenantDekService when MasterKeyId
            // is empty in dev/CI — reaching this branch means production
            // forgot to set TenantDek:MasterKeyId. Fail fast at construction
            // so the misconfiguration surfaces at the first request, not at
            // KMS-call time inside a transaction.
            throw new InvalidOperationException(
                "TenantDek:MasterKeyId is required when KmsTenantDekService is registered. " +
                "Set the alias of the ap-south-1 KMS CMK (e.g. alias/agrisync-tenant-dek-cmk).");
        }
    }

    public async Task<TenantDek> IssueAsync(Guid ownerAccountId, CancellationToken ct)
    {
        if (ownerAccountId == Guid.Empty)
        {
            throw new ArgumentException("ownerAccountId required", nameof(ownerAccountId));
        }

        var response = await _kms.GenerateDataKeyAsync(new GenerateDataKeyRequest
        {
            KeyId = _options.MasterKeyId,
            EncryptionContext = new Dictionary<string, string>
            {
                ["owner_account_id"] = ownerAccountId.ToString()
            },
            KeySpec = DataKeySpec.AES_256
        }, ct).ConfigureAwait(false);

        var ciphertextBytes = response.CiphertextBlob.ToArray();
        var dekId = ToBase64UrlSafe(ciphertextBytes);
        var plaintext = response.Plaintext.ToArray();

        return new TenantDek(
            DekId: dekId,
            DekBytes: plaintext,
            ExpiresAtUtc: DateTime.UtcNow.AddHours(24));
    }

    public async Task<byte[]?> ResolveAsync(Guid ownerAccountId, string dekId, CancellationToken ct)
    {
        if (ownerAccountId == Guid.Empty)
        {
            // Same shape as a KMS unwrap failure — the caller cannot
            // distinguish "wrong owner" from "missing owner" and that is
            // intentional. Both routes hit the same "DEK not available" UX.
            return null;
        }

        if (string.IsNullOrWhiteSpace(dekId))
        {
            return null;
        }

        byte[] ciphertextBlob;
        try
        {
            ciphertextBlob = FromBase64UrlSafe(dekId);
        }
        catch (FormatException)
        {
            // Caller passed a malformed DekId. Treat as "not resolvable"
            // rather than throwing — the endpoint above returns 404 either
            // way, so we avoid leaking parser internals into the response.
            return null;
        }

        try
        {
            using var ciphertextStream = new MemoryStream(ciphertextBlob, writable: false);
            var response = await _kms.DecryptAsync(new DecryptRequest
            {
                CiphertextBlob = ciphertextStream,
                EncryptionContext = new Dictionary<string, string>
                {
                    ["owner_account_id"] = ownerAccountId.ToString()
                }
            }, ct).ConfigureAwait(false);

            return response.Plaintext.ToArray();
        }
        catch (AmazonKeyManagementServiceException)
        {
            // Wrong tenant (EncryptionContext mismatch — InvalidCiphertextException),
            // wrong region (NotFoundException), key disabled (DisabledException) or
            // any other KMS service-side error. All collapse to the same
            // fail-closed semantics — return null and let the endpoint surface 404.
            // We catch the base AmazonKeyManagementServiceException rather than the
            // ~30 derived model exceptions so future SDK additions don't silently
            // start escaping this contract.
            return null;
        }
    }

    private static string ToBase64UrlSafe(byte[] bytes) =>
        Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_');

    private static byte[] FromBase64UrlSafe(string value)
    {
        var restored = value.Replace('-', '+').Replace('_', '/');
        // Re-pad to a multiple of 4 if the URL-safe encoding dropped the
        // trailing '=' characters (some encoders do, the canonical KMS
        // round-trip we control does not — defensive parse).
        var paddingNeeded = (4 - (restored.Length % 4)) % 4;
        if (paddingNeeded > 0)
        {
            restored = restored.PadRight(restored.Length + paddingNeeded, '=');
        }

        return Convert.FromBase64String(restored);
    }
}
