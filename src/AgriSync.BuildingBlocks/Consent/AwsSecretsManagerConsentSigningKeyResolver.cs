// spec: data-principle-spine-2026-05-05/06.3
using System.Collections.Concurrent;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;

namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — production
/// signing-key resolver. Reads HS256 secrets from AWS Secrets Manager:
///
/// <list type="bullet">
/// <item><c>agrisync/consent/hs256/current</c> — pointer to the
/// currently-active kid (rotated by the lambda; staged write so
/// validation overlap stays consistent).</item>
/// <item><c>agrisync/consent/hs256/{kid}</c> — base64 of the raw HS256
/// secret bytes for that kid. Rotated key material lands here.</item>
/// </list>
///
/// <para>
/// <b>Cache.</b> 10-minute in-memory cache keyed by kid. Rotation
/// promotes the new kid by writing both <c>current</c> and the new
/// per-kid entry atomically; the cache TTL bounds how stale the
/// "current" lookup can be before a redeploy / cache-bust. Per-kid
/// entries are read-once-and-cache because the secret bytes for a given
/// kid never change (rotation creates a NEW kid).
/// </para>
///
/// <para>
/// <b>Failure modes.</b>
/// <list type="bullet">
/// <item><see cref="ResourceNotFoundException"/> on the per-kid lookup
/// → returns <c>null</c> (validation treats null as fail-closed).</item>
/// <item>Any other AWS exception propagates — operational alert.</item>
/// </list>
/// </para>
/// </summary>
public sealed class AwsSecretsManagerConsentSigningKeyResolver : IConsentSigningKeyResolver
{
    // 10 minutes mirrors the KMS adapter cache. Tunable via a future
    // ConsentSigningOptions field if the rotation cadence changes.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    private readonly IAmazonSecretsManager _client;
    private readonly ConcurrentDictionary<string, (byte[] Secret, DateTime Expires)> _cache = new();

    public AwsSecretsManagerConsentSigningKeyResolver(IAmazonSecretsManager client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    public async Task<string> GetCurrentKidAsync(CancellationToken ct)
    {
        // No cache — the "current" pointer changes on rotation and the
        // rotation lambda's writes need to take effect immediately on
        // the next issue call. (The per-kid SECRET bytes are still
        // cached below; they don't change for the lifetime of a kid.)
        var response = await _client.GetSecretValueAsync(new GetSecretValueRequest
        {
            SecretId = "agrisync/consent/hs256/current",
        }, ct).ConfigureAwait(false);

        var current = response.SecretString;
        if (string.IsNullOrWhiteSpace(current))
        {
            throw new InvalidOperationException(
                "AWS Secrets Manager returned an empty value for " +
                "'agrisync/consent/hs256/current' — rotation lambda has not " +
                "written a current-kid pointer yet.");
        }

        return current.Trim();
    }

    public async Task<byte[]?> GetSecretByKidAsync(string kid, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(kid))
        {
            return null;
        }

        var key = kid.Trim();

        if (_cache.TryGetValue(key, out var hit) && hit.Expires > DateTime.UtcNow)
        {
            return hit.Secret;
        }

        try
        {
            var response = await _client.GetSecretValueAsync(new GetSecretValueRequest
            {
                SecretId = $"agrisync/consent/hs256/{key}",
            }, ct).ConfigureAwait(false);

            if (string.IsNullOrWhiteSpace(response.SecretString))
            {
                return null;
            }

            // Convention: secret value is base64 of the raw HS256
            // bytes. The rotation lambda writes the value via
            // Convert.ToBase64String(...); the matching FromBase64String
            // here reverses it.
            var bytes = Convert.FromBase64String(response.SecretString);
            _cache[key] = (bytes, DateTime.UtcNow.Add(CacheTtl));
            return bytes;
        }
        catch (ResourceNotFoundException)
        {
            // Token presented an unknown kid (rotation aged it out, OR
            // the token is forged). Fail closed via null — the token
            // service surfaces this as "kid not found" to the caller.
            return null;
        }
    }
}
