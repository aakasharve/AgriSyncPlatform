// spec: data-principle-spine-2026-05-05/05.2
namespace AgriSync.BuildingBlocks.Security;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.2 — bound from the
/// <c>TenantDek</c> configuration section (e.g. <c>TenantDek:MasterKeyId</c>).
/// <para>
/// <b>Production wiring.</b> The master key ID should be the alias of an
/// ap-south-1 KMS customer master key (CMK), for example
/// <c>alias/agrisync-tenant-dek-cmk</c>. Provisioned via Terraform and
/// supplied to the API container via AWS SecretsManager →
/// <c>TenantDek:MasterKeyId</c> through the standard configuration merge
/// in <c>AgriSync.Bootstrapper/Program.cs</c>.
/// </para>
/// <para>
/// <b>Dev/CI wiring.</b> When this value is null/empty in non-Production
/// environments the bootstrapper registers <see cref="NullTenantDekService"/>
/// instead of <see cref="KmsTenantDekService"/> so dev/CI never crashes on a
/// missing prod-only key — mirrors the Phase 04 <c>IpHashSalt</c> +
/// <c>ShramSafalDb_Migration</c> pattern after those two pre-prod fail-fasts
/// burned the team twice.
/// </para>
/// </summary>
public sealed class TenantDekOptions
{
    /// <summary>
    /// KMS key identifier (ARN, key ID, alias, or alias ARN) used as the
    /// <c>KeyId</c> on every <c>GenerateDataKey</c> request. Null/empty in
    /// non-Production means the stub adapter wins — Production MUST set
    /// this.
    /// </summary>
    public string? MasterKeyId { get; set; }
}
