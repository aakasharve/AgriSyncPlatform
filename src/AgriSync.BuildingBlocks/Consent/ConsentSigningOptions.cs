// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — bound from the
/// <c>Consent</c> configuration section. Carries the dev/CI secret
/// override and the current key identifier (kid) used in both modes.
///
/// <para>
/// <b>Production wiring.</b> Production resolver reads the secret bytes
/// straight from AWS Secrets Manager
/// (<c>agrisync/consent/hs256/{kid}</c>) — the
/// <see cref="Hs256Secret"/> field below stays null in production. Only
/// <see cref="Kid"/> matters in production (and even <see cref="Kid"/>
/// can be overridden by the resolver's "current" lookup against
/// <c>agrisync/consent/hs256/current</c>).
/// </para>
///
/// <para>
/// <b>Dev/CI wiring.</b> Set <c>Consent:Hs256Secret</c> to a
/// >=32-byte UTF8 string in <c>appsettings.Development.json</c> or via
/// <c>Consent__Hs256Secret</c> env var. The bootstrapper registers
/// <see cref="EnvVarConsentSigningKeyResolver"/> in that case.
/// </para>
/// </summary>
public sealed class ConsentSigningOptions
{
    /// <summary>
    /// Configuration section name. Matches the
    /// <see cref="Microsoft.Extensions.Configuration"/> convention used
    /// by sibling options (<c>TenantDek</c>, <c>Jwt</c>).
    /// </summary>
    public const string SectionName = "Consent";

    /// <summary>
    /// Dev/CI signing secret. Must be >=32 UTF8 bytes (HS256 minimum
    /// secure length). Null/empty in Production — production reads from
    /// Secrets Manager via <see cref="AwsSecretsManagerConsentSigningKeyResolver"/>.
    /// </summary>
    public string? Hs256Secret { get; set; }

    /// <summary>
    /// Default current key identifier. Stamped into the JWT header on
    /// every issue. Production rotation overrides this via the
    /// <c>agrisync/consent/hs256/current</c> Secrets Manager lookup.
    /// </summary>
    public string Kid { get; set; } = "dev-2026-05";
}
