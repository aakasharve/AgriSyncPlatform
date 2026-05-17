// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — dev / CI stub
/// registered when the AWS Secrets Manager adapter cannot run AND
/// <c>Consent:Hs256Secret</c> is missing. Mirrors the Phase 05
/// <see cref="AgriSync.BuildingBlocks.Security.NullTenantDekService"/>
/// recovery pattern: do NOT fail-fast at boot just because a prod-only
/// secret is absent. Throw at call-time instead so any dev codepath
/// that accidentally exercises the consent flow surfaces a loud failure
/// without bringing down the whole API.
/// </summary>
public sealed class NullConsentSigningKeyResolver : IConsentSigningKeyResolver
{
    public Task<string> GetCurrentKidAsync(CancellationToken ct) =>
        throw new InvalidOperationException(
            "ConsentTokenService unavailable in this environment. Configure " +
            "Consent:Hs256Secret (dev/CI) or run with AWS credentials that can " +
            "read 'agrisync/consent/hs256/current' from Secrets Manager (prod).");

    public Task<byte[]?> GetSecretByKidAsync(string kid, CancellationToken ct) =>
        throw new InvalidOperationException(
            "ConsentTokenService unavailable in this environment. Configure " +
            "Consent:Hs256Secret (dev/CI) or run with AWS credentials that can " +
            "read 'agrisync/consent/hs256/{kid}' from Secrets Manager (prod).");
}
